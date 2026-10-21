/**
 * Preparacion del entorno de pruebas. Se ejecuta antes de cargar cualquier modulo
 * de la API, de modo que la base de datos de pruebas quede configurada a tiempo.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';

function cargarArchivoEnvLocal(): void {
  const proceso = process as NodeJS.Process & { loadEnvFile?: (archivo?: string) => void };
  if (typeof proceso.loadEnvFile !== 'function') return;
  let directorio = process.cwd();
  for (let nivel = 0; nivel < 4; nivel += 1) {
    const ruta = path.join(directorio, '.env');
    if (existsSync(ruta)) {
      try {
        proceso.loadEnvFile(ruta);
      } catch {
        // Si el archivo no se puede leer, se continuan con las variables del entorno.
      }
      return;
    }
    const padre = path.dirname(directorio);
    if (padre === directorio) break;
    directorio = padre;
  }
}

cargarArchivoEnvLocal();

process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'silent';
process.env.REDIS_URL = '';
process.env.CACHE_TTL_MS = '500';
process.env.JWT_SECRET =
  process.env.JWT_SECRET ?? 'clave-de-pruebas-locally-32-caracteres-minimo-ok';
process.env.ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@pruebas.local';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'Pruebas2026';
process.env.SEED_ASISTENTES = '0';
process.env.CORS_ORIGINS = process.env.CORS_ORIGINS ?? 'http://localhost:5173';

const urlPruebas = process.env.DATABASE_URL_TEST;
if (urlPruebas) {
  process.env.DATABASE_URL = urlPruebas;
} else {
  console.warn(
    '[pruebas] No se encontro DATABASE_URL_TEST. Las pruebas de integracion se omitiran.',
  );
}
