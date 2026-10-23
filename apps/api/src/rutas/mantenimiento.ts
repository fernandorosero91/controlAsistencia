import argon2 from 'argon2';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { cargarEntorno } from '../config/entorno.js';
import { db } from '../db/cliente.js';
import { usuariosSistema } from '../db/esquema.js';
import { errores } from '../plugins/errores.js';
import { registrarAuditoria } from '../servicios/auditoria.js';
import { invalidarCacheConfiguracion } from '../servicios/configuracion.js';
import { invalidarResumen } from '../servicios/dashboard.js';
import { validarCuerpo } from '../lib/validacion.js';

/**
 * Limpieza de los datos operativos para volver a probar el sistema.
 *
 * Se conservan las cuentas, la configuracion del seminario, las jornadas, los
 * tipos de refrigerio y las plantillas de certificado: son la estructura minima
 * para que el sistema siga funcionando. Se borran el padron, las asistencias,
 * las entregas, los certificados, los lotes (PDF y DOCX), la idempotencia y la
 * auditoria.
 */
export const FRASE_CONFIRMACION = 'BORRAR TODOS LOS DATOS';

export interface ConteosDatos {
  asistentes: number;
  asistencias: number;
  entregas: number;
  certificados: number;
  lotes: number;
  lotesDocx: number;
  auditoria: number;
  idempotencia: number;
}

const limpiezaSchema = z.object({
  password: z.string().min(1, 'La contrasena es obligatoria').max(128),
  confirmacion: z.string().trim(),
});

async function contarDatos(): Promise<ConteosDatos> {
  const resultado = (await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM asistentes) AS asistentes,
      (SELECT count(*)::int FROM asistencias) AS asistencias,
      (SELECT count(*)::int FROM entregas_refrigerio) AS entregas,
      (SELECT count(*)::int FROM certificados) AS certificados,
      (SELECT count(*)::int FROM certificados_lotes) AS lotes,
      (SELECT count(*)::int FROM lotes_certificados_docx) AS "lotesDocx",
      (SELECT count(*)::int FROM auditoria) AS auditoria,
      (SELECT count(*)::int FROM idempotencia) AS idempotencia
  `)) as unknown as { rows: Record<string, number>[] };

  const fila = resultado.rows[0] ?? {};
  return {
    asistentes: Number(fila.asistentes ?? 0),
    asistencias: Number(fila.asistencias ?? 0),
    entregas: Number(fila.entregas ?? 0),
    certificados: Number(fila.certificados ?? 0),
    lotes: Number(fila.lotes ?? 0),
    lotesDocx: Number(fila.lotesDocx ?? 0),
    auditoria: Number(fila.auditoria ?? 0),
    idempotencia: Number(fila.idempotencia ?? 0),
  };
}

export async function registrarRutasMantenimiento(app: FastifyInstance): Promise<void> {
  app.get(
    '/mantenimiento/resumen',
    {
      onRequest: [app.autorizar(['admin'])],
      schema: {
        tags: ['Mantenimiento'],
        description: 'Cuantos registros operativos hay hoy en la base de datos',
      },
    },
    async () => ({
      ...(await contarDatos()),
      fraseConfirmacion: FRASE_CONFIRMACION,
      habilitado: cargarEntorno().LIMPIAR_BASE_HABILITADO === 'true',
    }),
  );

  app.post(
    '/mantenimiento/limpiar',
    {
      onRequest: [app.autorizar(['admin'])],
      schema: {
        tags: ['Mantenimiento'],
        description: 'Borra los datos operativos (padron, registros, certificados y auditoria)',
      },
    },
    async (request, reply) => {
      const entorno = cargarEntorno();
      if (entorno.LIMPIAR_BASE_HABILITADO !== 'true') {
        throw errores.noAutorizado(
          'La limpieza de la base de datos esta deshabilitada en este servidor.',
        );
      }

      const datos = validarCuerpo(limpiezaSchema, request.body);

      if (datos.confirmacion !== FRASE_CONFIRMACION) {
        throw errores.validacion(`Para confirmar escriba exactamente: ${FRASE_CONFIRMACION}`, [
          { campo: 'confirmacion', mensaje: 'La frase de confirmacion no coincide' },
        ]);
      }

      // La contrasena es la del administrador que hace la operacion.
      const usuario = request.usuario!;
      const filas = await db
        .select({ passwordHash: usuariosSistema.passwordHash })
        .from(usuariosSistema)
        .where(eq(usuariosSistema.id, usuario.id))
        .limit(1);

      const hash = filas[0]?.passwordHash;
      let valida = false;
      if (hash) {
        try {
          valida = await argon2.verify(hash, datos.password);
        } catch {
          valida = false;
        }
      }

      if (!valida) {
        // 403 y no 401: un 401 haria que el panel intente renovar la sesion y
        // expulsaria al administrador por un error de digitacion.
        throw errores.noAutorizado('La contrasena del administrador no es correcta.');
      }

      const antes = await contarDatos();

      await db.execute(
        sql.raw(
          `TRUNCATE TABLE entregas_refrigerio, asistencias, certificados, certificados_lotes,
             lotes_certificados_docx, idempotencia, auditoria, asistentes RESTART IDENTITY CASCADE`,
        ),
      );

      await Promise.all([invalidarResumen(), invalidarCacheConfiguracion()]);

      // La auditoria se acaba de borrar: este registro queda como primera fila
      // del nuevo historial y deja constancia de lo que habia antes.
      await registrarAuditoria(request, {
        accion: 'mantenimiento.limpieza',
        entidad: 'base_datos',
        entidadId: null,
        datosAntes: antes,
        datosDespues: { filasBorradas: antes },
      });

      return reply.send({
        limpiado: true,
        filasBorradas: antes,
        mensaje:
          'Se borraron los datos operativos. La configuracion del seminario, las jornadas y las cuentas se conservaron.',
      });
    },
  );
}
