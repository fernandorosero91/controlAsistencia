import JSZip from 'jszip';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  emitirCertificadoSchema,
  emitirLoteSchema,
  filtrosCertificadosSchema,
  revocarCertificadoSchema,
} from '@seminario/shared';
import { db } from '../db/cliente.js';
import { asistentes, certificados, certificadosLotes } from '../db/esquema.js';import { errores } from '../plugins/errores.js';
import { registrarAuditoria } from '../servicios/auditoria.js';
import { ejecutarConIdempotencia } from '../servicios/idempotencia.js';
import {
  emitirCertificado,
  listarAsistentesElegibles,
  listarCertificados,
  obtenerPdfCertificado,
  obtenerProgresoLote,
  revocarCertificado,
} from '../servicios/certificados.js';
import { encolarLote } from '../trabajos/loteCertificados.js';
import { validarCuerpo, validarConsulta, validarParametros } from '../lib/validacion.js';

const parametrosAsistente = z.object({ asistenteId: z.string().min(1).max(32) });
const parametrosCertificado = z.object({ id: z.string().uuid('El identificador no es valido') });
const parametrosLote = z.object({ loteId: z.string().uuid('El identificador del lote no es valido') });

export async function registrarRutasCertificados(app: FastifyInstance): Promise<void> {
  app.get(
    '/certificados',
    {
      onRequest: [app.autorizar(['admin'])],
      schema: {
        tags: ['Certificados'],
        description: 'Listado de asistentes con su estado de certificado y elegibilidad',
      },
    },
    async (request) => {
      const filtros = validarConsulta(filtrosCertificadosSchema, request.query);
      const { datos, total } = await listarCertificados(filtros);
      return {
        datos,
        pagina: filtros.pagina,
        porPagina: filtros.porPagina,
        total,
        totalPaginas: Math.ceil(total / filtros.porPagina),
      };
    },
  );

  app.post(
    '/certificados/emitir/:asistenteId',
    {
      onRequest: [app.autorizar(['admin'])],
      schema: {
        tags: ['Certificados'],
        description: 'Emite el certificado de un asistente elegible (admin)',
      },
    },
    async (request, reply) => {
      const { asistenteId } = validarParametros(parametrosAsistente, request.params);
      const cuerpo = request.body as {
        excepcionManual?: boolean;
        motivo?: string;
        regenerar?: boolean;
      };
      const datos = validarCuerpo(emitirCertificadoSchema, cuerpo);
      const admin = request.usuario!;

      const resultado = await ejecutarConIdempotencia(request, `certificados/emitir/${asistenteId}`, () =>
        emitirCertificado(asistenteId, admin.id, {
          excepcionManual: datos.excepcionManual,
          motivo: datos.motivo,
          regenerar: cuerpo.regenerar === true,
        }),
      );

      await registrarAuditoria(request, {
        accion: 'certificado.emitido',
        entidad: 'certificados',
        entidadId: asistenteId,
        datosDespues: {
          codigoVerificacion: resultado.cuerpo.codigoVerificacion,
          excepcionManual: datos.excepcionManual,
          motivo: datos.motivo ?? null,
        },
      });

      return reply.code(resultado.codigoHttp).send(resultado.cuerpo);
    },
  );

  app.post(
    '/certificados/emitir-lote',
    {
      onRequest: [app.autorizar(['admin'])],
      schema: {
        tags: ['Certificados'],
        description: 'Emite en lote los certificados de todos los asistentes elegibles (admin)',
      },
    },
    async (request, reply) => {
      const datos = validarCuerpo(emitirLoteSchema, request.body ?? {});
      const admin = request.usuario!;

      const elegibles = await listarAsistentesElegibles();
      if (elegibles.length === 0) {
        throw errores.conflicto('No hay asistentes elegibles para emitir certificados');
      }

      const insertados = await db
        .insert(certificadosLotes)
        .values({
          solicitadoPor: admin.id,
          estado: 'en_proceso',
          total: elegibles.length,
          procesados: 0,
          exitosos: 0,
          fallidos: 0,
          motivo: datos.motivo ?? null,
        })
        .returning({ id: certificadosLotes.id });

      const loteId = insertados[0]!.id;

      const modo = await encolarLote({
        loteId,
        asistenteIds: elegibles,
        adminId: admin.id,
        motivo: datos.motivo ?? null,
      });

      await registrarAuditoria(request, {
        accion: 'certificado.lote',
        entidad: 'certificados_lotes',
        entidadId: loteId,
        datosDespues: { total: elegibles.length, modo },
      });

      return reply.status(202).send({ loteId, total: elegibles.length, modo });
    },
  );

  app.get(
    '/certificados/lote/:loteId',
    {
      onRequest: [app.autorizar(['admin'])],
      schema: { tags: ['Certificados'], description: 'Progreso de un lote de emision' },
    },
    async (request) => {
      const { loteId } = validarParametros(parametrosLote, request.params);
      return obtenerProgresoLote(loteId);
    },
  );

  app.get(
    '/certificados/lote/:loteId/descarga',
    {
      onRequest: [app.autorizar(['admin'])],
      schema: {
        tags: ['Certificados'],
        description: 'Descarga el lote de certificados como archivo ZIP (admin)',
      },
    },
    async (request, reply) => {
      const { loteId } = validarParametros(parametrosLote, request.params);
      const progreso = await obtenerProgresoLote(loteId);

      const certificadosLote = await db
        .select({
          asistenteId: certificados.asistenteId,
          codigoVerificacion: certificados.codigoVerificacion,
          emitidoPor: certificados.emitidoPor,
        })
        .from(certificados)
        .where(
          and(eq(certificados.loteId, loteId), eq(certificados.revocado, false)),
        );

      if (certificadosLote.length === 0) {
        throw errores.noEncontrado('El lote no tiene certificados emitidos todavia');
      }

      const zip = new JSZip();
      for (const certificado of certificadosLote) {
        try {
          const { pdf } = await obtenerPdfCertificado(certificado.asistenteId);
          zip.file(`certificado-${certificado.asistenteId}.pdf`, pdf);
        } catch (error) {
          request.log.warn(
            { asistenteId: certificado.asistenteId, error },
            'No se pudo adjuntar un certificado al ZIP',
          );
        }
      }

      if (certificadosLote.length === 0) {
        throw errores.noEncontrado('El lote no tiene certificados emitidos todavia');
      }

      const contenido = await zip.generateAsync({ type: 'nodebuffer' });
      return reply
        .header('Content-Type', 'application/zip')
        .header(
          'Content-Disposition',
          `attachment; filename="certificados-lote-${loteId}.zip"`,
        )
        .send(contenido);
    },
  );

  app.get(
    '/certificados/:asistenteId/pdf',
    {
      onRequest: [app.autorizar(['admin'])],
      schema: {
        tags: ['Certificados'],
        description: 'Descarga el PDF del certificado de un asistente (admin)',
      },
    },
    async (request, reply) => {
      const { asistenteId } = validarParametros(parametrosAsistente, request.params);
      const { pdf, codigoVerificacion } = await obtenerPdfCertificado(asistenteId);
      return reply
        .header('Content-Type', 'application/pdf')
        .header(
          'Content-Disposition',
          `attachment; filename="certificado-${asistenteId}.pdf"`,
        )
        .send(pdf);
    },
  );

  app.post(
    '/certificados/:id/revocar',
    {
      onRequest: [app.autorizar(['admin'])],
      schema: { tags: ['Certificados'], description: 'Revoca un certificado emitido (admin)' },
    },
    async (request) => {
      const { id } = validarParametros(parametrosCertificado, request.params);
      const datos = validarCuerpo(revocarCertificadoSchema, request.body);
      const admin = request.usuario!;

      const existentes = await db
        .select()
        .from(certificados)
        .where(eq(certificados.id, id))
        .limit(1);
      const certificado = existentes[0];
      if (!certificado) throw errores.noEncontrado('El certificado no existe');

      await revocarCertificado(id, datos.motivo, admin.id);

      await registrarAuditoria(request, {
        accion: 'certificado.revocado',
        entidad: 'certificados',
        entidadId: id,
        datosAntes: { revocado: false, asistenteId: certificado.asistenteId },
        datosDespues: { revocado: true, motivo: datos.motivo },
      });

      return { revocado: true };
    },
  );
}
