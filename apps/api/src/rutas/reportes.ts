import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { filtrosReporteSchema } from '@seminario/shared';
import { registrarAuditoria } from '../servicios/auditoria.js';
import {
  generarReporte,
  reporteComoCsv,
  reporteComoPdf,
  reporteComoXlsx,
  type TipoReporte,
} from '../servicios/reportes.js';
import { validarConsulta, validarParametros } from '../lib/validacion.js';

const parametrosReporte = z.object({
  tipo: z.enum([
    'asistencia',
    'asistencia-parcial',
    'refrigerios-entregados',
    'refrigerios-pendientes',
    'elegibles',
    'no-elegibles',
    'certificados-emitidos',
    'auditoria',
  ]),
});

export async function registrarRutasReportes(app: FastifyInstance): Promise<void> {
  app.get(
    '/reportes/:tipo',
    {
      onRequest: [app.autorizar(['admin'])],
      schema: {
        tags: ['Reportes'],
        description: 'Reportes con filtros y exportacion en csv, xlsx o pdf',
      },
    },
    async (request, reply) => {
      const { tipo } = validarParametros(parametrosReporte, request.params);
      const filtros = validarConsulta(filtrosReporteSchema, request.query);
      const reporte = await generarReporte(tipo as TipoReporte, filtros);

      await registrarAuditoria(request, {
        accion: 'reporte.exportado',
        entidad: 'reportes',
        entidadId: tipo,
        datosDespues: { formato: filtros.formato, registros: reporte.filas.length },
      });

      const nombreArchivo = `reporte-${tipo}.${filtros.formato}`;

      if (filtros.formato === 'xlsx') {
        const contenido = await reporteComoXlsx(reporte);
        return reply
          .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
          .header('Content-Disposition', `attachment; filename="${nombreArchivo}"`)
          .send(contenido);
      }

      if (filtros.formato === 'pdf') {
        const contenido = await reporteComoPdf(reporte);
        return reply
          .header('Content-Type', 'application/pdf')
          .header('Content-Disposition', `attachment; filename="${nombreArchivo}"`)
          .send(contenido);
      }

      const contenido = reporteComoCsv(reporte);
      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="${nombreArchivo}"`)
        .send(contenido);
    },
  );
}
