import pino from 'pino';
import { cargarEntorno, esProduccion } from './entorno.js';

const entorno = cargarEntorno();

/**
 * Logs estructurados con pino. En desarrollo se usa pino-pretty para lectura humana;
 * en produccion se emite JSON una linea por evento, listo para el agregador de logs.
 */
export const logger = pino({
  level: entorno.LOG_LEVEL,
  base: { servicio: 'seminario-asistencia-api', entorno: entorno.NODE_ENV },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      'passwordActual',
      'passwordNuevo',
      'tokenAcceso',
      'refreshToken',
    ],
    censor: '[oculto]',
  },
  ...(esProduccion(entorno)
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname,service',
          },
        },
      }),
});
