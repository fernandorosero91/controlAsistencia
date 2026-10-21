# Despliegue en Dokploy

Guia de puesta en produccion del sistema de asistencia sobre **Dokploy** usando un unico
`docker-compose.dokploy.yml`.

Dokploy clona el repositorio, ejecuta `docker compose up -d --build` y expone el servicio que se le
indique. Todo el sistema (base de datos, pooler, cache, API y frontend) viaja en ese archivo: no hay
dependencias externas aparte de una base de datos y un dominio.

---

## 1. Que levanta el archivo

| Servicio    | Imagen / construccion               | Puertos       | Funcion                                                       |
| ----------- | ----------------------------------- | ------------- | ------------------------------------------------------------- |
| `postgres`  | `postgres:15-alpine`                | interno       | Datos, indices, constraints de unicidad                       |
| `pgbouncer` | `infra/docker/Dockerfile.pgbouncer` | interno       | Pool de conexiones en modo `transaction`                      |
| `redis`     | `redis:7-alpine`                    | interno       | Cache de configuracion, rate limit distribuido y colas BullMQ |
| `migrate`   | `infra/docker/Dockerfile.api`       | -             | Aplica el SQL versionado y termina (una sola ejecucion)       |
| `api`       | `infra/docker/Dockerfile.api`       | interno       | Fastify: auth, asistencias, refrigerios, certificados         |
| `web`       | `infra/docker/Dockerfile.web`       | `${WEB_PORT}` | nginx: sirve la React y hace proxy de `/api` a la API         |
| `seed`      | `infra/docker/Dockerfile.api`       | -             | Datos iniciales; solo con el perfil `datos`                   |

Flujo de una peticion:

```
navegador -> Traefik (Dokploy) -> web:80
                                   |-- /assets/*  y  /  -> React compilada
                                   '-- /api/*    -> api:3000 -> pgbouncer:6432 -> postgres:5432
                                                             '-> redis:6379
```

Solo `web` publica un puerto. La base de datos, el pooler, Redis y la API quedan en la red interna
del proyecto (`asistencia`); no son accesibles desde internet.

---

## 2. Requisitos

- Un servidor con Dokploy instalado (probado con Dokploy 0.20+ sobre Ubuntu 24.04 y Docker 27).
- El repositorio accesible: Dokploy puede clonarlo por HTTPS o por llave SSH.
- Un dominio con su registro A apuntando a la IP del servidor (el subdominio del evento).
- Recursos recomendados para ~600 asistentes: **2 vCPU, 2 GB de RAM, 20 GB de disco**.

---

## 3. Crear el servicio

1. **Create Project** (por ejemplo `asistencia`) y dentro **Create Service > Docker Compose**.
2. En **Provider** elija `Github` (o `Git`) y autorice el repositorio
   `fernandorosero91/controlAsistencia`.
3. Complete:

   | Campo            | Valor                        |
   | ---------------- | ---------------------------- |
   | Branch           | `main`                       |
   | Build Path       | `/`                          |
   | **Compose Path** | `docker-compose.dokploy.yml` |

4. Guarde. No despliegue todavia: primero faltan las variables.

---

## 4. Variables de entorno

Abra la pestana **Environment** del servicio y pegue el contenido de
[`.env.dokploy.example`](../.env.dokploy.example) completo, ajustando **obligatoriamente**:

| Variable            | Como obtenerla / que valor usar                                              |
| ------------------- | ---------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD` | Cadena larga y aleatoria: `openssl rand -hex 24`                             |
| `JWT_SECRET`        | `openssl rand -base64 48` (minimo 32 caracteres)                             |
| `BASE_URL_PUBLICA`  | El dominio real, **sin barra final**: `https://asistencia.gestionxpress.app` |
| `ADMIN_EMAIL`       | Correo del administrador del sistema                                         |
| `ADMIN_PASSWORD`    | Contrasena inicial del administrador (minimo 8 caracteres)                   |
| `COOKIE_SECURE`     | `true` si el dominio usa HTTPS (lo normal en Dokploy)                        |
| `WEB_PORT`          | Puerto del host para el acceso directo por IP; `8080` por defecto            |

Notas:

- **Nunca** cambie `POSTGRES_PASSWORD` despues del primer arranque: la base de datos ya se inicializo
  con esa clave y el pooler no podria autenticarse.
- `CORS_ORIGINS` se deja vacio a proposito: el frontend y la API comparten dominio y origen, asi que
  no hace falta abrir CORS.
- `SEED_ASISTENTES=0` en produccion. Evita cargar los 600 asistentes ficticios de ejemplo.
- Sin `SMTP_HOST` el envio de QR por correo queda deshabilitado y se usa la **carta de QR en PDF**,
  que no depende de internet.

---

## 5. Dominio y HTTPS

En el servicio creado, abra **Domains > Add Domain**:

| Campo        | Valor                          |
| ------------ | ------------------------------ |
| Host         | `asistencia.gestionxpress.app` |
| Path         | `/`                            |
| Service Name | `web`                          |
| Port         | `80`                           |
| HTTPS        | activado (Let's Encrypt)       |
| Certificate  | `Let's Encrypt`                |

Dokploy crea las etiquetas de Traefik y solicita el certificado. La aplicacion queda en
`https://asistencia.gestionxpress.app`.

> **Camara del celular.** El escaner de QR del operador usa `getUserMedia`, que el navegador solo
> habilita en **HTTPS** o en `localhost`. Sin dominio con certificado, el operador debe digitar el
> codigo de 6 caracteres; la app lo advierte y ofrece la entrada manual automaticamente.

El dominio configurado debe ser **el mismo** de `BASE_URL_PUBLICA`: de ahi salen los enlaces de los
QR de verificacion impresos en los certificados.

### 5.1 Dominio detras de Cloudflare

Si el registro DNS del subdominio esta **proxificado** (nube naranja de Cloudflare), como ocurre con
`asistencia.gestionxpress.app`, hay dos ajustes obligatorios en el panel de Cloudflare:

| Ajuste           | Pestana                     | Valor                                    |
| ---------------- | --------------------------- | ---------------------------------------- |
| SSL/TLS          | SSL/TLS > Overview          | **Full (strict)**                        |
| Always Use HTTPS | SSL/TLS > Edge Certificates | Activado (opcional, Traefik ya redirige) |

- **Full (strict)** es imprescindible: en modo `Flexible` Cloudflare habla HTTP con el servidor
  mientras Traefik redirige a HTTPS, y el navegador entra en un bucle de redirecciones.
- El desafio HTTP-01 de Let's Encrypt pasa sin problema por el proxy: Cloudflare reenvia
  `/.well-known/acme-challenge/*` al origen.
- El certificado de Cloudflare protege el tramo navegador-Cloudflare; el de Let's Encrypt protege
  Cloudflare-origen. Con Full (strict) ambos son validos.
- Cloudflare reescribe `X-Forwarded-For` y la API corre con `trustProxy`, de modo que el rate limit
  por dispositivo sigue funcionando. Aun asi, en la sede todos los celulares salen por la misma IP
  publica, por eso el limite de escaneo se configura agregado (1200 por minuto).
- Los QR de los certificados quedan atados a este dominio: cambiarlo despues invalida los codigos ya
  impresos.

---

## 6. Primera puesta en marcha

1. Pulse **Deploy**. Dokploy construye las imagenes y levanta la pila en este orden:
   `postgres` -> `pgbouncer` -> `redis` -> `migrate` -> `api` -> `web`.
   El servicio `migrate` aplica el SQL versionado y termina; si falla, la API no arranca.
2. Espere a que todos los servicios queden **healthy** (Dokploy lo muestra en **Deployments** y en
   **Containers**).
3. Cree los datos iniciales (administrador, operadores, configuracion del seminario y jornadas).
   Desde **Terminal** del servicio o por SSH en el servidor:

   ```bash
   cd /etc/dokploy/compose/<proyecto>-<id>/code
   docker compose -f docker-compose.dokploy.yml --profile datos run --rm seed
   ```

   El comando es idempotente: se puede repetir sin duplicar filas. Imprime las credenciales creadas.

4. Entre a `https://asistencia.gestionxpress.app`, inicie sesion con `ADMIN_EMAIL` / `ADMIN_PASSWORD` y
   **cambie la contrasena** desde el panel de usuarios.

---

## 7. Verificacion del despliegue

```bash
# Estado de los contenedores
docker compose -f docker-compose.dokploy.yml ps

# Salud de la API (debe responder {"estado":"ok","baseDatos":true})
curl -fsS https://asistencia.gestionxpress.app/api/health/ready

# Migraciones aplicadas
docker compose -f docker-compose.dokploy.yml run --rm migrate node dist/db/migrate.js status
```

En la interfaz:

1. Inicie sesion como administrador.
2. **Configuracion**: revise nombre del evento, fecha, hora de fin, tolerancia y firmas del
   certificado.
3. **Asistentes**: importe el CSV/XLSX real (Descargar plantilla > subir > vista previa >
   confirmar).
4. **Carnets / Carta QR**: descargue los PDF y verifique que cada uno lleva nombre, ID, codigo de
   registro y QR.
5. **Tomar asistencia**: abra la app del operador desde un celular con el mismo dominio.

---

## 8. Operacion

### Actualizar la aplicacion

Dokploy > **Deploy** (o `git push` con auto-deploy activado). Las migraciones nuevas se aplican solas
en el siguiente despliegue gracias al servicio `migrate`. Los volumenes (`postgres_datos`,
`redis_datos`, `certificados`) se conservan.

### Copia de seguridad

```bash
# Respaldo diario de la base de datos
docker compose -f docker-compose.dokploy.yml exec -T postgres \
  pg_dump -U app -d seminario -Fc > respaldo-$(date +%F).dump

# Restauracion
docker compose -f docker-compose.dokploy.yml exec -T postgres \
  pg_restore -U app -d seminario --clean --if-exists < respaldo-2026-10-26.dump
```

Los PDF de certificados viven en el volumen `certificados`; se respaldan aparte:

```bash
docker run --rm -v proyectoasistencia_certificados:/datos -v "$PWD":/salida \
  alpine tar czf /salida/certificados.tgz -C /datos .
```

### Registros

```bash
docker compose -f docker-compose.dokploy.yml logs -f api
docker compose -f docker-compose.dokploy.yml logs --tail=200 web
```

Los contenedores emiten JSON (una linea por evento) con `request-id`, y la rotacion esta limitada a
3 archivos de 10 MB por servicio.

### Escalar

- Una sola instancia de la API sostiene el evento con holgura (ver
  [`06-pruebas-carga.md`](06-pruebas-carga.md): p95 de 29 ms en escrituras).
- Si se agregan replicas de `api`, suba `default_pool_size` de PgBouncer en la misma proporcion
  (40 conexiones por replica) y el limite del servidor en `postgres.command` (`max_connections`).
- El limite de inicio de sesion es por cuenta (`IP + correo`), no por IP: varios operadores pueden
  compartir la red de la sede sin bloquearse entre si.

---

## 9. Problemas comunes

| Sintoma                                                                              | Causa y solucion                                                                                                                                                                 |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api` reinicia en bucle con `unable to determine transport target for "pino-pretty"` | Se forzo `NODE_ENV=development` en el contenedor. El compose de Dokploy fija `NODE_ENV: production`; no lo sobrescriba.                                                          |
| Log de PgBouncer: `unsupported startup parameter: statement_timeout`                 | `statement_timeout` se envia como parametro de arranque. Ya esta en `ignore_startup_parameters` y el limite se fija por rol en `infra/docker/postgres-init/01-ajustes.sql`.      |
| Log de PgBouncer: `no such user: app` o `"trust" authentication failed`              | Falta el archivo de usuarios. El `entrypoint.sh` del pooler lo genera desde `POSTGRES_USER` / `POSTGRES_PASSWORD`; verifique que esas variables lleguen al servicio `pgbouncer`. |
| `/api/health/ready` responde `503`                                                   | La API no alcanza la base. Revise `pgbouncer` (healthy) y que `POSTGRES_PASSWORD` no haya cambiado despues del primer arranque.                                                  |
| El login responde `429`                                                              | Limite de intentos por cuenta. Espere el `Retry-After` indicado (60 s por defecto) o ajuste `RATE_LIMIT_LOGIN_MAX`.                                                              |
| El escaner de camara no abre                                                         | El dominio no esta en HTTPS. Use el dominio con certificado o digite el codigo de 6 caracteres.                                                                                  |
| Los certificados muestran un enlace equivocado                                       | `BASE_URL_PUBLICA` no coincide con el dominio publico. Corrija la variable y regenere los certificados.                                                                          |
| `migrate` termina con codigo distinto de 0                                           | La API no arranca a proposito. Revise `logs migrate`; el SQL es reversible con `node dist/db/migrate.js down`.                                                                   |
| Cambio el dominio y los QR ya impresos no validan                                    | Los QR emitidos apuntan al dominio anterior: conserve el dominio o reimprima las cartas.                                                                                         |

---

## 10. Diferencias con el compose de desarrollo

| Aspecto            | `docker-compose.yml` (desarrollo)                             | `docker-compose.dokploy.yml` (produccion)        |
| ------------------ | ------------------------------------------------------------- | ------------------------------------------------ |
| Puertos publicados | postgres 5433, pgbouncer 6432, redis 6379, api 3000, web 8080 | solo `web` (`${WEB_PORT}`)                       |
| Migraciones        | manuales (`npm run migrate`)                                  | servicio `migrate` automatico en cada despliegue |
| Datos iniciales    | `npm run seed` (600 asistentes de ejemplo)                    | perfil `datos`, `SEED_ASISTENTES=0`              |
| Secretos           | valores por defecto comodos para local                        | obligatorios, sin valor por defecto (`:?`)       |
| Cookies            | `COOKIE_SECURE=false`                                         | `COOKIE_SECURE=true` (HTTPS)                     |
| Rotacion de logs   | sin limites                                                   | 3 archivos de 10 MB por servicio                 |

El compose de desarrollo se mantiene para trabajar en local; Dokploy usa exclusivamente
`docker-compose.dokploy.yml`.
