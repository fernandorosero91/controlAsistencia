import argon2 from 'argon2';
import { sql } from 'drizzle-orm';
import { cargarEntorno } from '../config/entorno.js';
import { logger } from '../config/log.js';
import { db, pool } from './cliente.js';
import {
  asistentes,
  jornadas,
  seminarioConfig,
  tiposRefrigerio,
  usuariosSistema,
} from './esquema.js';
import { aplicarMigraciones } from './migrate.js';

const NOMBRES = [
  'Ana', 'Andres', 'Beatriz', 'Camilo', 'Carla', 'Daniel', 'Diana', 'Eduardo',
  'Elena', 'Felipe', 'Gabriela', 'Hector', 'Isabel', 'Javier', 'Laura', 'Manuel',
  'Marcela', 'Nicolas', 'Paula', 'Ricardo', 'Sofia', 'Tomas', 'Valentina', 'Wilson',
  'Ximena', 'Yolanda', 'Zulma', 'Sebastian', 'Lucia', 'Mateo',
];

const APELLIDOS = [
  'Acosta', 'Benitez', 'Cardona', 'Duarte', 'Escobar', 'Franco', 'Giraldo',
  'Henao', 'Jaramillo', 'Lopez', 'Mejia', 'Navarro', 'Ochoa', 'Pelaez', 'Quintero',
  'Restrepo', 'Sandoval', 'Torres', 'Uribe', 'Valencia', 'Zapata', 'Montoya',
  'Ospina', 'Piedrahita', 'Cataño', 'Bedoya', 'Arango', 'Castillo', 'Gallego',
  'Hoyos',
];

/** Fecha del seminario: dentro de 30 dias, en la zona horaria de Bogota (UTC-5). */
function fechaSeminario(): Date {
  const entorno = cargarEntorno();
  const base = new Date();
  base.setDate(base.getDate() + 30);
  const dia = base.toISOString().slice(0, 10);
  return new Date(`${dia}T12:00:00.000Z`);
}

function conHora(fecha: Date, hora: number, minuto = 0): Date {
  const anio = fecha.getUTCFullYear();
  const mes = fecha.getUTCMonth();
  const dia = fecha.getUTCDate();
  // Bogota es UTC-5 todo el ano (no aplica horario de verano).
  return new Date(Date.UTC(anio, mes, dia, hora + 5, minuto));
}

export async function sembrarDatos(): Promise<void> {
  const entorno = cargarEntorno();

  await aplicarMigraciones();

  // -------------------------------------------------------------- administrador
  const passwordHash = await argon2.hash(entorno.ADMIN_PASSWORD, { type: argon2.argon2id });
  await db
    .insert(usuariosSistema)
    .values({
      nombre: entorno.ADMIN_NOMBRE,
      email: entorno.ADMIN_EMAIL.toLowerCase(),
      passwordHash,
      rol: 'admin',
    })
    .onConflictDoNothing();

  const passwordOperador = entorno.OPERADOR_PASSWORD ?? entorno.ADMIN_PASSWORD;
  const hashOperador = await argon2.hash(passwordOperador, { type: argon2.argon2id });
  for (let indice = 1; indice <= entorno.ADMIN_OPERADORES; indice += 1) {
    await db
      .insert(usuariosSistema)
      .values({
        nombre: `Operador ${indice}`,
        email: `operador${indice}@seminario.local`,
        passwordHash: hashOperador,
        rol: 'operador',
      })
      .onConflictDoNothing();
  }

  // ------------------------------------------------------- configuracion general
  const fecha = fechaSeminario();
  const horaFin = conHora(fecha, 18, 0);

  await db
    .insert(seminarioConfig)
    .values({
      id: 1,
      nombre: 'Seminario de actualizacion academica',
      fecha: fecha.toISOString().slice(0, 10),
      horaFinSeminario: horaFin,
      toleranciaMinutos: 15,
      exigirAmbasJornadas: true,
      intensidadHoraria: 8,
      permitirRegistroFueraDeVentana: false,
      textoEncabezado:
        'Universidad sendo certifica la participacion en el seminario de actualizacion academica.',
      textoCierre:
        'Este certificado se expide por la coordinacion academica y puede verificarse en el sitio web del seminario.',
      firmaNombre: 'Coordinacion academica',
      firmaCargo: 'Seminario de actualizacion academica',
      idRegex: '^[A-Z0-9]{4,20}$',
      urlPublica: entorno.BASE_URL_PUBLICA,
    })
    .onConflictDoNothing({ target: seminarioConfig.id });

  // ------------------------------------------------------------------ jornadas
  const jornadasExistentes = await db.select().from(jornadas);
  if (jornadasExistentes.length === 0) {
    const manana = await db
      .insert(jornadas)
      .values({
        nombre: 'Manana',
        inicio: conHora(fecha, 7, 0),
        fin: conHora(fecha, 12, 0),
        ventanaCheckinInicio: conHora(fecha, 6, 30),
        ventanaCheckinFin: conHora(fecha, 9, 0),
        orden: 1,
      })
      .returning({ id: jornadas.id });

    const tarde = await db
      .insert(jornadas)
      .values({
        nombre: 'Tarde',
        inicio: conHora(fecha, 13, 0),
        fin: conHora(fecha, 18, 0),
        ventanaCheckinInicio: conHora(fecha, 12, 30),
        ventanaCheckinFin: conHora(fecha, 14, 30),
        orden: 2,
      })
      .returning({ id: jornadas.id });

    await db.insert(tiposRefrigerio).values([
      { nombre: 'Refrigerio manana', jornadaId: manana[0]!.id, activo: true, orden: 1 },
      { nombre: 'Refrigerio tarde', jornadaId: tarde[0]!.id, activo: true, orden: 2 },
    ]);
  }

  // ---------------------------------------------------------------- asistentes
  const total = entorno.SEED_ASISTENTES;
  if (total > 0) {
    const existentes = await db.select({ total: sql<number>`count(*)::int` }).from(asistentes);
    const yaSembrados = existentes[0]?.total ?? 0;
    if (yaSembrados === 0) {
      const docentes = Math.max(Math.round(total * 0.1), 1);
      const estudiantes = total - docentes;
      const filas = [];

      for (let indice = 0; indice < estudiantes; indice += 1) {
        const numero = String(indice + 1).padStart(5, '0');
        filas.push({
          id: `EST${numero}`,
          nombres: NOMBRES[indice % NOMBRES.length]!,
          apellidos: `${APELLIDOS[indice % APELLIDOS.length]!} ${APELLIDOS[(indice * 7) % APELLIDOS.length]!}`,
          rol: 'estudiante' as const,
          semestre: (indice % 10) + 1,
        });
      }

      for (let indice = 0; indice < docentes; indice += 1) {
        const numero = String(indice + 1).padStart(4, '0');
        filas.push({
          id: `DOC${numero}`,
          nombres: NOMBRES[(indice * 3) % NOMBRES.length]!,
          apellidos: `${APELLIDOS[(indice * 11) % APELLIDOS.length]!} ${APELLIDOS[(indice * 5) % APELLIDOS.length]!}`,
          rol: 'docente' as const,
          semestre: null,
        });
      }

      for (let indice = 0; indice < filas.length; indice += 200) {
        await db
          .insert(asistentes)
          .values(filas.slice(indice, indice + 200))
          .onConflictDoNothing();
      }
    }
  }

  const [final] = await db.select({ total: sql<number>`count(*)::int` }).from(asistentes);
  logger.info(
    { asistentes: final?.total ?? 0, jornada: fecha.toISOString() },
    'Datos de prueba sembrados',
  );
}

async function principal(): Promise<void> {
  await sembrarDatos();
  await pool.end();
}

const invocadoDirectamente =
  process.argv[1] !== undefined && process.argv[1].includes('seed');

if (invocadoDirectamente) {
  principal().catch((error: unknown) => {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Error al sembrar los datos',
    );
    process.exit(1);
  });
}

export { fechaSeminario, conHora };
