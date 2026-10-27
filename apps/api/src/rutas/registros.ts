import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  entregaRefrigerioSchema,
  entregaSouvenirSchema,
  identificadorAsistenteSchema,
  normalizarId,
  type RespuestaRegistro,
} from '@seminario/shared';
import { db } from '../db/cliente.js';
import {
  asistencias,
  entregasRefrigerio,
  entregasSouvenir,
  jornadas,
  tiposRefrigerio,
  tiposSouvenir,
  usuariosSistema,
} from '../db/esquema.js';
import { limiteEscaneo } from '../config/limites.js';
import { errores } from '../plugins/errores.js';
import { registrarAuditoria } from '../servicios/auditoria.js';
import { ejecutarConIdempotencia } from '../servicios/idempotencia.js';
import {
  listarJornadas,
  obtenerConfig,
  resolverJornadaPorHorario,
  type JornadaVigente,
} from '../servicios/configuracion.js';
import { entregarRefrigerio, entregarSouvenir, registrarIngreso, registrarSalida } from '../servicios/registros.js';
import { validarCuerpo, validarParametros } from '../lib/validacion.js';

const parametrosAsistente = z.object({ asistenteId: z.string().min(1).max(32) });

type ModuloOperador = 'ingreso' | 'refrigerio' | 'salida' | 'souvenir';

const NOMBRE_MODULO: Record<ModuloOperador, string> = {
  ingreso: 'el registro de ingreso',
  refrigerio: 'la entrega de refrigerios',
  salida: 'el registro de salida',
  souvenir: 'la entrega de souvenirs',
};

/** Doce horas es el maximo razonable para un registro capturado sin conexion. */
const ANTIGUEDAD_MAXIMA_DIFERIDA_MS = 12 * 60 * 60_000;

/**
 * Revisa que el administrador tenga habilitado el modulo y devuelve la jornada
 * vigente segun el reloj del servidor. La jornada no la elige el operador.
 */
async function validarAcceso(modulo: ModuloOperador): Promise<JornadaVigente> {
  const config = await obtenerConfig();

  const habilitado =
    modulo === 'ingreso'
      ? config.operadorIngresoHabilitado
      : modulo === 'refrigerio'
        ? config.operadorRefrigerioHabilitado
        : modulo === 'souvenir'
          ? config.operadorSouvenirHabilitado
          : config.operadorSalidaHabilitado;

  if (!habilitado) {
    throw errores.noAutorizado(
      `El administrador tiene deshabilitado ${NOMBRE_MODULO[modulo]} en este momento.`,
    );
  }

  return resolverJornadaPorHorario(await listarJornadas(), new Date(), {
    jornadaForzadaId: config.jornadaForzadaId,
    margenCierreMinutos: config.margenCierreMinutos,
  });
}

/**
 * Hora de captura de un registro que llego desde la cola offline. Se acota para
 * que un reloj mal configurado no pueda fechar registros a futuro o muy atras.
 */
function horaDiferida(registradoEn: Date | undefined): Date | null {
  if (!registradoEn) return null;
  const instante = registradoEn.getTime();
  const ahora = Date.now();

  if (
    Number.isNaN(instante) ||
    instante > ahora + 60_000 ||
    instante < ahora - ANTIGUEDAD_MAXIMA_DIFERIDA_MS
  ) {
    throw errores.validacion('La hora del registro pendiente no es valida');
  }

  return registradoEn;
}

function horaEnBogota(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-CO', {
    timeZone: 'America/Bogota',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** Respuesta cuando el reloj esta fuera de todas las jornadas programadas. */
function respuestaSinJornada(vigente: JornadaVigente): RespuestaRegistro {
  const proxima = vigente.proxima
    ? ` La proxima es "${vigente.proxima.nombre}", que empieza a las ${horaEnBogota(vigente.proxima.inicio)}.`
    : '';

  return {
    resultado: 'no_permitido',
    mensaje: `No hay ninguna jornada activa en este momento.${proxima}`,
    asistente: null,
    existente: null,
    requiereBusquedaManual: false,
  };
}

export async function registrarRutasRegistros(app: FastifyInstance): Promise<void> {
  app.post(
    '/asistencias/ingreso',
    {
      onRequest: [app.autenticar],
      config: { rateLimit: limiteEscaneo() },
      schema: {
        tags: ['Registros'],
        description: 'Registra el ingreso de un asistente a una jornada',
      },
    },
    async (request, reply) => {
      const datos = validarCuerpo(identificadorAsistenteSchema, request.body);
      const usuario = request.usuario!;

      const vigente = await validarAcceso('ingreso');
      const capturadoEn = horaDiferida(datos.registradoEn);
      const jornadaVigente = capturadoEn ? null : vigente.jornada;

      if (!capturadoEn && !jornadaVigente) {
        return reply.code(200).send(respuestaSinJornada(vigente));
      }

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
          ahora: capturadoEn ?? undefined,
          jornadaVigente: jornadaVigente
            ? { id: jornadaVigente.id, nombre: jornadaVigente.nombre }
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
      config: { rateLimit: limiteEscaneo() },
      schema: {
        tags: ['Registros'],
        description: 'Registra la salida (cierre) de un asistente en una jornada',
      },
    },
    async (request, reply) => {
      const datos = validarCuerpo(identificadorAsistenteSchema, request.body);
      const usuario = request.usuario!;

      const vigente = await validarAcceso('salida');
      const capturadoEn = horaDiferida(datos.registradoEn);
      const jornadaVigente = capturadoEn ? null : vigente.jornada;

      if (!capturadoEn && !jornadaVigente) {
        return reply.code(200).send(respuestaSinJornada(vigente));
      }

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
          ahora: capturadoEn ?? undefined,
          jornadaVigente: jornadaVigente
            ? { id: jornadaVigente.id, nombre: jornadaVigente.nombre }
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
      config: { rateLimit: limiteEscaneo() },
      schema: {
        tags: ['Registros'],
        description: 'Entrega un refrigerio a un asistente con asistencia en la jornada',
      },
    },
    async (request, reply) => {
      const datos = validarCuerpo(entregaRefrigerioSchema, request.body);
      const usuario = request.usuario!;

      const vigente = await validarAcceso('refrigerio');
      const capturadoEn = horaDiferida(datos.registradoEn);
      const jornadaVigente = capturadoEn ? null : vigente.jornada;

      if (!capturadoEn && !jornadaVigente) {
        return reply.code(200).send(respuestaSinJornada(vigente));
      }

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
          ahora: capturadoEn ?? undefined,
          jornadaVigente: jornadaVigente
            ? { id: jornadaVigente.id, nombre: jornadaVigente.nombre }
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

  app.post(
    '/souvenirs/entregar',
    {
      onRequest: [app.autenticar],
      config: { rateLimit: limiteEscaneo() },
      schema: {
        tags: ['Registros'],
        description: 'Entrega el souvenir o regalo del seminario a un asistente',
      },
    },
    async (request, reply) => {
      const datos = validarCuerpo(entregaSouvenirSchema, request.body);
      const usuario = request.usuario!;

      // El souvenir es del evento, pero solo para quien ingreso en la primera
      // jornada: el servicio `entregarSouvenir` hace esa validacion.
      await validarAcceso('souvenir');
      const capturadoEn = horaDiferida(datos.registradoEn);

      const resultado = await ejecutarConIdempotencia(request, 'souvenirs/entregar', () =>
        entregarSouvenir({
          asistenteId: datos.asistenteId,
          tipoSouvenirId: datos.tipoSouvenirId,
          rolUsuario: usuario.rol,
          forzar: datos.forzar,
          motivo: datos.motivo,
          usuarioId: usuario.id,
          usuarioNombre: usuario.nombre,
          dispositivo: datos.dispositivo ?? null,
          idempotencyKey:
            typeof request.headers['idempotency-key'] === 'string'
              ? request.headers['idempotency-key']
              : null,
          ahora: capturadoEn ?? undefined,
        }),
      );

      if (resultado.cuerpo.resultado === 'exito') {
        await registrarAuditoria(request, {
          accion: 'souvenir.entregado',
          entidad: 'entregas_souvenir',
          entidadId: datos.asistenteId,
          datosDespues: {
            tipoSouvenirId: datos.tipoSouvenirId,
            excepcionManual: datos.forzar === true && usuario.rol === 'admin',
            ...(datos.forzar === true && usuario.rol === 'admin' && datos.motivo
              ? { motivo: datos.motivo }
              : {}),
          },
        });
      }

      return reply.code(resultado.codigoHttp).send(resultado.cuerpo);
    },
  );

  app.get(
    '/souvenirs/estado/:asistenteId',
    {
      onRequest: [app.autenticar],
      schema: {
        tags: ['Registros'],
        description: 'Estado de entrega de souvenirs de un asistente',
      },
    },
    async (request) => {
      const { asistenteId } = validarParametros(parametrosAsistente, request.params);
      const id = normalizarId(asistenteId);

      const entregas = await db
        .select({
          id: entregasSouvenir.id,
          tipoSouvenirId: entregasSouvenir.tipoSouvenirId,
          nombre: tiposSouvenir.nombre,
          entregadoAt: entregasSouvenir.entregadoAt,
          entregadoPor: usuariosSistema.nombre,
        })
        .from(entregasSouvenir)
        .innerJoin(tiposSouvenir, eq(tiposSouvenir.id, entregasSouvenir.tipoSouvenirId))
        .leftJoin(usuariosSistema, eq(usuariosSistema.id, entregasSouvenir.entregadoPor))
        .where(eq(entregasSouvenir.asistenteId, id));

      const tipos = await db
        .select()
        .from(tiposSouvenir)
        .where(eq(tiposSouvenir.activo, true))
        .orderBy(tiposSouvenir.orden);

      return {
        entregas: entregas.map((entrega) => ({
          ...entrega,
          id: String(entrega.id),
          entregadoAt: entrega.entregadoAt.toISOString(),
        })),
        tiposDisponibles: tipos.map((tipo) => ({
          id: tipo.id,
          nombre: tipo.nombre,
          entregado: entregas.some((entrega) => entrega.tipoSouvenirId === tipo.id),
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
