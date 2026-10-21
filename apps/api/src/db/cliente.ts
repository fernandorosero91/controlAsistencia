import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { cargarEntorno } from '../config/entorno.js';
import * as esquema from './esquema.js';

const { Pool } = pg;

const entorno = cargarEntorno();

/**
 * Pool de conexiones a PostgreSQL.
 *
 * Dimensionamiento (documentado en docs/02-decisiones-tecnicas.md):
 *  - 2 replicas de API x 20 conexiones = 40 conexiones de aplicacion.
 *  - PgBouncer en modo transaction: default_pool_size = 40, max_client_conn = 200.
 *  - Postgres: max_connections = 200.
 * En desarrollo (sin PgBouncer) el pool se conecta directo a Postgres.
 */
export const pool = new Pool({
  connectionString: entorno.DATABASE_URL,
  max: entorno.DATABASE_POOL_MAX,
  min: entorno.DATABASE_POOL_MIN,
  connectionTimeoutMillis: entorno.DATABASE_CONNECTION_TIMEOUT_MS,
  idleTimeoutMillis: entorno.DATABASE_IDLE_TIMEOUT_MS,
  statement_timeout: entorno.DATABASE_STATEMENT_TIMEOUT_MS,
  application_name: 'seminario-asistencia-api',
});

pool.on('error', (error) => {
  console.error(
    JSON.stringify({ nivel: 'error', evento: 'error_pool_postgres', mensaje: error.message }),
  );
});

export const db = drizzle(pool, { schema: esquema });

export type BaseDatos = typeof db;

export async function cerrarPool(): Promise<void> {
  await pool.end();
}

export async function comprobarConexion(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
