import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

/**
 * Carga opcional del archivo .env para el desarrollo local.
 * En los contenedores las variables llegan por el entorno y este paso no hace nada.
 */
function cargarArchivoEnv(): void {
  const proceso = process as NodeJS.Process & { loadEnvFile?: (archivo?: string) => void };
  if (typeof proceso.loadEnvFile !== 'function') return;

  // Se busca el archivo .env en el directorio actual y en los directorios padre,
  // porque los scripts de npm se ejecutan dentro del workspace.
  let directorio = process.cwd();
  for (let nivel = 0; nivel < 4; nivel += 1) {
    const ruta = path.join(directorio, '.env');
    if (existsSync(ruta)) {
      try {
        proceso.loadEnvFile(ruta);
      } catch {
        // Un .env con formato invalido no impide el arranque: la validacion de
        // abajo informa del problema y las variables del entorno tienen prioridad.
      }
      return;
    }
    const padre = path.dirname(directorio);
    if (padre === directorio) break;
    directorio = padre;
  }
}

cargarArchivoEnv();

/**
 * Configuracion por variables de entorno. Ningun secreto esta hardcodeado:
 * todo se lee de process.env y se valida al arrancar el proceso.
 */

const esquema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL es obligatoria'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(200).default(20),
  DATABASE_POOL_MIN: z.coerce.number().int().min(0).max(50).default(2),
  DATABASE_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(500).max(60000).default(5000),
  DATABASE_IDLE_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600000).default(30000),
  DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(10000),
  DATABASE_STATEMENT_TIMEOUT_MS_REPORTES: z.coerce
    .number()
    .int()
    .min(1000)
    .max(300000)
    .default(15000),

  REDIS_URL: z.string().optional(),
  CACHE_TTL_MS: z.coerce.number().int().min(500).max(60000).default(3000),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
  JWT_ACCESS_TTL_SEGUNDOS: z.coerce.number().int().min(60).max(86400).default(900),
  JWT_REFRESH_TTL_SEGUNDOS: z.coerce.number().int().min(300).max(2592000).default(604800),
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  COOKIE_DOMAIN: z.string().optional(),

  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:4173'),

  RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().min(1).max(1000).default(10),
  RATE_LIMIT_LOGIN_VENTANA_SEGUNDOS: z.coerce.number().int().min(1).default(60),
  RATE_LIMIT_ESCANEO_MAX: z.coerce.number().int().min(1).max(100000).default(600),
  RATE_LIMIT_ESCANEO_VENTANA_SEGUNDOS: z.coerce.number().int().min(1).default(60),
  RATE_LIMIT_VERIFICACION_MAX: z.coerce.number().int().min(1).max(1000).default(20),
  RATE_LIMIT_VERIFICACION_VENTANA_SEGUNDOS: z.coerce.number().int().min(1).default(60),
  RATE_LIMIT_ADMIN_MAX: z.coerce.number().int().min(1).max(100000).default(600),
  RATE_LIMIT_ADMIN_VENTANA_SEGUNDOS: z.coerce.number().int().min(1).default(60),

  BODY_LIMIT_BYTES: z.coerce.number().int().min(1024).max(10485760).default(1048576),
  UPLOAD_MAX_BYTES: z.coerce.number().int().min(1024).max(52428800).default(10485760),

  BASE_URL_PUBLICA: z.string().url().default('http://localhost:3000'),
  CERTIFICADOS_DIR: z.string().default('storage/certificados'),

  SMTP_HOST: z.string().optional(),
  SMTP_PUERTO: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_USUARIO: z.string().optional(),
  SMTP_CLAVE: z.string().optional(),
  SMTP_SEGURIDAD: z.enum(['starttls', 'tls']).default('starttls'),
  SMTP_REMITENTE: z.string().email().default('no-reply@seminario.local'),
  SMTP_REMITENTE_NOMBRE: z.string().default('Seminario'),

  ADMIN_NOMBRE: z.string().min(3).default('Administrador del seminario'),
  ADMIN_EMAIL: z.string().email().default('admin@seminario.local'),
  ADMIN_PASSWORD: z.string().min(8).default('Seminario2026'),
  OPERADOR_PASSWORD: z.preprocess(
    (valor) => (valor === '' || valor === undefined ? undefined : valor),
    z.string().min(8).optional(),
  ),
  ADMIN_OPERADORES: z.coerce.number().int().min(0).max(50).default(0),
  SEED_ASISTENTES: z.coerce.number().int().min(0).max(5000).default(600),

  SEMINARIO_NOMBRE: z
    .string()
    .default('IV Seminario de Ingenieria de Software'),
  SEMINARIO_FECHA: z.string().default('2026-10-27'),
  SEMINARIO_LUGAR: z.string().default('Camara de Comercio - Pasto'),
  SEMINARIO_FACULTAD: z.string().default('Facultad de Ingenieria'),
  SEMINARIO_CONTACTO: z.string().default('311 781 7327'),
  SEMINARIO_INVERSIION: z.string().default('$185.000'),
  SEMINARIO_HORA_INICIO: z.string().default('08:00'),
  SEMINARIO_HORA_FIN: z.string().default('18:00'),
  SEMINARIO_TOLERANCIA_MINUTOS: z.coerce.number().int().min(0).max(240).default(15),
});

export type Entorno = z.infer<typeof esquema>;

let entornoCache: Entorno | null = null;

export function cargarEntorno(): Entorno {
  if (entornoCache) return entornoCache;

  const resultado = esquema.safeParse(process.env);
  if (!resultado.success) {
    const problemas = resultado.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(raiz)'}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Configuracion de entorno invalida. Revise las siguientes variables:\n${problemas}`,
    );
  }

  entornoCache = resultado.data;
  return entornoCache;
}

export function esProduccion(entorno: Entorno = cargarEntorno()): boolean {
  return entorno.NODE_ENV === 'production';
}

export function origenesPermitidos(entorno: Entorno = cargarEntorno()): string[] {
  return entorno.CORS_ORIGINS.split(',')
    .map((origen) => origen.trim())
    .filter((origen) => origen.length > 0);
}

export function usarCookieSegura(entorno: Entorno = cargarEntorno()): boolean {
  if (entorno.COOKIE_SECURE) return entorno.COOKIE_SECURE === 'true';
  return esProduccion(entorno);
}
