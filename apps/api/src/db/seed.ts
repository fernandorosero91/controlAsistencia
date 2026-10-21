import argon2 from 'argon2';
import { sql } from 'drizzle-orm';
import { generarCodigoRegistro } from '@seminario/shared';
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
  'Ana',
  'Andres',
  'Beatriz',
  'Camilo',
  'Carla',
  'Daniel',
  'Diana',
  'Eduardo',
  'Elena',
  'Felipe',
  'Gabriela',
  'Hector',
  'Isabel',
  'Javier',
  'Laura',
  'Manuel',
  'Marcela',
  'Nicolas',
  'Paula',
  'Ricardo',
  'Sofia',
  'Tomas',
  'Valentina',
  'Wilson',
  'Ximena',
  'Yolanda',
  'Zulma',
  'Sebastian',
  'Lucia',
  'Mateo',
];

const APELLIDOS = [
  'Acosta',
  'Benitez',
  'Cardona',
  'Duarte',
  'Escobar',
  'Franco',
  'Giraldo',
  'Henao',
  'Jaramillo',
  'Lopez',
  'Mejia',
  'Navarro',
  'Ochoa',
  'Pelaez',
  'Quintero',
  'Restrepo',
  'Sandoval',
  'Torres',
  'Uribe',
  'Valencia',
  'Zapata',
  'Montoya',
  'Ospina',
  'Piedrahita',
  'Cataño',
  'Bedoya',
  'Arango',
  'Castillo',
  'Gallego',
  'Hoyos',
];

/** Fecha del seminario configurada para el evento. */
function fechaSeminario(): Date {
  const entorno = cargarEntorno();
  return new Date(`${entorno.SEMINARIO_FECHA}T12:00:00.000Z`);
}

/** Convierte una hora local de Bogota (UTC-5) a una marca de tiempo UTC. */
function conHora(fecha: Date, hora: number, minuto = 0): Date {
  const anio = fecha.getUTCFullYear();
  const mes = fecha.getUTCMonth();
  const dia = fecha.getUTCDate();
  // Bogota es UTC-5 todo el ano (no aplica horario de verano).
  return new Date(Date.UTC(anio, mes, dia, hora + 5, minuto));
}

function horaDesdeTexto(texto: string): { hora: number; minuto: number } {
  const [hora = '0', minuto = '0'] = texto.split(':');
  return { hora: Number(hora), minuto: Number(minuto) };
}

export interface OpcionesSembrado {
  /** Cantidad de asistentes ficticios. Por defecto toma SEED_ASISTENTES. */
  asistentes?: number;
  /** Aplicar migraciones antes de sembrar. El arranque de la API ya las aplica. */
  migrar?: boolean;
  /** Dominio de los correos de los operadores. Por defecto el de ADMIN_EMAIL. */
  dominioCorreo?: string;
}

export async function sembrarDatos(opciones: OpcionesSembrado = {}): Promise<void> {
  const entorno = cargarEntorno();

  if (opciones.migrar !== false) {
    await aplicarMigraciones();
  }

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
  // Los operadores viven en el mismo dominio del administrador, para que los
  // correos sean coherentes con la institucion (operador1@dominio, ...).
  const dominioCorreo =
    opciones.dominioCorreo ?? entorno.ADMIN_EMAIL.split('@')[1] ?? 'seminario.local';
  for (let indice = 1; indice <= entorno.ADMIN_OPERADORES; indice += 1) {
    await db
      .insert(usuariosSistema)
      .values({
        nombre: `Operador ${indice}`,
        email: `operador${indice}@${dominioCorreo}`.toLowerCase(),
        passwordHash: hashOperador,
        rol: 'operador',
      })
      .onConflictDoNothing();
  }

  // ------------------------------------------------------- configuracion general
  const fecha = fechaSeminario();
  const inicio = horaDesdeTexto(entorno.SEMINARIO_HORA_INICIO);
  const fin = horaDesdeTexto(entorno.SEMINARIO_HORA_FIN);
  const duracionTotal = fin.hora + fin.minuto / 60 - (inicio.hora + inicio.minuto / 60);
  const mitad = Math.round(duracionTotal / 2);
  const horaMedio = inicio.hora + mitad;
  const horaFin = conHora(fecha, fin.hora, fin.minuto);

  await db
    .insert(seminarioConfig)
    .values({
      id: 1,
      nombre: entorno.SEMINARIO_NOMBRE,
      fecha: fecha.toISOString().slice(0, 10),
      horaFinSeminario: horaFin,
      toleranciaMinutos: entorno.SEMINARIO_TOLERANCIA_MINUTOS,
      exigirAmbasJornadas: true,
      intensidadHoraria: Math.round(duracionTotal),
      permitirRegistroFueraDeVentana: false,
      textoEncabezado: `${entorno.SEMINARIO_FACULTAD} - Universidad Cooperativa de Colombia certifica la participacion en el ${entorno.SEMINARIO_NOMBRE}.`,
      textoCierre: `Realizado el ${entorno.SEMINARIO_FECHA.split('-').reverse().join('/')} en ${entorno.SEMINARIO_LUGAR}. Informacion: ${entorno.SEMINARIO_CONTACTO}.`,
      lugar: entorno.SEMINARIO_LUGAR,
      facultad: entorno.SEMINARIO_FACULTAD,
      contacto: entorno.SEMINARIO_CONTACTO,
      firmaNombre: 'Coordinacion de la Facultad de Ingenieria',
      firmaCargo: entorno.SEMINARIO_FACULTAD,
      firmas: [
        {
          nombre: 'Coordinacion de la Facultad de Ingenieria',
          cargo: 'Facultad de Ingenieria',
          entidad: 'Universidad Cooperativa de Colombia',
        },
        {
          nombre: 'Direccion del Programa de Ingenieria de Software',
          cargo: 'Programa de Ingenieria de Software',
          entidad: 'Universidad Cooperativa de Colombia',
        },
        {
          nombre: 'Coordinacion de Eventos Academicos',
          cargo: 'Eventos academicos',
          entidad: 'Universidad Cooperativa de Colombia',
        },
      ],
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
        inicio: conHora(fecha, inicio.hora, inicio.minuto),
        fin: conHora(fecha, horaMedio, 0),
        ventanaCheckinInicio: conHora(fecha, Math.max(inicio.hora - 30, 0), inicio.minuto),
        ventanaCheckinFin: conHora(fecha, inicio.hora + 60, inicio.minuto),
        orden: 1,
      })
      .returning({ id: jornadas.id });

    const tarde = await db
      .insert(jornadas)
      .values({
        nombre: 'Tarde',
        inicio: conHora(fecha, horaMedio, 0),
        fin: conHora(fecha, fin.hora, fin.minuto),
        ventanaCheckinInicio: conHora(fecha, Math.max(horaMedio - 30, 0), 0),
        ventanaCheckinFin: conHora(fecha, horaMedio + 60, 0),
        orden: 2,
      })
      .returning({ id: jornadas.id });

    await db.insert(tiposRefrigerio).values([
      { nombre: 'Refrigerio manana', jornadaId: manana[0]!.id, activo: true, orden: 1 },
      { nombre: 'Refrigerio tarde', jornadaId: tarde[0]!.id, activo: true, orden: 2 },
    ]);
  }

  // ---------------------------------------------------------------- asistentes
  const total = opciones.asistentes ?? entorno.SEED_ASISTENTES;
  if (total > 0) {
    const existentes = await db.select({ total: sql<number>`count(*)::int` }).from(asistentes);
    const yaSembrados = existentes[0]?.total ?? 0;
    if (yaSembrados === 0) {
      const docentes = Math.max(Math.round(total * 0.1), 1);
      const estudiantes = total - docentes;
      const filas = [];
      const codigosUsados = new Set<string>();

      const generarCodigoUnico = (): string => {
        for (let intento = 0; intento < 50; intento += 1) {
          const codigo = generarCodigoRegistro();
          if (!codigosUsados.has(codigo)) {
            codigosUsados.add(codigo);
            return codigo;
          }
        }
        throw new Error('No fue posible generar un codigo de registro unico para el sembrado');
      };

      for (let indice = 0; indice < estudiantes; indice += 1) {
        const numero = String(indice + 1).padStart(5, '0');
        filas.push({
          id: `EST${numero}`,
          codigoRegistro: generarCodigoUnico(),
          email: `estudiante${numero}@seminario.local`,
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
          codigoRegistro: generarCodigoUnico(),
          email: `docente${numero}@seminario.local`,
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
    'Datos iniciales sembrados',
  );
}

async function principal(): Promise<void> {
  await sembrarDatos();
  await pool.end();
}

const invocadoDirectamente = process.argv[1] !== undefined && process.argv[1].includes('seed');

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
