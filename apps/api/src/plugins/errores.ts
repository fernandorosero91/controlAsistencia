import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { logger } from '../config/log.js';
import type { CodigoError } from '@seminario/shared';

/** Error de negocio con codigo estable, mensaje en espanol y codigo HTTP. */
export class ErrorApi extends Error {
  readonly codigo: CodigoError;
  readonly codigoHttp: number;
  readonly mensaje: string;
  readonly detalles?: { campo: string; mensaje: string }[];

  constructor(
    codigo: CodigoError,
    mensaje: string,
    codigoHttp = 400,
    detalles?: { campo: string; mensaje: string }[],
  ) {
    super(mensaje);
    this.name = 'ErrorApi';
    this.codigo = codigo;
    this.codigoHttp = codigoHttp;
    this.mensaje = mensaje;
    this.detalles = detalles;
  }
}

export const errores = {
  noAutenticado: (mensaje = 'Debe iniciar sesion') => new ErrorApi('NO_AUTENTICADO', mensaje, 401),
  noAutorizado: (mensaje = 'No tiene permisos para esta accion') =>
    new ErrorApi('NO_AUTORIZADO', mensaje, 403),
  noEncontrado: (mensaje = 'Recurso no encontrado') => new ErrorApi('NO_ENCONTRADO', mensaje, 404),
  conflicto: (mensaje: string, detalles?: { campo: string; mensaje: string }[]) =>
    new ErrorApi('CONFLICTO', mensaje, 409, detalles),
  validacion: (mensaje: string, detalles?: { campo: string; mensaje: string }[]) =>
    new ErrorApi('VALIDACION', mensaje, 422, detalles),
  noDisponible: (mensaje: string) => new ErrorApi('NO_DISPONIBLE', mensaje, 503),
};

function esErrorValidacionZod(error: unknown): error is ZodError {
  return error instanceof ZodError;
}

export async function registrarManejadorErrores(app: FastifyInstance): Promise<void> {
  app.setErrorHandler(
    (error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply): void => {
      if (error instanceof ErrorApi) {
        reply.status(error.codigoHttp).send({
          codigo: error.codigo,
          mensaje: error.mensaje,
          detalles: error.detalles,
        });
        return;
      }

      if (esErrorValidacionZod(error)) {
        reply.status(422).send({
          codigo: 'VALIDACION',
          mensaje: 'Los datos enviados no son validos',
          detalles: error.issues.map((issue) => ({
            campo: issue.path.join('.') || '(general)',
            mensaje: issue.message,
          })),
        });
        return;
      }

      const status = (error as { statusCode?: number }).statusCode ?? 500;

      // Violacion de una restriccion de la base de datos (por ejemplo, una
      // ventana de registro cuyo cierre no es posterior a su apertura). No es
      // un fallo del servidor: es un dato invalido, y se responde 422 con un
      // mensaje util en lugar de un 500 opaco.
      const codigoPostgres = (error as { code?: string }).code;
      if (status >= 500 && codigoPostgres) {
        const mensaje =
          codigoPostgres === '23514'
            ? 'Los datos no cumplen las reglas del sistema. Revise las fechas y los horarios antes de guardar.'
            : codigoPostgres === '23505'
              ? 'Ya existe un registro con esos datos. Revise los valores e intente de nuevo.'
              : codigoPostgres === '23502'
                ? 'Faltan datos obligatorios para guardar el registro.'
                : null;

        if (mensaje) {
          reply.status(422).send({ codigo: 'VALIDACION', mensaje });
          return;
        }
      }

      if (status === 429) {
        const cuerpo = error as {
          codigo?: CodigoError;
          mensaje?: string;
          reintentarEnSegundos?: number;
        };
        reply
          .status(429)
          .header('Retry-After', String(cuerpo.reintentarEnSegundos ?? 60))
          .send({
            codigo: 'LIMITE_TASA',
            mensaje:
              cuerpo.mensaje ??
              'Se alcanzo el limite de solicitudes. Intenten de nuevo en un momento.',
          });
        return;
      }

      const requestId = request.id;
      logger.error({ requestId, err: error }, 'Error no controlado en la API');

      reply.status(status >= 500 ? 500 : status).send({
        codigo: 'INTERNO',
        mensaje:
          status >= 500
            ? 'Ocurrio un error inesperado. El equipo tecnico fue notificado.'
            : error.message,
      });
    },
  );

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      codigo: 'NO_ENCONTRADO',
      mensaje: `La ruta ${request.method} ${request.url} no existe`,
    });
  });
}
