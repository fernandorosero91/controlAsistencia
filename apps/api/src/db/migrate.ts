import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './cliente.js';

/**
 * Runner de migraciones versionadas.
 *
 * Los archivos viven en apps/api/drizzle/*.sql y separan dos bloques:
 *   -- migrate:up  Sentencias que aplican el cambio
 *   -- migrate:down Sentencias que lo revierten
 * El estado se registra en la tabla schema_migrations con el checksum del archivo.
 */

const MARCADOR_UP = '-- migrate:up';
const MARCADOR_DOWN = '-- migrate:down';

/** Clave del cerrojo consultivo que serializa las migraciones (ver aplicarMigraciones). */
const CERROJO_MIGRACIONES = '7712345678901';

export interface MigracionAplicada {
  version: string;
  checksum: string;
  aplicadaEn: Date;
}

export interface MigracionPendiente {
  version: string;
  archivo: string;
  checksum: string;
}

function directorioMigraciones(): string {
  const candidatos = [
    process.env.MIGRATIONS_DIR,
    path.resolve(process.cwd(), 'drizzle'),
    path.resolve(process.cwd(), 'apps/api/drizzle'),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle'),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../drizzle'),
  ].filter((valor): valor is string => typeof valor === 'string' && valor.length > 0);

  for (const candidato of candidatos) {
    if (existsSync(candidato)) return candidato;
  }
  throw new Error(
    `No se encontro el directorio de migraciones. Busque en: ${candidatos.join(', ')}`,
  );
}

function separarBloques(contenido: string): { arriba: string; abajo: string } {
  const indiceUp = contenido.indexOf(MARCADOR_UP);
  const indiceDown = contenido.indexOf(MARCADOR_DOWN);
  if (indiceUp === -1) {
    throw new Error('La migracion no contiene el bloque "-- migrate:up"');
  }
  const arriba =
    indiceDown === -1
      ? contenido.slice(indiceUp + MARCADOR_UP.length)
      : contenido.slice(indiceUp + MARCADOR_UP.length, indiceDown);
  const abajo = indiceDown === -1 ? '' : contenido.slice(indiceDown + MARCADOR_DOWN.length);
  return { arriba: arriba.trim(), abajo: abajo.trim() };
}

async function asegurarTablaEstado(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      checksum text NOT NULL,
      aplicada_en timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function migracionesAplicadas(): Promise<MigracionAplicada[]> {
  const resultado = await pool.query<{ version: string; checksum: string; aplicada_en: Date }>(
    'SELECT version, checksum, aplicada_en FROM schema_migrations ORDER BY version ASC',
  );
  return resultado.rows.map((fila) => ({
    version: fila.version,
    checksum: fila.checksum,
    aplicadaEn: fila.aplicada_en,
  }));
}

async function archivosMigracion(): Promise<{ version: string; archivo: string; ruta: string }[]> {
  const directorio = directorioMigraciones();
  const entradas = await readdir(directorio);
  return entradas
    .filter((nombre) => /^\d+_[\w.-]+\.sql$/.test(nombre))
    .sort()
    .map((nombre) => ({
      version: nombre.replace(/\.sql$/, ''),
      archivo: nombre,
      ruta: path.join(directorio, nombre),
    }));
}

export async function estadoMigraciones(): Promise<{
  aplicadas: MigracionAplicada[];
  pendientes: MigracionPendiente[];
}> {
  await asegurarTablaEstado();
  const aplicadas = await migracionesAplicadas();
  const aplicadasMap = new Map(aplicadas.map((m) => [m.version, m]));
  const pendientes: MigracionPendiente[] = [];

  for (const archivo of await archivosMigracion()) {
    const contenido = await readFile(archivo.ruta, 'utf8');
    const checksum = createHash('sha256').update(contenido).digest('hex');
    if (!aplicadasMap.has(archivo.version)) {
      pendientes.push({ version: archivo.version, archivo: archivo.archivo, checksum });
    } else if (aplicadasMap.get(archivo.version)!.checksum !== checksum) {
      throw new Error(
        `La migracion ${archivo.version} ya fue aplicada pero su contenido cambio. ` +
          'Cree una migracion nueva en lugar de modificar una aplicada.',
      );
    }
  }

  return { aplicadas, pendientes };
}

export async function aplicarMigraciones(): Promise<string[]> {
  // Cerrojo consultivo de PostgreSQL: si dos replicas de la API arrancan a la
  // vez (o el seed coincide con un despliegue), una espera a la otra en lugar de
  // intentar crear las mismas tablas. Se toma sobre una conexion dedicada y se
  // libera al terminar; si el proceso muere, la sesion se cierra y el cerrojo
  // se suelta solo.
  const cerrojo = await pool.connect();
  try {
    // La espera por el cerrojo puede durar mas que el statement_timeout global
    // mientras la otra replica termina de migrar.
    await cerrojo.query('SET statement_timeout = 0');
    await cerrojo.query('SELECT pg_advisory_lock($1::bigint)', [CERROJO_MIGRACIONES]);

    await asegurarTablaEstado();
    const aplicadas = await migracionesAplicadas();
    const aplicadasSet = new Set(aplicadas.map((m) => m.version));
    const ejecutadas: string[] = [];

    for (const archivo of await archivosMigracion()) {
      if (aplicadasSet.has(archivo.version)) continue;

      const contenido = await readFile(archivo.ruta, 'utf8');
      const checksum = createHash('sha256').update(contenido).digest('hex');
      const { arriba } = separarBloques(contenido);

      const cliente = await pool.connect();
      try {
        await cliente.query('BEGIN');
        await cliente.query(arriba);
        await cliente.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [
          archivo.version,
          checksum,
        ]);
        await cliente.query('COMMIT');
        ejecutadas.push(archivo.version);
      } catch (error) {
        await cliente.query('ROLLBACK');
        throw error;
      } finally {
        cliente.release();
      }
    }

    return ejecutadas;
  } finally {
    // Se destruye la conexion: al cerrarse la sesion PostgreSQL libera el cerrojo
    // aunque el proceso haya fallado a mitad de camino.
    cerrojo.release(true);
  }
}

export async function revertirUltimaMigracion(): Promise<string | null> {
  await asegurarTablaEstado();
  const aplicadas = await migracionesAplicadas();
  const ultima = aplicadas[aplicadas.length - 1];
  if (!ultima) return null;

  const archivos = await archivosMigracion();
  const archivo = archivos.find((item) => item.version === ultima.version);
  if (!archivo) {
    throw new Error(`No se encontro el archivo de la migracion ${ultima.version}`);
  }

  const contenido = await readFile(archivo.ruta, 'utf8');
  const { abajo } = separarBloques(contenido);
  if (!abajo) {
    throw new Error(`La migracion ${ultima.version} no define bloque "-- migrate:down"`);
  }

  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    await cliente.query(abajo);
    await cliente.query('DELETE FROM schema_migrations WHERE version = $1', [ultima.version]);
    await cliente.query('COMMIT');
  } catch (error) {
    await cliente.query('ROLLBACK');
    throw error;
  } finally {
    cliente.release();
  }

  return ultima.version;
}

async function principal(): Promise<void> {
  try {
    const accion = process.argv[2] ?? 'up';
    if (accion === 'up') {
      const ejecutadas = await aplicarMigraciones();
      if (ejecutadas.length === 0) {
        console.log('La base de datos ya esta actualizada.');
      } else {
        console.log(`Migraciones aplicadas: ${ejecutadas.join(', ')}`);
      }
    } else if (accion === 'down') {
      const revertida = await revertirUltimaMigracion();
      console.log(
        revertida ? `Migracion revertida: ${revertida}` : 'No hay migraciones que revertir.',
      );
    } else if (accion === 'status') {
      const { aplicadas, pendientes } = await estadoMigraciones();
      console.log('Migraciones aplicadas:');
      for (const migracion of aplicadas) {
        console.log(`  - ${migracion.version} (${migracion.aplicadaEn.toISOString()})`);
      }
      console.log('Migraciones pendientes:');
      for (const migracion of pendientes) {
        console.log(`  - ${migracion.version}`);
      }
    } else {
      throw new Error(`Accion desconocida: ${accion}. Use up, down o status.`);
    }
  } finally {
    // El pool se cierra siempre: si la migracion falla, el proceso debe
    // terminar y devolver el codigo de error, no quedar colgado.
    await pool.end();
  }
}

const invocadoDirectamente =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invocadoDirectamente) {
  principal().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
