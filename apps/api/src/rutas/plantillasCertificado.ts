import JSZip from 'jszip';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  actualizarPlantillaSchema,
  generarDesdePlantillaSchema,
} from '@seminario/shared';
import { cargarEntorno } from '../config/entorno.js';
import { registrarAuditoria } from '../servicios/auditoria.js';
import {
  actualizarPlantilla,
  crearPlantilla,
  eliminarLote,
  eliminarPlantilla,
  generarCertificados,
  generarLotePersistido,
  leerZipLote,
  listarElegibilidad,
  listarLotes,
  listarPlantillas,
  obtenerLote,
  obtenerPlantilla,
} from '../servicios/plantillasCertificado.js';
import { errores } from '../plugins/errores.js';
import { validarConsulta, validarCuerpo, validarParametros } from '../lib/validacion.js';

const parametrosPlantilla = z.object({ id: z.string().uuid('La plantilla no es valida') });
const parametrosLote = z.object({ id: z.string().uuid('El lote no es valido') });
const filtrosElegibilidad = z.object({ rol: z.enum(['estudiante', 'docente']).optional() });

export async function registrarRutasPlantillas(app: FastifyInstance): Promise<void> {
  app.get(
    '/plantillas-certificado',
    {
      onRequest: [app.autorizar(['admin'])],
      schema: {
        tags: ['Plantillas de certificado'],
        description: 'Listado de plantillas .docx cargadas (admin)',
      },
    },
    async (request) => {
      const consulta = request.query as { soloActivas?: string };
      const soloActivas = consulta.soloActivas === 'true';
      const datos = await listarPlantillas(soloActivas);
      return { datos, total: datos.length };
    },
  );

  app.get(
    '/plantillas-certificado/:id',
    {
      onRequest: [app.autorizar(['admin'])],
      schema: {
        tags: ['Plantillas de certificado'],
        description: 'Detalle de una plantilla .docx (admin)',
      },
    },
    async (request) => {
      const { id } = validarParametros(parametrosPlantilla, request.params);
      return obtenerPlantilla(id);
    },
  );

  app.post(
    '/plantillas-certificado',
    {
      onRequest: [app.autorizar(['admin'])],
      schema: {
        tags: ['Plantillas de certificado'],
        description: 'Carga una plantilla .docx con los campos {{nombre}}, {{cedula}}, etc. (admin)',
      },
    },
    async (request, reply) => {
      const entorno = cargarEntorno();
      const archivo = await request.file({ limits: { fileSize: entorno.UPLOAD_MAX_BYTES } });
      if (!archivo) {
        throw errores.validacion('Debe adjuntar la plantilla .docx');
      }

      const extension = archivo.filename.toLowerCase().split('.').pop();
      if (extension !== 'docx') {
        throw errores.validacion('La plantilla debe ser un archivo .docx');
      }

      const buffer = await archivo.toBuffer();
      if (buffer.length === 0) {
        throw errores.validacion('El archivo esta vacio');
      }

      const campos = archivo.fields as Record<string, { value?: unknown } | undefined>;
      const nombreCampo = campos.nombre?.value;
      const nombre =
        typeof nombreCampo === 'string' && nombreCampo.trim().length >= 3
          ? nombreCampo.trim().slice(0, 120)
          : archivo.filename.replace(/\.docx$/i, '').slice(0, 120);

      const admin = request.usuario!;
      const plantilla = await crearPlantilla({
        nombre,
        nombreArchivo: archivo.filename,
        contenido: buffer,
        creadoPor: admin.id,
      });

      await registrarAuditoria(request, {
        accion: 'plantilla.creada',
        entidad: 'plantillas_certificado',
        entidadId: plantilla.id,
        datosDespues: { nombre: plantilla.nombre, campos: plantilla.camposDetectados },
      });

      return reply.status(201).send(plantilla);
    },
  );

  app.patch(
    '/plantillas-certificado/:id',
    {
      onRequest: [app.autorizar(['admin'])],
      schema: {
        tags: ['Plantillas de certificado'],
        description: 'Actualiza los metadatos de una plantilla (admin)',
      },
    },
    async (request) => {
      const { id } = validarParametros(parametrosPlantilla, request.params);
      const datos = validarCuerpo(actualizarPlantillaSchema, request.body);
      const plantilla = await actualizarPlantilla(id, datos);

      await registrarAuditoria(request, {
        accion: 'plantilla.actualizada',
        entidad: 'plantillas_certificado',
        entidadId: id,
        datosDespues: { ...datos },
      });

      return plantilla;
    },
  );

  app.delete(
    '/plantillas-certificado/:id',
    {
      onRequest: [app.autorizar(['admin'])],
      schema: {
        tags: ['Plantillas de certificado'],
        description: 'Elimina una plantilla .docx (admin)',
      },
    },
    async (request) => {
      const { id } = validarParametros(parametrosPlantilla, request.params);
      await eliminarPlantilla(id);

      await registrarAuditoria(request, {
        accion: 'plantilla.eliminada',
        entidad: 'plantillas_certificado',
        entidadId: id,
      });

      return { eliminada: true };
    },
  );

  app.get(
    '/plantillas-certificado/elegibilidad',
    {
      onRequest: [app.autorizar(['admin'])],
      schema: {
        tags: ['Plantillas de certificado'],
        description:
          'Elegibilidad del padron: solo es elegible quien tiene ingreso y salida en cada jornada (admin)',
      },
    },
    async (request) => {
      const filtros = validarConsulta(filtrosElegibilidad, request.query);
      return listarElegibilidad(filtros);
    },
  );

  app.post(
    '/plantillas-certificado/generar',
    {
      onRequest: [app.autorizar(['admin'])],
      schema: {
        tags: ['Plantillas de certificado'],
        description:
          'Genera y persiste los certificados .docx elegibles en la carpeta certificadosGenerados (admin)',
      },
    },
    async (request, reply) => {
      const admin = request.usuario!;
      const datos = validarCuerpo(generarDesdePlantillaSchema, request.body);

      const { lote, resumen } = await generarLotePersistido({ ...datos, generadoPor: admin.id });

      await registrarAuditoria(request, {
        accion: 'plantilla.generados',
        entidad: 'lotes_certificados_docx',
        entidadId: lote.id,
        datosDespues: {
          plantillaId: datos.plantillaId,
          total: resumen.total,
          generados: resumen.generados,
          omitidos: resumen.omitidos,
        },
      });

      return reply.status(201).send({ lote, resumen });
    },
  );

  app.get(
    '/plantillas-certificado/lotes',
    {
      onRequest: [app.autorizar(['admin'])],
      schema: {
        tags: ['Plantillas de certificado'],
        description: 'Listado de lotes de certificados .docx generados (admin)',
      },
    },
    async () => {
      const datos = await listarLotes();
      return { datos, total: datos.length };
    },
  );

  app.get(
    '/plantillas-certificado/lotes/:id',
    {
      onRequest: [app.autorizar(['admin'])],
      schema: {
        tags: ['Plantillas de certificado'],
        description: 'Detalle de un lote de certificados .docx (admin)',
      },
    },
    async (request) => {
      const { id } = validarParametros(parametrosLote, request.params);
      return obtenerLote(id);
    },
  );

  app.get(
    '/plantillas-certificado/lotes/:id/descarga',
    {
      onRequest: [app.autorizar(['admin'])],
      schema: {
        tags: ['Plantillas de certificado'],
        description: 'Descarga el ZIP con los certificados .docx de un lote (admin)',
      },
    },
    async (request, reply) => {
      const { id } = validarParametros(parametrosLote, request.params);
      const { lote, contenido } = await leerZipLote(id);

      await registrarAuditoria(request, {
        accion: 'plantilla.lote_descargado',
        entidad: 'lotes_certificados_docx',
        entidadId: lote.id,
        datosDespues: { generados: lote.generados },
      });

      return reply
        .header('Content-Type', 'application/zip')
        .header(
          'Content-Disposition',
          `attachment; filename="certificados-generados-${lote.id}.zip"`,
        )
        .send(contenido);
    },
  );

  app.delete(
    '/plantillas-certificado/lotes/:id',
    {
      onRequest: [app.autorizar(['admin'])],
      schema: {
        tags: ['Plantillas de certificado'],
        description: 'Elimina un lote de certificados y su carpeta en disco (admin)',
      },
    },
    async (request) => {
      const { id } = validarParametros(parametrosLote, request.params);
      await eliminarLote(id);

      await registrarAuditoria(request, {
        accion: 'plantilla.lote_eliminado',
        entidad: 'lotes_certificados_docx',
        entidadId: id,
      });

      return { eliminado: true };
    },
  );

  app.post(
    '/plantillas-certificado/generar/descarga',
    {
      onRequest: [app.autorizar(['admin'])],
      schema: {
        tags: ['Plantillas de certificado'],
        description: 'Genera los certificados .docx y los empaqueta en un ZIP descargable (admin)',
      },
    },
    async (request, reply) => {
      const datos = validarCuerpo(generarDesdePlantillaSchema, request.body);
      const { generados, resumen } = await generarCertificados(datos);
      if (generados.length === 0) {
        throw errores.conflicto(
          'No hay asistentes elegibles: se requiere ingreso y salida en cada jornada.',
        );
      }

      const zip = new JSZip();
      for (const certificado of generados) {
        zip.file(certificado.archivo, certificado.contenido);
      }
      const contenido = await zip.generateAsync({ type: 'nodebuffer' });

      await registrarAuditoria(request, {
        accion: 'plantilla.generados',
        entidad: 'plantillas_certificado',
        entidadId: datos.plantillaId,
        datosDespues: {
          total: resumen.total,
          generados: resumen.generados,
          omitidos: resumen.omitidos,
          descarga: true,
        },
      });

      return reply
        .header('Content-Type', 'application/zip')
        .header(
          'Content-Disposition',
          `attachment; filename="certificados-plantilla-${datos.plantillaId}.zip"`,
        )
        .send(contenido);
    },
  );

  app.post(
    '/plantillas-certificado/:id/descarga-individual',
    {
      onRequest: [app.autorizar(['admin'])],
      schema: {
        tags: ['Plantillas de certificado'],
        description: 'Genera y descarga el certificado .docx de un solo asistente (admin)',
      },
    },
    async (request, reply) => {
      const { id } = validarParametros(parametrosPlantilla, request.params);
      const cuerpo = request.body as { asistenteId?: string };
      if (!cuerpo?.asistenteId) {
        throw errores.validacion('Debe indicar el asistente');
      }

      const { generados } = await generarCertificados({
        plantillaId: id,
        asistenteIds: [cuerpo.asistenteId],
        todos: false,
        soloElegibles: true,
      });
      const generado = generados[0];
      if (!generado) {
        throw errores.conflicto(
          'El asistente no es elegible: se requiere ingreso y salida en cada jornada.',
        );
      }

      await registrarAuditoria(request, {
        accion: 'plantilla.generados',
        entidad: 'plantillas_certificado',
        entidadId: id,
        datosDespues: { asistenteId: cuerpo.asistenteId, individual: true },
      });

      return reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        .header('Content-Disposition', `attachment; filename="${generado.archivo}"`)
        .send(generado.contenido);
    },
  );
}
