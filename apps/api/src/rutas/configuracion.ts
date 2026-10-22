import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  jornadaPartialSchema,
  jornadaSchema,
  seminarioConfigSchema,
  tipoRefrigerioSchema,
  validarCoherenciaJornada,
} from '@seminario/shared';
import { db } from '../db/cliente.js';
import { jornadas, tiposRefrigerio } from '../db/esquema.js';
import { errores } from '../plugins/errores.js';
import { registrarAuditoria } from '../servicios/auditoria.js';
import {
  guardarConfig,
  invalidarCacheConfiguracion,
  listarJornadas,
  obtenerConfig,
  resolverJornadaActiva,
} from '../servicios/configuracion.js';
import { validarCuerpo, validarParametros } from '../lib/validacion.js';

const parametrosJornada = z.object({ id: z.coerce.number().int().positive() });
const parametrosTipoRefrigerio = z.object({ id: z.coerce.number().int().positive() });

export async function registrarRutasConfiguracion(app: FastifyInstance): Promise<void> {
  app.get(
    '/config',
    {
      onRequest: [app.autorizar(['admin', 'operador'])],
      schema: { tags: ['Configuracion'], description: 'Parametros del seminario' },
    },
    async () => {
      return obtenerConfig();
    },
  );

  app.put(
    '/config',
    {
      onRequest: [app.autorizar(['admin'])],
      schema: {
        tags: ['Configuracion'],
        description:
          'Actualiza los parametros del seminario (hora de fin, tolerancia, jornada exigido)',
      },
    },
    async (request) => {
      const datos = validarCuerpo(seminarioConfigSchema, request.body);
      const anterior = await obtenerConfig();
      const config = await guardarConfig(datos);
      await invalidarCacheConfiguracion();
      await registrarAuditoria(request, {
        accion: 'config.actualizada',
        entidad: 'seminario_config',
        entidadId: '1',
        datosAntes: anterior,
        datosDespues: config,
      });
      return config;
    },
  );

  app.get(
    '/jornadas',
    {
      onRequest: [app.autorizar(['admin', 'operador'])],
      schema: { tags: ['Configuracion'], description: 'Lista de jornadas del seminario' },
    },
    async () => {
      return { jornadas: await listarJornadas() };
    },
  );

  app.post(
    '/jornadas',
    {
      onRequest: [app.autorizar(['admin'])],
      schema: { tags: ['Configuracion'], description: 'Crea una jornada' },
    },
    async (request, reply) => {
      const datos = validarCuerpo(jornadaSchema, request.body);

      const problema = validarCoherenciaJornada(datos);
      if (problema) {
        throw errores.validacion(problema, [{ campo: 'ventanaCheckinFin', mensaje: problema }]);
      }

      const insertados = await db
        .insert(jornadas)
        .values({
          nombre: datos.nombre,
          inicio: datos.inicio,
          fin: datos.fin,
          ventanaCheckinInicio: datos.ventanaCheckinInicio,
          ventanaCheckinFin: datos.ventanaCheckinFin,
          orden: datos.orden,
        })
        .returning();

      await invalidarCacheConfiguracion();
      await registrarAuditoria(request, {
        accion: 'jornada.creada',
        entidad: 'jornadas',
        entidadId: String(insertados[0]!.id),
        datosDespues: { nombre: datos.nombre },
      });

      const fila = insertados[0]!;
      return reply.status(201).send({
        id: fila.id,
        nombre: fila.nombre,
        inicio: fila.inicio.toISOString(),
        fin: fila.fin.toISOString(),
        ventanaCheckinInicio: fila.ventanaCheckinInicio.toISOString(),
        ventanaCheckinFin: fila.ventanaCheckinFin.toISOString(),
        orden: fila.orden,
      });
    },
  );

  app.patch(
    '/jornadas/:id',
    {
      onRequest: [app.autorizar(['admin'])],
      schema: { tags: ['Configuracion'], description: 'Actualiza una jornada' },
    },
    async (request) => {
      const { id } = validarParametros(parametrosJornada, request.params);
      const datos = validarCuerpo(jornadaPartialSchema, request.body);

      const actuales = await db.select().from(jornadas).where(eq(jornadas.id, id)).limit(1);
      if (!actuales[0]) throw errores.noEncontrado('La jornada no existe');

      // La coherencia se revisa sobre los valores resultantes: puede venir solo
      // un campo y el resto sigue siendo el que ya estaba guardado.
      const problema = validarCoherenciaJornada({
        inicio: datos.inicio ?? actuales[0].inicio,
        fin: datos.fin ?? actuales[0].fin,
        ventanaCheckinInicio: datos.ventanaCheckinInicio ?? actuales[0].ventanaCheckinInicio,
        ventanaCheckinFin: datos.ventanaCheckinFin ?? actuales[0].ventanaCheckinFin,
      });
      if (problema) {
        throw errores.validacion(problema, [{ campo: 'ventanaCheckinFin', mensaje: problema }]);
      }

      const actualizados = await db
        .update(jornadas)
        .set({
          ...(datos.nombre !== undefined ? { nombre: datos.nombre } : {}),
          ...(datos.inicio !== undefined ? { inicio: datos.inicio } : {}),
          ...(datos.fin !== undefined ? { fin: datos.fin } : {}),
          ...(datos.ventanaCheckinInicio !== undefined
            ? { ventanaCheckinInicio: datos.ventanaCheckinInicio }
            : {}),
          ...(datos.ventanaCheckinFin !== undefined
            ? { ventanaCheckinFin: datos.ventanaCheckinFin }
            : {}),
          ...(datos.orden !== undefined ? { orden: datos.orden } : {}),
        })
        .where(eq(jornadas.id, id))
        .returning();

      await invalidarCacheConfiguracion();
      await registrarAuditoria(request, {
        accion: 'jornada.actualizada',
        entidad: 'jornadas',
        entidadId: String(id),
        datosAntes: {
          nombre: actuales[0].nombre,
          inicio: actuales[0].inicio.toISOString(),
          fin: actuales[0].fin.toISOString(),
        },
      });

      const fila = actualizados[0]!;
      return {
        id: fila.id,
        nombre: fila.nombre,
        inicio: fila.inicio.toISOString(),
        fin: fila.fin.toISOString(),
        ventanaCheckinInicio: fila.ventanaCheckinInicio.toISOString(),
        ventanaCheckinFin: fila.ventanaCheckinFin.toISOString(),
        orden: fila.orden,
      };
    },
  );

  app.get(
    '/refrigerios/tipos',
    {
      onRequest: [app.autorizar(['admin', 'operador'])],
      schema: { tags: ['Configuracion'], description: 'Tipos de refrigerio del seminario' },
    },
    async () => {
      const filas = await db
        .select()
        .from(tiposRefrigerio)
        .orderBy(asc(tiposRefrigerio.orden), asc(tiposRefrigerio.nombre));
      return {
        tipos: filas.map((fila) => ({
          id: fila.id,
          nombre: fila.nombre,
          jornadaId: fila.jornadaId,
          activo: fila.activo,
          orden: fila.orden,
        })),
      };
    },
  );

  app.post(
    '/refrigerios/tipos',
    {
      onRequest: [app.autorizar(['admin'])],
      schema: { tags: ['Configuracion'], description: 'Crea un tipo de refrigerio' },
    },
    async (request, reply) => {
      const datos = validarCuerpo(tipoRefrigerioSchema, request.body);
      const insertados = await db
        .insert(tiposRefrigerio)
        .values({
          nombre: datos.nombre,
          jornadaId: datos.jornadaId,
          activo: datos.activo,
          orden: datos.orden,
        })
        .returning();

      const fila = insertados[0]!;
      return reply.status(201).send({
        id: fila.id,
        nombre: fila.nombre,
        jornadaId: fila.jornadaId,
        activo: fila.activo,
        orden: fila.orden,
      });
    },
  );

  app.patch(
    '/refrigerios/tipos/:id',
    {
      onRequest: [app.autorizar(['admin'])],
      schema: { tags: ['Configuracion'], description: 'Actualiza un tipo de refrigerio' },
    },
    async (request) => {
      const { id } = validarParametros(parametrosTipoRefrigerio, request.params);
      const cuerpo = request.body as {
        nombre?: string;
        activo?: boolean;
        orden?: number;
        jornadaId?: number;
      };
      const actualizados = await db
        .update(tiposRefrigerio)
        .set({
          ...(cuerpo.nombre !== undefined ? { nombre: cuerpo.nombre } : {}),
          ...(cuerpo.activo !== undefined ? { activo: cuerpo.activo } : {}),
          ...(cuerpo.orden !== undefined ? { orden: cuerpo.orden } : {}),
          ...(cuerpo.jornadaId !== undefined ? { jornadaId: cuerpo.jornadaId } : {}),
        })
        .where(eq(tiposRefrigerio.id, id))
        .returning();

      if (!actualizados[0]) throw errores.noEncontrado('El tipo de refrigerio no existe');
      const fila = actualizados[0];
      return {
        id: fila.id,
        nombre: fila.nombre,
        jornadaId: fila.jornadaId,
        activo: fila.activo,
        orden: fila.orden,
      };
    },
  );

  app.get(
    '/operador/contexto',
    {
      onRequest: [app.autenticar],
      schema: {
        tags: ['Registros'],
        description: 'Datos de contexto que necesita la app del operador en una sola llamada',
      },
    },
    async () => {
      const [config, listaJornadas, tipos] = await Promise.all([
        obtenerConfig(),
        listarJornadas(),
        db
          .select()
          .from(tiposRefrigerio)
          .where(eq(tiposRefrigerio.activo, true))
          .orderBy(asc(tiposRefrigerio.orden)),
      ]);

      return {
        config,
        jornadas: listaJornadas,
        jornadaActiva: resolverJornadaActiva(listaJornadas),
        refrigerios: tipos.map((tipo) => ({
          id: tipo.id,
          nombre: tipo.nombre,
          jornadaId: tipo.jornadaId,
        })),
        servidorHora: new Date().toISOString(),
      };
    },
  );
}
