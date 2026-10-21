import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  entregaRefrigerioSchema,
  identificadorAsistenteSchema,
  normalizarId,
} from '@seminario/shared';
import { db } from '../db/cliente.js';
import {
  asistencias,
  entregasRefrigerio,
  jornadas,
  tiposRefrigerio,
  usuariosSistema,
} from '../db/esquema.js';
import { errores } from '../plugins/errores.js';
import { registrarAuditoria } from '../servicios/auditoria.js';
import { ejecutarConIdempotencia } from '../servicios/idempotencia.js';
import { entregarRefrigerio, registrarIngreso, registrarSalida } from '../servicios/registros.js';
import { validarCuerpo, validarParametros } from '../lib/validacion.js';

const parametrosAsistente = z.object({ asistenteId: z.string().min(1).max(32) });

const limiteEscaneo = { max: 600, timeWindow: '1 minute' };

export async function registrarRutasRegistros(app: FastifyInstance): Promise<void> {
  app.post(
    '/asistencias/ingreso',
    {
      onRequest: [app.autenticar],
      config: { rateLimit: limiteEscaneo },
      schema: {
        tags: ['Registros'],
        description: 'Registra el ingreso de un asistente a una jornada',
      },
    },
    async (request, reply) => {
      const datos = validarCuerpo(identificadorAsistenteSchema, request.body);
      const usuario = request.usuario!;

      const resultado = await ejecutarConIdempotencia(request, 'asistencias/ingreso', () =>
        registrarIngreso({
          asistenteId: datos.asistenteId,
          jornadaId: datos.jornadaId,
          usuarioId: usuario.id,
          usuarioNombre: usuario.nombre,
          dispositivo: datos.dispositivo ?? null,
          idempotencyKey:
            typeof request.headers['idempotency-key'] === 'string'
              ? request.headers['idempotency-key']
              : null,
        }),
      );

      if (resultado.cuerpo.resultado === 'exito') {
        await registrarAuditoria(request, {
          accion: 'asistencia.ingreso',
          entidad: 'asistencias',
          entidadId: datos.asistenteId,
          datosDespues: { jornadaId: datos.jornadaId },
        });
      }

      return reply.code(resultado.codigoHttp).send(resultado.cuerpo);
    },
  );

  app.post(
    '/asistencias/salida',
    {
      onRequest: [app.autenticar],
      config: { rateLimit: limiteEscaneo },
      schema: {
        tags: ['Registros'],
        description: 'Registra la salida (cierre) de un asistente en una jornada',
      },
    },
    async (request, reply) => {
      const datos = validarCuerpo(identificadorAsistenteSchema, request.body);
      const usuario = request.usuario!;

      const resultado = await ejecutarConIdempotencia(request, 'asistencias/salida', () =>
        registrarSalida({
          asistenteId: datos.asistenteId,
          jornadaId: datos.jornadaId,
          usuarioId: usuario.id,
          usuarioNombre: usuario.nombre,
          dispositivo: datos.dispositivo ?? null,
          idempotencyKey:
            typeof request.headers['idempotency-key'] === 'string'
              ? request.headers['idempotency-key']
              : null,
        }),
      );

      if (resultado.cuerpo.resultado === 'exito') {
        await registrarAuditoria(request, {
          accion: 'asistencia.salida',
          entidad: 'asistencias',
          entidadId: datos.asistenteId,
          datosDespues: { jornadaId: datos.jornadaId },
        });
      }

      return reply.code(resultado.codigoHttp).send(resultado.cuerpo);
    },
  );

  app.post(
    '/refrigerios/entregar',
    {
      onRequest: [app.autenticar],
      config: { rateLimit: limiteEscaneo },
      schema: {
        tags: ['Registros'],
        description: 'Entrega un refrigerio a un asistente con asistencia en la jornada',
      },
    },
    async (request, reply) => {
      const datos = validarCuerpo(entregaRefrigerioSchema, request.body);
      const usuario = request.usuario!;

      const resultado = await ejecutarConIdempotencia(request, 'refrigerios/entregar', () =>
        entregarRefrigerio({
          asistenteId: datos.asistenteId,
          tipoRefrigerioId: datos.tipoRefrigerioId,
          usuarioId: usuario.id,
          usuarioNombre: usuario.nombre,
          dispositivo: datos.dispositivo ?? null,
          idempotencyKey:
            typeof request.headers['idempotency-key'] === 'string'
              ? request.headers['idempotency-key']
              : null,
        }),
      );

      if (resultado.cuerpo.resultado === 'exito') {
        await registrarAuditoria(request, {
          accion: 'refrigerio.entregado',
          entidad: 'entregas_refrigerio',
          entidadId: datos.asistenteId,
          datosDespues: { tipoRefrigerioId: datos.tipoRefrigerioId },
        });
      }

      return reply.code(resultado.codigoHttp).send(resultado.cuerpo);
    },
  );

  app.get(
    '/refrigerios/estado/:asistenteId',
    {
      onRequest: [app.autenticar],
      schema: {
        tags: ['Registros'],
        description: 'Estado de refrigerios de un asistente',
      },
    },
    async (request) => {
      const { asistenteId } = validarParametros(parametrosAsistente, request.params);
      const id = normalizarId(asistenteId);

      const entregas = await db
        .select({
          id: entregasRefrigerio.id,
          tipoRefrigerioId: entregasRefrigerio.tipoRefrigerioId,
          nombre: tiposRefrigerio.nombre,
          jornadaId: tiposRefrigerio.jornadaId,
          entregadoAt: entregasRefrigerio.entregadoAt,
          entregadoPor: usuariosSistema.nombre,
        })
        .from(entregasRefrigerio)
        .innerJoin(tiposRefrigerio, eq(tiposRefrigerio.id, entregasRefrigerio.tipoRefrigerioId))
        .leftJoin(usuariosSistema, eq(usuariosSistema.id, entregasRefrigerio.entregadoPor))
        .where(eq(entregasRefrigerio.asistenteId, id));

      const tipos = await db
        .select()
        .from(tiposRefrigerio)
        .where(eq(tiposRefrigerio.activo, true))
        .orderBy(tiposRefrigerio.orden);

      return {
        entregas: entregas.map((entrega) => ({
          ...entrega,
          id: String(entrega.id),
          entregadoAt: entrega.entregadoAt.toISOString(),
        })),
        tiposDisponibles: tipos.map((tipo) => ({
          id: tipo.id,
          nombre: tipo.nombre,
          jornadaId: tipo.jornadaId,
          entregado: entregas.some((entrega) => entrega.tipoRefrigerioId === tipo.id),
        })),
      };
    },
  );

  app.get(
    '/asistencias/asistente/:asistenteId',
    {
      onRequest: [app.autenticar],
      schema: {
        tags: ['Registros'],
        description: 'Historial de assistencias de un asistente',
      },
    },
    async (request) => {
      const { asistenteId } = validarParametros(parametrosAsistente, request.params);
      const id = normalizarId(asistenteId);

      const filas = await db
        .select({
          id: asistencias.id,
          jornadaId: asistencias.jornadaId,
          jornadaNombre: jornadas.nombre,
          horaIngreso: asistencias.horaIngreso,
          horaSalida: asistencias.horaSalida,
          registradoPor: usuariosSistema.nombre,
          excepcionManual: asistencias.excepcionManual,
        })
        .from(asistencias)
        .innerJoin(jornadas, eq(jornadas.id, asistencias.jornadaId))
        .leftJoin(usuariosSistema, eq(usuariosSistema.id, asistencias.registradoPor))
        .where(eq(asistencias.asistenteId, id))
        .orderBy(desc(asistencias.horaIngreso));

      return filas.map((fila) => ({
        id: String(fila.id),
        jornadaId: fila.jornadaId,
        jornadaNombre: fila.jornadaNombre,
        horaIngreso: fila.horaIngreso.toISOString(),
        horaSalida: fila.horaSalida ? fila.horaSalida.toISOString() : null,
        registradoPor: fila.registradoPor,
        excepcionManual: fila.excepcionManual,
      }));
    },
  );

  app.post(
    '/asistencias/excepcion',
    {
      onRequest: [app.autorizar(['admin'])],
      schema: {
        tags: ['Registros'],
        description: 'Registro manual de ingreso o salida con motivo obligatorio (admin)',
      },
    },
    async (request, reply) => {
      const cuerpo = request.body as {
        asistenteId?: string;
        jornadaId?: number;
        tipo?: 'ingreso' | 'salida';
        hora?: string;
        motivo?: string;
      };

      if (!cuerpo.asistenteId || !cuerpo.jornadaId || !cuerpo.tipo) {
        throw errores.validacion('Faltan datos obligatorios de la excepcion');
      }
      if (!cuerpo.motivo || cuerpo.motivo.trim().length < 10) {
        throw errores.validacion('El motivo es obligatorio y debe tener al menos 10 caracteres', [
          { campo: 'motivo', mensaje: 'El motivo es obligatorio' },
        ]);
      }
      if (cuerpo.tipo === 'salida' && !cuerpo.hora) {
        throw errores.validacion('Para registrar una salida manual se debe indicar la hora', [
          { campo: 'hora', mensaje: 'La hora es obligatoria' },
        ]);
      }

      const usuario = request.usuario!;
      const id = normalizarId(cuerpo.asistenteId);
      const hora = cuerpo.hora ? new Date(cuerpo.hora) : new Date();
      if (Number.isNaN(hora.getTime())) {
        throw errores.validacion('La hora indicada no es valida');
      }

      if (cuerpo.tipo === 'ingreso') {
        const insertados = await db
          .insert(asistencias)
          .values({
            asistenteId: id,
            jornadaId: cuerpo.jornadaId,
            horaIngreso: hora,
            registradoPor: usuario.id,
            excepcionManual: true,
            motivoExcepcion: cuerpo.motivo.trim(),
          })
          .onConflictDoNothing({ target: [asistencias.asistenteId, asistencias.jornadaId] })
          .returning({ id: asistencias.id });

        if (insertados.length === 0) {
          throw errores.conflicto('El asistente ya tiene asistencia registrada en esa jornada');
        }
      } else {
        const actualizadas = await db
          .update(asistencias)
          .set({
            horaSalida: hora,
            registradoSalidaPor: usuario.id,
            excepcionManual: true,
            motivoExcepcion: cuerpo.motivo.trim(),
          })
          .where(and(eq(asistencias.asistenteId, id), eq(asistencias.jornadaId, cuerpo.jornadaId)))
          .returning({ id: asistencias.id });

        if (actualizadas.length === 0) {
          throw errores.conflicto('No existe un ingreso registrado para esa jornada');
        }
      }

      await registrarAuditoria(request, {
        accion: 'asistencia.excepcion',
        entidad: 'asistencias',
        entidadId: id,
        datosDespues: {
          jornadaId: cuerpo.jornadaId,
          tipo: cuerpo.tipo,
          hora: hora.toISOString(),
          motivo: cuerpo.motivo.trim(),
        },
      });

      return reply.status(201).send({ registrado: true });
    },
  );
}
