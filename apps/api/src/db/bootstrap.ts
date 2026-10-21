import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { logger } from '../config/log.js';
import { db, pool } from './cliente.js';
import { usuariosSistema } from './esquema.js';
import { sembrarDatos } from './seed.js';

/**
 * Prepara los datos iniciales del sistema cuando la base esta vacia.
 *
 * Se ejecuta en cada arranque de la API (ver infra/docker/entrada-api.sh), pero
 * solo actua la primera vez: si ya existe al menos un usuario no toca nada, de
 * modo que un redespliegue nunca cambia contrasenas, jornadas ni configuracion.
 *
 * La creacion la hace `sembrarDatos` con `asistentes: 0`, porque en produccion
 * no se cargan los asistentes ficticios de la prueba de carga.
 */
export async function sembrarSiVacio(): Promise<boolean> {
  const [fila] = await db.select({ total: sql<number>`count(*)::int` }).from(usuariosSistema);
  const usuarios = fila?.total ?? 0;

  if (usuarios > 0) {
    logger.info({ usuarios }, 'Usuarios existentes: no se crean datos iniciales');
    return false;
  }

  logger.info('Base de datos vacia: creando administrador, operadores y configuracion del evento');
  await sembrarDatos({ asistentes: 0, migrar: false });
  return true;
}

async function principal(): Promise<void> {
  try {
    await sembrarSiVacio();
  } finally {
    await pool.end();
  }
}

const invocadoDirectamente =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invocadoDirectamente) {
  principal().catch((error: unknown) => {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Error al preparar los datos iniciales',
    );
    process.exit(1);
  });
}
