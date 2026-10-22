import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  type DatosTitularPlantilla,
  type GenerarDesdePlantillaInput,
  type PlantillaCertificado,
  type ResumenGeneracion,
} from '@seminario/shared';
import { cargarEntorno } from '../config/entorno.js';
import { db } from '../db/cliente.js';
import { asistentes, plantillasCertificado } from '../db/esquema.js';
import { errores } from '../plugins/errores.js';
import { abrirPlantilla, generarDocx } from './plantillaDocx.js';

/** Sanitiza un texto para usarlo como nombre de archivo. */
function nombreArchivoSeguro(valor: string): string {
  const limpio = valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase();
  return limpio.length > 0 ? limpio.slice(0, 80) : 'CERTIFICADO';
}

function directorioPlantillas(): string {
  return path.resolve(process.cwd(), cargarEntorno().PLANTILLAS_DIR);
}

function aPlantillaPublica(fila: typeof plantillasCertificado.$inferSelect): PlantillaCertificado {
  return {
    id: fila.id,
    nombre: fila.nombre,
    nombreArchivo: fila.nombreArchivo,
    tamanoBytes: fila.tamanoBytes,
    camposDetectados: (fila.camposDetectados ?? []) as PlantillaCertificado['camposDetectados'],
    esPredeterminada: fila.esPredeterminada,
    activa: fila.activa,
    creadoPor: fila.creadoPor,
    createdAt: fila.createdAt.toISOString(),
    updatedAt: fila.updatedAt.toISOString(),
  };
}

export async function listarPlantillas(soloActivas = false): Promise<PlantillaCertificado[]> {
  const filas = await db
    .select()
    .from(plantillasCertificado)
    .where(soloActivas ? eq(plantillasCertificado.activa, true) : sql`true`)
    .orderBy(asc(plantillasCertificado.createdAt));
  return filas.map(aPlantillaPublica);
}

export async function obtenerPlantilla(id: string): Promise<PlantillaCertificado> {
  const filas = await db
    .select()
    .from(plantillasCertificado)
    .where(eq(plantillasCertificado.id, id))
    .limit(1);
  const fila = filas[0];
  if (!fila) throw errores.noEncontrado('La plantilla no existe');
  return aPlantillaPublica(fila);
}

export interface CrearPlantillaInput {
  nombre: string;
  nombreArchivo: string;
  contenido: Buffer;
  creadoPor: string;
  esPredeterminada?: boolean;
}

/**
 * Guarda en disco una plantilla .docx y valida que el documento sea legible.
 * Al ser la primera plantilla, se marca como predeterminada de forma automatica.
 */
export async function crearPlantilla(input: CrearPlantillaInput): Promise<PlantillaCertificado> {
  const plantilla = await abrirPlantilla(input.contenido).catch((error) => {
    throw errores.validacion(
      error instanceof Error ? error.message : 'El archivo no es una plantilla .docx valida',
    );
  });

  const directorio = directorioPlantillas();
  await mkdir(directorio, { recursive: true });

  const id = randomUUID();
  const hash = createHash('sha256').update(input.contenido).digest('hex').slice(0, 16);
  const ruta = path.join(directorio, `${id}-${hash}.docx`);
  await writeFile(ruta, input.contenido);

  const existentes = await db
    .select({ id: plantillasCertificado.id })
    .from(plantillasCertificado)
    .limit(1);
  const esPredeterminada = input.esPredeterminada ?? existentes.length === 0;

  const insertadas = await db
    .insert(plantillasCertificado)
    .values({
      id,
      nombre: input.nombre,
      nombreArchivo: input.nombreArchivo,
      rutaArchivo: ruta,
      tamanoBytes: input.contenido.length,
      camposDetectados: plantilla.campos,
      esPredeterminada,
      activa: true,
      creadoPor: input.creadoPor,
    })
    .returning();

  // Solo una plantilla puede ser predeterminada: al insertar otra se degrada la anterior.
  if (esPredeterminada) {
    await db
      .update(plantillasCertificado)
      .set({ esPredeterminada: false })
      .where(and(eq(plantillasCertificado.esPredeterminada, true), sql`${plantillasCertificado.id} <> ${id}`));
  }

  return aPlantillaPublica(insertadas[0]!);
}

export interface ActualizarPlantillaDatos {
  nombre?: string;
  esPredeterminada?: boolean;
  activa?: boolean;
}

export async function actualizarPlantilla(
  id: string,
  datos: ActualizarPlantillaDatos,
): Promise<PlantillaCertificado> {
  const filas = await db
    .select()
    .from(plantillasCertificado)
    .where(eq(plantillasCertificado.id, id))
    .limit(1);
  if (!filas[0]) throw errores.noEncontrado('La plantilla no existe');

  if (datos.esPredeterminada === false && filas[0].esPredeterminada) {
    throw errores.conflicto('Debe existir una plantilla predeterminada. Marque otra antes de quitar esta.');
  }

  const actualizadas = await db
    .update(plantillasCertificado)
    .set({
      ...(datos.nombre !== undefined ? { nombre: datos.nombre } : {}),
      ...(datos.esPredeterminada !== undefined ? { esPredeterminada: datos.esPredeterminada } : {}),
      ...(datos.activa !== undefined ? { activa: datos.activa } : {}),
      updatedAt: new Date(),
    })
    .where(eq(plantillasCertificado.id, id))
    .returning();

  if (datos.esPredeterminada === true) {
    await db
      .update(plantillasCertificado)
      .set({ esPredeterminada: false })
      .where(and(eq(plantillasCertificado.esPredeterminada, true), sql`${plantillasCertificado.id} <> ${id}`));
  }

  return aPlantillaPublica(actualizadas[0]!);
}

export async function eliminarPlantilla(id: string): Promise<void> {
  const filas = await db
    .select()
    .from(plantillasCertificado)
    .where(eq(plantillasCertificado.id, id))
    .limit(1);
  const fila = filas[0];
  if (!fila) throw errores.noEncontrado('La plantilla no existe');

  await db.delete(plantillasCertificado).where(eq(plantillasCertificado.id, id));
  await unlink(fila.rutaArchivo).catch(() => undefined);

  // Si se elimino la predeterminada, la plantilla activa mas antigua la reemplaza.
  if (fila.esPredeterminada) {
    const siguientes = await db
      .select({ id: plantillasCertificado.id })
      .from(plantillasCertificado)
      .where(eq(plantillasCertificado.activa, true))
      .orderBy(asc(plantillasCertificado.createdAt))
      .limit(1);
    if (siguientes[0]) {
      await db
        .update(plantillasCertificado)
        .set({ esPredeterminada: true })
        .where(eq(plantillasCertificado.id, siguientes[0].id));
    }
  }
}

/** Convierte una fila del padron al conjunto de campos de la plantilla. */
function datosTitular(fila: typeof asistentes.$inferSelect): DatosTitularPlantilla {
  const cedula = (fila.cedulaCiudadania ?? '').trim();
  return {
    asistenteId: fila.id,
    nombre: `${fila.nombres} ${fila.apellidos}`.replace(/\s+/g, ' ').trim().toUpperCase(),
    cedula: cedula.length > 0 ? cedula : fila.id,
    id: fila.id,
    rol: fila.rol === 'estudiante' ? 'Estudiante' : 'Docente',
    semestre: fila.semestre !== null ? String(fila.semestre) : '',
  };
}

export interface CertificadoGenerado {
  asistenteId: string;
  nombre: string;
  archivo: string;
  contenido: Buffer;
}

/**
 * Genera los documentos .docx de los asistentes indicados con la plantilla dada.
 *
 * La fuente de datos es el padron de asistentes activos; `todos` selecciona el
 * padron completo (con filtro opcional por rol). Devuelve el archivo y el
 * contenido de cada certificado para que la ruta decida como entregarlos.
 */
export async function generarCertificados(
  input: GenerarDesdePlantillaInput,
): Promise<{ generados: CertificadoGenerado[]; resumen: ResumenGeneracion }> {
  const plantillas = await db
    .select()
    .from(plantillasCertificado)
    .where(eq(plantillasCertificado.id, input.plantillaId))
    .limit(1);
  const plantillaFila = plantillas[0];
  if (!plantillaFila) throw errores.noEncontrado('La plantilla no existe');
  if (!plantillaFila.activa) throw errores.conflicto('La plantilla esta inactiva');

  const condiciones = [eq(asistentes.activo, true)];
  if (input.rol) condiciones.push(eq(asistentes.rol, input.rol));
  if (!input.todos && input.asistenteIds && input.asistenteIds.length > 0) {
    condiciones.push(inArray(asistentes.id, input.asistenteIds));
  } else if (!input.todos && (!input.asistenteIds || input.asistenteIds.length === 0)) {
    throw errores.validacion('Indique al menos un asistente o marque la opcion de todo el padron');
  }

  const filas = await db
    .select()
    .from(asistentes)
    .where(and(...condiciones))
    .orderBy(asc(asistentes.apellidos), asc(asistentes.nombres));

  if (filas.length === 0) {
    throw errores.conflicto('No hay asistentes que coincidan con la seleccion');
  }

  const contenidoPlantilla = await readFile(plantillaFila.rutaArchivo);
  const plantillaAbierta = await abrirPlantilla(contenidoPlantilla);
  const prefijo = input.prefijoArchivo ? nombreArchivoSeguro(input.prefijoArchivo) : 'CERTIFICADO';

  const generados: CertificadoGenerado[] = [];
  const erroresGeneracion: ResumenGeneracion['errores'] = [];

  for (const fila of filas) {
    try {
      const datos = datosTitular(fila);
      const contenido = await generarDocx(plantillaAbierta, datos);
      generados.push({
        asistenteId: fila.id,
        nombre: datos.nombre,
        archivo: `${prefijo}-${nombreArchivoSeguro(fila.id)}-${nombreArchivoSeguro(datos.nombre)}.docx`,
        contenido,
      });
    } catch (error) {
      erroresGeneracion.push({
        asistenteId: fila.id,
        mensaje: error instanceof Error ? error.message : 'Error desconocido al generar el documento',
      });
    }
  }

  const resumen: ResumenGeneracion = {
    total: filas.length,
    generados: generados.length,
    omitidos: erroresGeneracion.length,
    detalles: generados.map((item) => ({
      asistenteId: item.asistenteId,
      nombre: item.nombre,
      archivo: item.archivo,
    })),
    errores: erroresGeneracion,
  };

  return { generados, resumen };
}
