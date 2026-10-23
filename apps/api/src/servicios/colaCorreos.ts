import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { cargarEntorno } from '../config/entorno.js';
import { logger } from '../config/log.js';
import { enviarQrPorCorreo } from './correo.js';
import { generarEscarapelaPDF } from './pdf.js';

/**
 * Cola de envio de correos con la credencial.
 *
 * Enviar cientos de correos dentro de la peticion HTTP satura el servidor SMTP
 * y bloquea la respuesta. Con BullMQ sobre el Redis que ya usa el sistema, cada
 * correo es un trabajo independiente: se procesan con concurrencia y ritmo
 * limitados, se reintentan si el servidor de correo falla, y el panel puede
 * consultar el avance. No hace falta RabbitMQ: es la misma garantia (cola
 * persistente, reintentos, ritmo) sobre la infraestructura existente.
 */

const NOMBRE_COLA = 'correos-credencial';
const PREFIJO_LOTE = 'correos:lote:';
const VIGENCIA_LOTE_SEGUNDOS = 7 * 24 * 60 * 60;

export interface DestinoCorreoQr {
  asistenteId: string;
  destinatario: string;
  nombres: string;
  apellidos: string;
  rol: 'estudiante' | 'docente';
  codigoRegistro: string;
  idInstitucional: string;
  cedulaCiudadania: string | null;
  email: string;
  nombreSeminario: string;
  facultad: string | null;
  fecha: string | null;
  lugar: string | null;
  contacto: string | null;
}

export interface EstadoLoteCorreos {
  loteId: string;
  total: number;
  enviados: number;
  fallidos: number;
  pendientes: number;
  estado: 'en_proceso' | 'completado' | 'desconocido';
}

interface TrabajoCorreo {
  loteId: string;
  destino: DestinoCorreoQr;
}

let cola: Queue<TrabajoCorreo> | null = null;
let trabajador: Worker<TrabajoCorreo> | null = null;
let cliente: Redis | null = null;
let inicializacionIntentada = false;
let disponible = false;

function conexion(): Redis | null {
  const entorno = cargarEntorno();
  if (!entorno.REDIS_URL) return null;

  // BullMQ exige maxRetriesPerRequest en null para sus conexiones de bloqueo.
  return new Redis(entorno.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: false,
  });
}

function claveLote(loteId: string): string {
  return `${PREFIJO_LOTE}${loteId}`;
}

async function iniciar(): Promise<void> {
  if (inicializacionIntentada) return;
  inicializacionIntentada = true;

  const entorno = cargarEntorno();
  if (!entorno.SMTP_HOST) {
    logger.info('Cola de correos inactiva: SMTP no configurado');
    return;
  }

  const conexionCola = conexion();
  if (!conexionCola) {
    logger.info('Cola de correos inactiva: REDIS_URL no configurado');
    return;
  }

  try {
    cliente = conexionCola;
    const conexionTrabajador = conexion()!;

    cola = new Queue<TrabajoCorreo>(NOMBRE_COLA, { connection: conexionCola });

    trabajador = new Worker<TrabajoCorreo>(
      NOMBRE_COLA,
      async (trabajo: Job<TrabajoCorreo>) => {
        const { loteId, destino } = trabajo.data;

        const pdf = await generarEscarapelaPDF({
          asistente: {
            id: destino.idInstitucional,
            nombres: destino.nombres,
            apellidos: destino.apellidos,
            rol: destino.rol,
            semestre: null,
          },
          codigoRegistro: destino.codigoRegistro,
          idInstitucional: destino.idInstitucional,
          cedulaCiudadania: destino.cedulaCiudadania,
          email: destino.email,
          nombreSeminario: destino.nombreSeminario,
          facultad: destino.facultad,
          fecha: destino.fecha,
          lugar: destino.lugar,
        });

        const resultado = await enviarQrPorCorreo({
          destinatario: destino.destinatario,
          nombre: `${destino.nombres} ${destino.apellidos}`,
          codigoRegistro: destino.codigoRegistro,
          idInstitucional: destino.idInstitucional,
          nombreSeminario: destino.nombreSeminario,
          pdfEscarapela: Buffer.from(pdf),
          facultad: destino.facultad,
          fecha: destino.fecha,
          lugar: destino.lugar,
          contacto: destino.contacto,
        });

        if (!resultado.enviado) {
          // Se lanza para que BullMQ aplique el reintento con espera.
          throw new Error(resultado.mensaje);
        }

        await registrarAvance(loteId, 'enviados');
        return { enviado: true };
      },
      {
        connection: conexionTrabajador,
        concurrency: entorno.CORREOS_CONCURRENCIA,
        limiter: {
          max: entorno.CORREOS_POR_SEGUNDO,
          duration: 1000,
        },
      },
    );

    trabajador.on('failed', (trabajo, error) => {
      if (!trabajo) return;
      const intentos = trabajo.opts.attempts ?? 1;
      logger.warn(
        { lote: trabajo.data.loteId, intento: trabajo.attemptsMade, error: error.message },
        'Fallo el envio de un correo',
      );
      if (trabajo.attemptsMade >= intentos) {
        void registrarAvance(trabajo.data.loteId, 'fallidos');
      }
    });

    trabajador.on('error', (error) => {
      logger.error({ error: error.message }, 'Error en la cola de correos');
    });

    disponible = true;
    logger.info(
      {
        concurrencia: entorno.CORREOS_CONCURRENCIA,
        porSegundo: entorno.CORREOS_POR_SEGUNDO,
        intentos: entorno.CORREOS_INTENTOS,
      },
      'Cola de correos iniciada',
    );
  } catch (error) {
    disponible = false;
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'No se pudo iniciar la cola de correos: se enviara de forma directa',
    );
  }
}

async function registrarAvance(loteId: string, campo: 'enviados' | 'fallidos'): Promise<void> {
  if (!cliente) return;

  const clave = claveLote(loteId);
  await cliente.hincrby(clave, campo, 1);

  const [enviados, fallidos, total] = await Promise.all([
    cliente.hget(clave, 'enviados'),
    cliente.hget(clave, 'fallidos'),
    cliente.hget(clave, 'total'),
  ]);

  if (Number(enviados ?? 0) + Number(fallidos ?? 0) >= Number(total ?? 0)) {
    await cliente.hset(clave, 'estado', 'completado');
  }

  await cliente.expire(clave, VIGENCIA_LOTE_SEGUNDOS);
}

/** Indica si la cola esta operativa (SMTP + Redis disponibles). */
export function colaDeCorreosDisponible(): boolean {
  return disponible;
}

/**
 * Encola un correo por destinatario. Devuelve el identificador del lote para
 * consultar el avance, o null si la cola no esta disponible.
 */
export async function encolarCorreosCredencial(
  destinos: DestinoCorreoQr[],
): Promise<string | null> {
  await iniciar();
  if (!disponible || !cola || !cliente || destinos.length === 0) return null;

  const entorno = cargarEntorno();
  const loteId = randomUUID();

  await cliente.hset(claveLote(loteId), {
    total: String(destinos.length),
    enviados: '0',
    fallidos: '0',
    estado: 'en_proceso',
  });
  await cliente.expire(claveLote(loteId), VIGENCIA_LOTE_SEGUNDOS);

  await cola.addBulk(
    destinos.map((destino) => ({
      name: 'credencial',
      data: { loteId, destino },
      opts: {
        jobId: `${loteId}-${destino.asistenteId}`,
        attempts: entorno.CORREOS_INTENTOS,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { age: 24 * 60 * 60, count: 5000 },
        removeOnFail: { age: 7 * 24 * 60 * 60, count: 5000 },
      },
    })),
  );

  return loteId;
}

/** Avance del lote. Devuelve null si el lote no existe o la cola esta apagada. */
export async function estadoLoteCorreos(loteId: string): Promise<EstadoLoteCorreos | null> {
  await iniciar();
  if (!disponible || !cliente) return null;

  const datos = await cliente.hgetall(claveLote(loteId));
  if (!datos || Object.keys(datos).length === 0) return null;

  const total = Number(datos.total ?? 0);
  const enviados = Number(datos.enviados ?? 0);
  const fallidos = Number(datos.fallidos ?? 0);
  const pendientes = Math.max(total - enviados - fallidos, 0);

  return {
    loteId,
    total,
    enviados,
    fallidos,
    pendientes,
    estado: pendientes === 0 ? 'completado' : 'en_proceso',
  };
}

export async function cerrarColaCorreos(): Promise<void> {
  try {
    await trabajador?.close();
    await cola?.close();
    await cliente?.quit();
  } catch {
    // El cierre es best-effort: no debe impedir que la API termine.
  } finally {
    trabajador = null;
    cola = null;
    cliente = null;
    disponible = false;
    inicializacionIntentada = false;
  }
}
