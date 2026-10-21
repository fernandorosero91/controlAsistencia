import pino from 'pino';
import { createRequire } from 'node:module';
import { cargarEntorno, esProduccion } from './entorno.js';

const entorno = cargarEntorno();

/**
 * El transporte con formato legible (pino-pretty) es una dependencia de
 * desarrollo: en la imagen de produccion no esta instalada. Se comprueba antes de
 * usarlo para que el proceso arranque en cualquier entorno.
 */
function hayTransporteLegible(): boolean {
  try {
    createRequire(import.meta.url).resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
}

const usarTransporteLegible = !esProduccion(entorno) && hayTransporteLegible();

/**
 * Logs estructurados con pino. En desarrollo se usa pino-pretty para lectura
 * humana; en produccion se emite JSON una linea por evento, listo para el
 * agregador de logs.
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
  ...(usarTransporteLegible
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname,service',
          },
        },
      }
    : {}),
});
