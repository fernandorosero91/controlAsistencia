import { and, eq, sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { db } from '../db/cliente.js';
import { idempotencia } from '../db/esquema.js';
import { logger } from '../config/log.js';

export interface RespuestaIdempotente<T> {
  codigoHttp: number;
  cuerpo: T;
  repetida: boolean;
}

/**
 * Idempotencia respaldada en base de datos.
 *
 * Si el cliente envia la cabecera Idempotency-Key, la primera peticion guarda la
 * respuesta. Las repeticiones con la misma clave devuelven exactamente la misma
 * respuesta sin volver a ejecutar la operacion. Esto permite que la app del
 * operador reintente sin miedo en redes inestables.
 */
export async function ejecutarConIdempotencia<T>(
  request: FastifyRequest,
  endpoint: string,
  ejecutar: () => Promise<T>,
  codigoHttp = 200,
): Promise<RespuestaIdempotente<T>> {
  const clave = request.headers['idempotency-key'];
  const usuarioId = request.usuario?.id ?? null;

  if (typeof clave !== 'string' || clave.trim().length === 0) {
    const cuerpo = await ejecutar();
    return { codigoHttp, cuerpo, repetida: false };
  }

  const claveNormalizada = clave.trim().slice(0, 200);
  const condiciones = and(
    eq(idempotencia.endpoint, endpoint),
    eq(idempotencia.clave, claveNormalizada),
    usuarioId ? eq(idempotencia.usuarioId, usuarioId) : sql`${idempotencia.usuarioId} IS NULL`,
  );

  const existente = await db
    .select({ codigoHttp: idempotencia.codigoHttp, cuerpo: idempotencia.cuerpo })
    .from(idempotencia)
    .where(condiciones)
    .limit(1);

  if (existente[0]) {
    return {
      codigoHttp: existente[0].codigoHttp,
      cuerpo: existente[0].cuerpo as T,
      repetida: true,
    };
  }

  const cuerpo = await ejecutar();

  try {
    await db
      .insert(idempotencia)
      .values({
        usuarioId,
        endpoint,
        clave: claveNormalizada,
        codigoHttp,
        cuerpo: cuerpo as unknown as Record<string, unknown>,
      })
      .onConflictDoNothing();
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error), endpoint },
      'No se pudo registrar la clave de idempotencia',
    );
  }

  return { codigoHttp, cuerpo, repetida: false };
}
