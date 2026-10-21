#!/bin/sh
# Preparacion automatica de la base de datos al desplegar.
#
# Se ejecuta cada vez que arranca el contenedor de la API y hace dos cosas:
#   1. Aplica las migraciones pendientes (apps/api/drizzle/*.sql).
#   2. Crea los datos iniciales (administrador, operadores, configuracion del
#      evento y jornadas) SOLO si la base esta vacia.
#
# Ambas tareas son idempotentes: en un redespliegue normal no cambian nada.
# Las migraciones usan la conexion directa a PostgreSQL (no el pooler) porque el
# cerrojo consultivo que las serializa es de sesion, y PgBouncer en modo
# transaction reutiliza las conexiones entre clientes.
set -eu

URL_DIRECTA="${DATABASE_URL_DIRECTA:-$DATABASE_URL}"

echo "[entrada] Aplicando migraciones pendientes"
DATABASE_URL="$URL_DIRECTA" node dist/db/migrate.js up

echo "[entrada] Verificando datos iniciales"
DATABASE_URL="$URL_DIRECTA" node dist/db/bootstrap.js

echo "[entrada] Iniciando el servidor"
exec "$@"
