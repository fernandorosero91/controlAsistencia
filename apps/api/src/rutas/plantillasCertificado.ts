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
  eliminarPlantilla,
  generarCertificados,
  listarPlantillas,
  obtenerPlantilla,
} from '../servicios/plantillasCertificado.js';
import { errores } from '../plugins/errores.js';
import { validarCuerpo, validarParametros } from '../lib/validacion.js';

const parametrosPlantilla = z.object({ id: z.string().uuid('La plantilla no es valida') });

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

  app.post(
    '/plantillas-certificado/generar',
    {
      onRequest: [app.autorizar(['admin'])],
      schema: {
        tags: ['Plantillas de certificado'],
        description: 'Genera los certificados .docx de una seleccion y los entrega en ZIP (admin)',
      },
    },
    async (request, reply) => {
      const datos = validarCuerpo(generarDesdePlantillaSchema, request.body);

      const { resumen } = await generarCertificados(datos);

      await registrarAuditoria(request, {
        accion: 'plantilla.generados',
        entidad: 'plantillas_certificado',
        entidadId: datos.plantillaId,
        datosDespues: {
          total: resumen.total,
          generados: resumen.generados,
          omitidos: resumen.omitidos,
        },
      });

      return reply.status(200).send(resumen);
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
      const { generados } = await generarCertificados(datos);
      if (generados.length === 0) {
        throw errores.conflicto('No se genero ningun certificado');
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
        datosDespues: { total: generados.length, descarga: true },
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
        soloElegibles: false,
      });
      const generado = generados[0];
      if (!generado) throw errores.noEncontrado('No se pudo generar el certificado del asistente');

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
