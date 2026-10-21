#!/bin/sh
# ---------------------------------------------------------------------------
# Punto de entrada de PgBouncer.
#
# Genera el archivo de usuarios (auth_file) a partir de las variables de
# entorno del despliegue, de modo que no quede ninguna credencial escrita en el
# repositorio. La autenticacion con el cliente es scram-sha-256: PgBouncer
# acepta la contrasena en texto plano en el auth_file y calcula el intercambio
# SCRAM, y a su vez la usa para autenticarse contra PostgreSQL.
# ---------------------------------------------------------------------------
set -eu

: "${POSTGRES_USER:=app}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD es obligatoria para iniciar PgBouncer}"
: "${PGBOUNCER_AUTH_FILE:=/var/lib/pgbouncer/userlist.txt}"

umask 077
cat > "$PGBOUNCER_AUTH_FILE" <<EOF
"${POSTGRES_USER}" "${POSTGRES_PASSWORD}"
"postgres" "${POSTGRES_PASSWORD}"
EOF

exec pgbouncer "$@"
