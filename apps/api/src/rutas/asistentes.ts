import { and, asc, count, eq, ilike, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  asistenteCreateSchema,
  asistenteUpdateSchema,
  busquedaManualSchema,
  filtrosAsistentesSchema,
  normalizarId,
  type AsistenteLectura,
} from '@seminario/shared';
import { db } from '../db/cliente.js';
import { asistentes } from '../db/esquema.js';
import { errores } from '../plugins/errores.js';
import { registrarAuditoria } from '../servicios/auditoria.js';
import { obtenerConfig } from '../servicios/configuracion.js';
import { generarCarnetsPDF } from '../servicios/pdf.js';
import {
  construirVistaPrevia,
  parsearCsv,
  parsearXlsx,
  validarFila,
  type FormatoImportacion,
} from '../servicios/importacion.js';
import { validarCuerpo, validarConsulta, validarParametros } from '../lib/validacion.js';
import { cargarEntorno } from '../config/entorno.js';

const parametrosAsistente = z.object({ id: z.string().min(1).max(32) });

function aLectura(fila: typeof asistentes.$inferSelect): AsistenteLectura {
  return {
    id: fila.id,
    nombres: fila.nombres,
    apellidos: fila.apellidos,
    rol: fila.rol,
    semestre: fila.semestre,
    activo: fila.activo,
    createdAt: fila.createdAt.toISOString(),
    updatedAt: fila.updatedAt.toISOString(),
  };
}

export async function registrarRutasAsistentes(app: FastifyInstance): Promise<void> {
  app.get(
    '/asistentes',
    {
      onRequest: [app.autorizar(['admin', 'operador'])],
      schema: {
        tags: ['Asistentes'],
        description: 'Lista paginada de asistentes con filtros y busqueda',
      },
    },
    async (request) => {
      const filtros = validarConsulta(filtrosAsistentesSchema, request.query);
      const condiciones = [];

      if (filtros.rol) condiciones.push(eq(asistentes.rol, filtros.rol));
      if (filtros.semestre) condiciones.push(eq(asistentes.semestre, filtros.semestre));
      if (filtros.activo !== undefined) condiciones.push(eq(asistentes.activo, filtros.activo));
      if (filtros.q) {
        const busqueda = `%${filtros.q.toLowerCase()}%`;
        condiciones.push(
          or(
            ilike(asistentes.nombres, busqueda),
            ilike(asistentes.apellidos, busqueda),
            ilike(asistentes.id, busqueda),
          )!,
        );
      }

      const where = condiciones.length > 0 ? and(...condiciones) : undefined;

      const [filas, conteo] = await Promise.all([
        db
          .select()
          .from(asistentes)
          .where(where)
          .orderBy(asc(asistentes.apellidos), asc(asistentes.nombres))
          .limit(filtros.porPagina)
          .offset((filtros.pagina - 1) * filtros.porPagina),
        db.select({ total: count() }).from(asistentes).where(where),
      ]);
      const total = conteo[0]?.total ?? 0;

      return {
        datos: filas.map(aLectura),
        pagina: filtros.pagina,
        porPagina: filtros.porPagina,
        total,
        totalPaginas: Math.ceil(total / filtros.porPagina),
      };
    },
  );

  app.get(
    '/asistentes/buscar',
    {
      onRequest: [app.autorizar(['admin', 'operador'])],
      schema: {
        tags: ['Asistentes'],
        description: 'Busqueda manual por nombre o apellido para el operador',
      },
    },
    async (request) => {
      const filtros = validarConsulta(busquedaManualSchema, request.query);
      const busqueda = `%${filtros.q.toLowerCase()}%`;
      const filas = await db
        .select()
        .from(asistentes)
        .where(
          and(
            eq(asistentes.activo, true),
            or(
              ilike(asistentes.nombres, busqueda),
              ilike(asistentes.apellidos, busqueda),
              ilike(asistentes.id, busqueda),
            )!,
          ),
        )
        .orderBy(asc(asistentes.apellidos))
        .limit(filtros.porPagina)
        .offset((filtros.pagina - 1) * filtros.porPagina);

      return {
        datos: filas.map(aLectura),
        pagina: filtros.pagina,
        porPagina: filtros.porPagina,
      };
    },
  );

  app.get(
    '/asistentes/carnets',
    {
      onRequest: [app.autorizar(['admin'])],
      schema: {
        tags: ['Asistentes'],
        description: 'Genera los carnets con codigo QR en un PDF descargable',
      },
    },
    async (request, reply) => {
      const consulta = request.query as { rol?: string; semestre?: string; limite?: string };
      const condiciones = [eq(asistentes.activo, true)];
      if (consulta.rol === 'estudiante' || consulta.rol === 'docente') {
        condiciones.push(eq(asistentes.rol, consulta.rol));
      }
      if (consulta.semestre) {
        const semestre = Number(consulta.semestre);
        if (Number.isInteger(semestre)) condiciones.push(eq(asistentes.semestre, semestre));
      }
      const limite = Math.min(Number(consulta.limite ?? 600) || 600, 1200);

      const filas = await db
        .select()
        .from(asistentes)
        .where(and(...condiciones))
        .orderBy(asc(asistentes.apellidos), asc(asistentes.nombres))
        .limit(limite);

      const config = await obtenerConfig();
      const entorno = cargarEntorno();
      const base = entorno.BASE_URL_PUBLICA.replace(/\/$/, '');

      const pdf = await generarCarnetsPDF(
        filas.map((fila) => ({
          asistente: {
            id: fila.id,
            nombres: fila.nombres,
            apellidos: fila.apellidos,
            rol: fila.rol,
            semestre: fila.semestre,
          },
          urlVerificacion: `${base}/api/publico/verificar/${fila.id}`,
        })),
        config.nombre,
      );

      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', 'attachment; filename="carnets-asistentes.pdf"')
        .send(Buffer.from(pdf));
    },
  );

  app.get(
    '/asistentes/:id',
    {
      onRequest: [app.autorizar(['admin', 'operador'])],
      schema: { tags: ['Asistentes'], description: 'Detalle de un asistente' },
    },
    async (request) => {
      const { id } = validarParametros(parametrosAsistente, request.params);
      const filas = await db
        .select()
        .from(asistentes)
        .where(eq(asistentes.id, normalizarId(id)))
        .limit(1);
      if (!filas[0]) throw errores.noEncontrado('El asistente no existe');
      return aLectura(filas[0]);
    },
  );

  app.post(
    '/asistentes',
    {
      onRequest: [app.autorizar(['admin'])],
      schema: { tags: ['Asistentes'], description: 'Crea un asistente' },
    },
    async (request, reply) => {
      const datos = validarCuerpo(asistenteCreateSchema, request.body);
      const id = normalizarId(datos.id);
      const config = await obtenerConfig();

      const existente = await db
        .select({ id: asistentes.id })
        .from(asistentes)
        .where(eq(asistentes.id, id))
        .limit(1);
      if (existente.length > 0) {
        throw errores.conflicto('Ya existe un asistente con ese ID institucional', [
          { campo: 'id', mensaje: 'ID institucional ya registrado' },
        ]);
      }

      const insertados = await db
        .insert(asistentes)
        .values({
          id,
          nombres: datos.nombres,
          apellidos: datos.apellidos,
          rol: datos.rol,
          semestre: datos.rol === 'docente' ? null : (datos.semestre ?? null),
          activo: datos.activo,
        })
        .returning();

      await registrarAuditoria(request, {
        accion: 'asistente.creado',
        entidad: 'asistentes',
        entidadId: id,
        datosDespues: { id, nombres: datos.nombres, apellidos: datos.apellidos, rol: datos.rol },
      });

      return reply.status(201).send(aLectura(insertados[0]!));
    },
  );

  app.patch(
    '/asistentes/:id',
    {
      onRequest: [app.autorizar(['admin'])],
      schema: { tags: ['Asistentes'], description: 'Actualiza los datos de un asistente' },
    },
    async (request) => {
      const { id } = validarParametros(parametrosAsistente, request.params);
      const datos = validarCuerpo(asistenteUpdateSchema, request.body);
      const idNormalizado = normalizarId(id);

      const actuales = await db
        .select()
        .from(asistentes)
        .where(eq(asistentes.id, idNormalizado))
        .limit(1);
      const actual = actuales[0];
      if (!actual) throw errores.noEncontrado('El asistente no existe');

      const rolNuevo = datos.rol ?? actual.rol;
      const semestreNuevo =
        datos.semestre !== undefined ? datos.semestre : (rolNuevo === 'docente' ? null : actual.semestre);

      if (rolNuevo === 'estudiante' && semestreNuevo === null) {
        throw errores.validacion('El semestre es obligatorio para estudiantes', [
          { campo: 'semestre', mensaje: 'El semestre es obligatorio para estudiantes' },
        ]);
      }
      if (rolNuevo === 'docente' && semestreNuevo !== null) {
        throw errores.validacion('El semestre no aplica para docentes', [
          { campo: 'semestre', mensaje: 'El semestre no aplica para docentes' },
        ]);
      }

      const actualizados = await db
        .update(asistentes)
        .set({
          ...(datos.nombres !== undefined ? { nombres: datos.nombres } : {}),
          ...(datos.apellidos !== undefined ? { apellidos: datos.apellidos } : {}),
          ...(datos.rol !== undefined ? { rol: datos.rol } : {}),
          ...(datos.semestre !== undefined ? { semestre: datos.semestre } : {}),
          ...(datos.activo !== undefined ? { activo: datos.activo } : {}),
        })
        .where(eq(asistentes.id, idNormalizado))
        .returning();

      await registrarAuditoria(request, {
        accion: 'asistente.actualizado',
        entidad: 'asistentes',
        entidadId: idNormalizado,
        datosAntes: aLectura(actual),
        datosDespues: aLectura(actualizados[0]!),
      });

      return aLectura(actualizados[0]!);
    },
  );

  app.post(
    '/asistentes/importar/previa',
    {
      onRequest: [app.autorizar(['admin'])],
      schema: {
        tags: ['Asistentes'],
        description: 'Valida un archivo CSV o XLSX y devuelve la vista previa con errores',
      },
    },
    async (request) => {
      const entorno = cargarEntorno();
      const archivo = await request.file({ limits: { fileSize: entorno.UPLOAD_MAX_BYTES } });
      if (!archivo) {
        throw errores.validacion('Debe adjuntar un archivo CSV o XLSX');
      }

      const extension = archivo.filename.toLowerCase().split('.').pop();
      const formato: FormatoImportacion = extension === 'xlsx' ? 'xlsx' : 'csv';
      const buffer = await archivo.toBuffer();
      if (buffer.length === 0) {
        throw errores.validacion('El archivo esta vacio');
      }

      const parseo =
        formato === 'xlsx' ? await parsearXlsx(buffer) : parsearCsv(buffer.toString('utf8'));
      if (parseo.errorLectura) {
        throw errores.validacion(parseo.errorLectura);
      }

      const config = await obtenerConfig();
      const validaciones = parseo.filas.map((fila) => validarFila(fila.fila, fila.datos, config.idRegex));

      const idsValidos = validaciones.filter((v) => v.valida).map((v) => v.datos.id!);
      const unicos = new Set(idsValidos);
      const duplicados = idsValidos.length - unicos.size;

      const existentes = idsValidos.length
        ? await db
            .select({ id: asistentes.id })
            .from(asistentes)
            .where(sql`${asistentes.id} = ANY(${idsValidos})`)
        : [];
      const existentesSet = new Set(existentes.map((fila) => fila.id));

      const nuevos = [...unicos].filter((id) => !existentesSet.has(id)).length;
      const actualizados = [...unicos].filter((id) => existentesSet.has(id)).length;

      return construirVistaPrevia(
        validaciones,
        nuevos,
        actualizados,
        duplicados,
        validaciones.length,
      );
    },
  );

  app.post(
    '/asistentes/importar/confirmar',
    {
      onRequest: [app.autorizar(['admin'])],
      schema: {
        tags: ['Asistentes'],
        description: 'Aplica las filas validadas de una importacion',
      },
    },
    async (request) => {
      const cuerpo = request.body as {
        filas?: { fila: number; id: string; nombres: string; apellidos: string; rol: string; semestre?: number | null }[];
        modo?: 'crear_actualizar' | 'solo_nuevos';
      };
      if (!Array.isArray(cuerpo.filas) || cuerpo.filas.length === 0) {
        throw errores.validacion('No se recibieron filas para importar');
      }
      if (cuerpo.filas.length > 5000) {
        throw errores.validacion('La importacion supera el maximo de 5000 filas por lote');
      }

      const config = await obtenerConfig();
      const validaciones = cuerpo.filas.map((fila) =>
        validarFila(
          fila.fila ?? 0,
          {
            id: fila.id,
            nombres: fila.nombres,
            apellidos: fila.apellidos,
            rol: fila.rol,
            semestre:
              fila.semestre === null || fila.semestre === undefined
                ? ''
                : String(fila.semestre),
          },
          config.idRegex,
        ),
      );

      const conError = validaciones.filter((v) => !v.valida);
      if (conError.length > 0) {
        throw errores.validacion(
          'Algunas filas no son validas',
          conError[0]!.errores.map((detalle) => ({
            campo: detalle.campo ?? '(general)',
            mensaje: detalle.mensaje,
          })),
        );
      }

      const modo = cuerpo.modo ?? 'crear_actualizar';
      const ids = validaciones.map((v) => v.datos.id!);
      const existentes = await db
        .select({ id: asistentes.id })
        .from(asistentes)
        .where(sql`${asistentes.id} = ANY(${ids})`);
      const existentesSet = new Set(existentes.map((fila) => fila.id));

      let creados = 0;
      let actualizados = 0;
      let omitidos = 0;

      for (const validacion of validaciones) {
        const datos = validacion.datos;
        const id = datos.id!;
        const yaExiste = existentesSet.has(id);

        if (yaExiste && modo === 'solo_nuevos') {
          omitidos += 1;
          continue;
        }

        const valores = {
          nombres: datos.nombres!,
          apellidos: datos.apellidos!,
          rol: datos.rol!,
          semestre: datos.rol === 'docente' ? null : (datos.semestre ?? null),
        };

        if (yaExiste) {
          await db.update(asistentes).set(valores).where(eq(asistentes.id, id));
          actualizados += 1;
        } else {
          await db.insert(asistentes).values({ id, ...valores });
          creados += 1;
        }
      }

      await registrarAuditoria(request, {
        accion: 'asistente.importado',
        entidad: 'asistentes',
        datosDespues: { creados, actualizados, omitidos, total: validaciones.length },
      });

      return { creados, actualizados, omitidos, total: validaciones.length };
    },
  );
}
