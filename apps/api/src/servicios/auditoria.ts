import type { FastifyRequest } from 'fastify';
import { db } from '../db/cliente.js';
import { auditoria } from '../db/esquema.js';
import { logger } from '../config/log.js';

export type AccionAuditada =
  | 'auth.login'
  | 'auth.logout'
  | 'auth.refresh'
  | 'asistente.creado'
  | 'asistente.actualizado'
  | 'asistente.importado'
  | 'asistencia.ingreso'
  | 'asistencia.salida'
  | 'asistencia.excepcion'
  | 'refrigerio.entregado'
  | 'config.actualizada'
  | 'config.accesos_operador'
  | 'jornada.creada'
  | 'jornada.actualizada'
  | 'jornada.eliminada'
  | 'certificado.emitido'
  | 'certificado.revocado'
  | 'certificado.lote'
  | 'plantilla.creada'
  | 'plantilla.actualizada'
  | 'plantilla.eliminada'
  | 'plantilla.generados'
  | 'plantilla.lote_descargado'
  | 'plantilla.lote_eliminado'
  | 'usuario.creado'
  | 'usuario.actualizado'
  | 'mantenimiento.limpieza'
  | 'reporte.exportado';

export interface EventoAuditoria {
  accion: AccionAuditada;
  entidad: string;
  entidadId?: string | null;
  datosAntes?: unknown;
  datosDespues?: unknown;
  usuarioId?: string | null;
  usuarioNombre?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Registra una accion sensible en la tabla de auditoria.
 * Los fallos de auditoria no invalidan la operacion de negocio, pero quedan en el log.
 */
export async function registrarAuditoria(
  request: FastifyRequest,
  evento: EventoAuditoria,
): Promise<void> {
  const ip = request.ip ?? null;
  const userAgent = request.headers['user-agent'] ?? null;
  try {
    await db.insert(auditoria).values({
      usuarioId: evento.usuarioId ?? request.usuario?.id ?? null,
      usuarioNombre: evento.usuarioNombre ?? request.usuario?.nombre ?? null,
      accion: evento.accion,
      entidad: evento.entidad,
      entidadId: evento.entidadId ?? null,
      datosAntes: (evento.datosAntes ?? null) as Record<string, unknown> | null,
      datosDespues: (evento.datosDespues ?? null) as Record<string, unknown> | null,
      ip,
      userAgent: typeof userAgent === 'string' ? userAgent : null,
    });
  } catch (error) {
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        accion: evento.accion,
        entidad: evento.entidad,
      },
      'No se pudo escribir el registro de auditoria',
    );
  }
}
