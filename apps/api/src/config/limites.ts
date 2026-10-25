import type { FastifyRequest } from 'fastify';
import { cargarEntorno } from './entorno.js';

/**
 * Limites de tasa de la API.
 *
 * El contador de @fastify/rate-limit vive en Redis y se separa por ruta: cada
 * URL tiene su propio contador, con la clave del usuario (o de la direccion de
 * red cuando la peticion no esta autenticada). Asi el trafico de escaneo del
 * operador no consume el presupuesto de las consultas del panel de
 * administracion, ni al reves.
 */

export interface LimiteTasa {
  max: number;
  timeWindow: string;
  keyGenerator?: (request: FastifyRequest) => string;
}

/**
 * Clave del limite de escaneo: usuario + dispositivo.
 *
 * Varios celulares pueden compartir una misma cuenta de operador (el caso del
 * evento: una cuenta por turno, quince personas registrando a la vez). Si el
 * cupo fuera solo por cuenta, los quince dispositivos consumirian el mismo
 * presupuesto y el limite saltaria en mitad de la fila. La app envia
 * `X-Dispositivo` con un identificador estable guardado en el navegador, de
 * modo que cada celular tiene su propio cupo.
 *
 * Si la cabecera no llega (clientes antiguos, k6 sin cabecera) se conserva el
 * comportamiento por cuenta, que es el mas restrictivo.
 */
export function claveEscaneo(request: FastifyRequest): string {
  const usuario = request.usuario?.id ?? request.ip;
  const cabecera = request.headers['x-dispositivo'];
  const valor = Array.isArray(cabecera) ? (cabecera[0] ?? '') : (cabecera ?? '');
  const dispositivo = valor.trim().slice(0, 64);
  return dispositivo ? `${usuario}:${dispositivo}` : usuario;
}

function ventana(segundos: number): string {
  return `${segundos} seconds`;
}

/**
 * Escaneo del operador: ingresos, salidas y entregas de refrigerio.
 * El valor por defecto (150 por minuto y por dispositivo) alcanza para unas
 * setenta registraciones por minuto desde un solo celular y evita que un
 * dispositivo saturado consuma el cupo de los demas.
 */
export function limiteEscaneo(): LimiteTasa {
  const entorno = cargarEntorno();
  return {
    max: entorno.RATE_LIMIT_ESCANEO_MAX,
    timeWindow: ventana(entorno.RATE_LIMIT_ESCANEO_VENTANA_SEGUNDOS),
    keyGenerator: claveEscaneo,
  };
}

/**
 * Rutas que exigen una sesion valida: panel de administracion y consultas
 * autenticadas del operador. Se aplica de forma automatica a todas ellas
 * (hook `onRoute`), con la clave del usuario.
 */
export function limiteAdministracion(): LimiteTasa {
  const entorno = cargarEntorno();
  return {
    max: entorno.RATE_LIMIT_ADMIN_MAX,
    timeWindow: ventana(entorno.RATE_LIMIT_ADMIN_VENTANA_SEGUNDOS),
  };
}

/** Verificacion publica de certificados: se limita por direccion de red. */
export function limiteVerificacionPublica(): LimiteTasa {
  const entorno = cargarEntorno();
  return {
    max: entorno.RATE_LIMIT_VERIFICACION_MAX,
    timeWindow: ventana(entorno.RATE_LIMIT_VERIFICACION_VENTANA_SEGUNDOS),
  };
}

/** Inicio de sesion: se limita por cuenta (IP + correo), no solo por IP. */
export function limiteLogin(): LimiteTasa {
  const entorno = cargarEntorno();
  return {
    max: entorno.RATE_LIMIT_LOGIN_MAX,
    timeWindow: ventana(entorno.RATE_LIMIT_LOGIN_VENTANA_SEGUNDOS),
  };
}
