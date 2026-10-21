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
}

function ventana(segundos: number): string {
  return `${segundos} seconds`;
}

/**
 * Escaneo del operador: ingresos, salidas y entregas de refrigerio.
 * El valor por defecto (80 por minuto) alcanza para unas cuarenta
 * registraciones por minuto y evita que un solo dispositivo sature la base de
 * datos durante la entrada masiva.
 */
export function limiteEscaneo(): LimiteTasa {
  const entorno = cargarEntorno();
  return {
    max: entorno.RATE_LIMIT_ESCANEO_MAX,
    timeWindow: ventana(entorno.RATE_LIMIT_ESCANEO_VENTANA_SEGUNDOS),
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
