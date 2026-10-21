import { Queue, Worker, type Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { logger } from '../config/log.js';
import { db } from '../db/cliente.js';
import { certificadosLotes } from '../db/esquema.js';
import { redis } from '../servicios/cache.js';
import { emitirCertificado } from '../servicios/certificados.js';

export const COLA_CERTIFICADOS = 'certificados-lote';

export interface DatosLote {
  loteId: string;
  asistenteIds: string[];
  adminId: string;
  motivo?: string | null;
}

let cola: Queue | null = null;
let trabajador: Worker | null = null;

function conexionRedis() {
  if (!redis) return null;
  return { host: redis.options.host, port: redis.options.port, password: redis.options.password, db: redis.options.db };
}

export function iniciarColaCertificados(): { cola: Queue | null; trabajador: Worker | null } {
  if (!redis) {
    logger.warn(
      'Redis no disponible: la emision masiva de certificados se procesara en el proceso de la API',
    );
    return { cola: null, trabajador: null };
  }

  const conexion = conexionRedis()!;
  cola = new Queue(COLA_CERTIFICADOS, {
    connection: { ...conexion, maxRetriesPerRequest: null } as never,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: 50,
      removeOnFail: 100,
    },
  });

  trabajador = new Worker(
    COLA_CERTIFICADOS,
    async (job: Job<DatosLote>) => {
      await procesarLote(job.data);
    },
    { connection: { ...conexion, maxRetriesPerRequest: null } as never, concurrency: 2 },
  );

  trabajador.on('failed', (job, error) => {
    logger.error({ jobId: job?.id, error: error.message }, 'Fallo el trabajo de emision de lote');
  });

  logger.info('Cola de emision masiva de certificados iniciada');
  return { cola, trabajador };
}

export async function cerrarColaCertificados(): Promise<void> {
  await trabajador?.close();
  await cola?.close();
  trabajador = null;
  cola = null;
}

/**
 * Procesa un lote emitiendo los certificados uno a uno.
 * Un fallo individual se registra y el lote continua: la emision masiva nunca se detiene.
 */
export async function procesarLote(datos: DatosLote): Promise<void> {
  const { loteId, asistenteIds, adminId, motivo } = datos;
  const errores: { asistenteId: string; mensaje: string }[] = [];
  let exitosos = 0;
  let procesados = 0;

  for (const asistenteId of asistenteIds) {
    try {
      await emitirCertificado(asistenteId, adminId, {
        excepcionManual: motivo ? true : false,
        motivo: motivo ?? undefined,
        loteId,
        regenerar: true,
      });
      exitosos += 1;
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : 'Error desconocido';
      errores.push({ asistenteId, mensaje });
      logger.warn({ asistenteId, error: mensaje }, 'No se pudo emitir un certificado del lote');
    } finally {
      procesados += 1;
      await db
        .update(certificadosLotes)
        .set({
          procesados,
          exitosos,
          fallidos: errores.length,
          errores,
        })
        .where(eq(certificadosLotes.id, loteId));
    }
  }

  await db
    .update(certificadosLotes)
    .set({
      procesados,
      exitosos,
      fallidos: errores.length,
      errores,
      estado: 'completado',
      finalizadoAt: new Date(),
    })
    .where(eq(certificadosLotes.id, loteId));

  logger.info(
    { loteId, total: asistenteIds.length, exitosos, fallidos: errores.length },
    'Lote de certificados finalizado',
  );
}

/**
 * Encola el lote. Si no hay Redis, el lote se procesa en el proceso de la API
 * con la misma mecanica de progreso y reintentos por elemento.
 */
export async function encolarLote(datos: DatosLote): Promise<'cola' | 'en_proceso'> {
  if (cola) {
    await cola.add('emitir-lote', datos, { jobId: datos.loteId });
    return 'cola';
  }

  void procesarLote(datos).catch((error: unknown) => {
    logger.error(
      { error: error instanceof Error ? error.message : String(error), loteId: datos.loteId },
      'Fallo el procesamiento en proceso del lote de certificados',
    );
    void db
      .update(certificadosLotes)
      .set({ estado: 'fallido', finalizadoAt: new Date() })
      .where(eq(certificadosLotes.id, datos.loteId));
  });
  return 'en_proceso';
}

export async function actualizarLote(
  loteId: string,
  datos: Partial<{
    total: number;
    estado: 'en_proceso' | 'completado' | 'fallido';
    motivo: string | null;
  }>,
): Promise<void> {
  await db.update(certificadosLotes).set(datos).where(eq(certificadosLotes.id, loteId));
}
