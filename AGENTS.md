# AGENTS.md

Documento rector del repositorio `proyectoAsistencia`.

Este archivo es la **fuente de verdad** para cualquier agente de IA (o persona) que trabaje en este
proyecto. Describe el contexto, las restricciones obligatorias, las decisiones de arquitectura y el
plan de fases. Si una instruccion de este documento entra en conflicto con una peticion puntual, gana
el documento salvo que la peticion sea explicita y se documente como decisionOverride en el
`CHANGELOG` del repositorio.

---

## 1. Rol del agente

Actuar como **arquitecto de software senior y desarrollador full-stack** con experiencia en sistemas
transaccionales de alta concurrencia, PostgreSQL, React, diseno de interfaces moviles y seguridad de
aplicaciones web. Se diseña e implementa de principio a fin el sistema.

Idiomas de trabajo: **codigo, interfaz, mensajes, logs, README y documentacion en espanol
(Colombia)**. Zona horaria de negocio: `America/Bogota`. Todo timestamp persistido es
`timestamptz`. Todo texto de interfaz pasa por `es-CO`.

---

## 2. Contexto del proyecto

- Seminario presencial con **~600 asistentes** (estudiantes y docentes) de una universidad.
- **2 jornadas**: manana y tarde. La asistencia se controla en ambas.
- Se controla la **entrega de refrigerios** para evitar entregas dobles y duplicidad de informacion.
- Se necesitan **reportes** de asistentes y de refrigerios.
- Los **certificados de asistencia los genera exclusivamente el administrador** del sistema, de forma
  individual y masiva. Los asistentes **NO** descargan certificados por su cuenta.
- La asistencia se registra a traves del **ID institucional del estudiante** (cada estudiante de la
  universidad ya tiene un ID personalizado), escaneando su QR/codigo o digitandolo manualmente.
- Picos de concurrencia esperados: ingreso masivo en pocos minutos, entrega de refrigerios en filas
  simultaneas y generacion masiva de certificados al finalizar el evento.

---

## 3. Stack tecnologico (obligatorio)

| Capa               | Tecnologia                                                                                                             |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Frontend           | React 18+ con TypeScript, Vite, React Router, TanStack Query, Zustand (o Context), Tailwind CSS, React Hook Form + Zod |
| Iconografia        | Una unica biblioteca: **Lucide React** (elegida por el agente; usar en toda la app)                                    |
| Backend            | Node.js 20+ con TypeScript y **Fastify**, validacion con Zod, documentacion OpenAPI/Swagger                            |
| Base de datos      | PostgreSQL 15+ con migraciones versionadas (**Drizzle ORM** + SQL versionado, ver 4.1)                                 |
| Pool de conexiones | `pg` + `pg-pool` en el backend, PgBouncer en modo `transaction` en docker-compose                                      |
| Cache y rate limit | Redis (rate limit distribuido + cache). Fallback en memoria documentado si Redis no esta disponible                    |
| PDF                | `pdf-lib` + `qrcode` (QR de verificacion). Modo masivo: PDF combinado o ZIP descargable                                |
| Infraestructura    | Docker + docker-compose (api, web, postgres, pgbouncer, redis, nginx), variables de entorno con `.env.example`         |
| Pruebas            | Vitest (unitarias e integracion), Playwright (E2E), k6 (carga)                                                         |

**Regla de instalacion:** todo paquete nuevo se instala **por comando** (`npm install <pkg> -w <workspace>`),
nunca editando el `package.json` a mano. Monorepo con **npm workspaces**.

---

## 4. Decisiones tecnicas tomadas (y su justificacion)

### 4.1 ORM: Drizzle ORM + SQL versionado en `drizzle/`

Justificacion: el proyecto depende de **integridad de datos** (constraints UNIQUE, CHECK, FKs
estrictas) y de consultas agregadas con indices. Drizzle da tipado estricto del esquema y genera
SQL explicito sinboxing, pero las migraciones se versionan a mano en `drizzle/*.sql` (cada archivo es
una migracion reversible con `up`/`down` explicitos) y se aplican con un runner propio que registra
el estado en `schema_migrations`. Ventaja frente a Prisma: el SQL es visible, auditable y reversible;
frente a Knex: tipado real en el codigo de aplicacion.

### 4.2 Backend: Fastify (no NestJS)

Justificacion: el dominio es pequeno y centrado en transaccion + idempotencia + rate limit. Fastify
ofrece _plugins_ con encapsulamiento (RBAC por plugin), `schema` de respuesta con serializacion
rapida, hooks nativos y menor costo de CPU/memoria que NestJS, lo que importa en el pico de 600
check-ins. NestJS solo se justifica si el equipo crece mucho; se documenta el trade-off.

### 4.3 Frontend: Zustand para estado global minimo + TanStack Query para datos remotos

Justificacion: la mayor parte del estado es cache del servidor (TanStack Query). Zustand solo para
estado de sesion, configuracion del seminario cacheada y la cola offline de registros pendientes
(IndexedDB). React Context se usa unicamente donde sea estrictamente local al arbol.

### 4.4 Iconos: Lucide React

Un solo set, tamaño por defecto 20, trazo 2 (stroke-width), consistente en toda la app.

### 4.5 Cola de generacion masiva y de correos: BullMQ sobre Redis

Justificacion: se requiere **progreso consultable**, **reintentos por elemento sin detener el lote** y
reintentos ante fallo individual. BullMQ da esas tres cosas de forma nativa y sobrevive reinicios.
El progreso vive en Redis y se refleja en BD (`certificados_lotes`) para poder consultarlo. La misma
infraestructura se usa para el **envio de credenciales por correo**: un trabajo por destinatario, con
concurrencia y ritmo limitados (`CORREOS_*`) para no saturar el servidor SMTP, y el avance se lee de
un hash en Redis. No se agrega RabbitMQ: la cola persistente y los reintentos ya estan cubiertos.

---

## 5. Diseno y experiencia de usuario (obligatorio, verificable)

### 5.1 Prohibiciones absolutas

1. **Prohibido el uso de emojis** en la interfaz, mensajes, README y documentacion. Toda senal visual
   se resuelve con **iconos de Lucide React** (check, alerta, usuario, escaner, reloj, etc.), con
   tamano y trazo consistentes. Esto aplica tambien a los comentarios de codigo, nombres de ramas y
   mensajes de commit.
2. **Prohibido usar paletas genericas o "por defecto"**, en particular el morado/indigo/violeta
   como color de marca y los degradados morado-azul tipicos de las plantillas. **Los degradados
   solo se usan si derivan de la rampa institucional** (ver 5.2 y la nota de DecisionOverride).
3. Prohibido emoji en cualquier artefacto generado (SQL seeds, fixtures, snapshots de test).

### 5.2 Paleta institucional (Universidad Cooperativa de Colombia)

Tokens en `apps/web/src/estilos/tokens.css` y `apps/web/tailwind.config.ts`. Los colores
institucionales se tomaron de la hoja de estilos oficial (`ucc.edu.co`):

| Color       | Valor     | Uso en el sistema                                        |
| ----------- | --------- | -------------------------------------------------------- |
| Azul marino | `#132740` | Primario: encabezado del panel, boton principal, titulos |
| Cian        | `#00ACC9` | Acento: datos, progreso, anillo de foco                  |
| Verde lima  | `#80BA27` | Detalle decorativo (reticula del certificado)            |
| Amarillo    | `#FFCE36` | Base de la familia de aviso                              |
| Gris claro  | `#EFEFEF` | Fondos de superficie y campos                            |
| Gris medio  | `#5F5E5E` | Texto secundario                                         |

Rampas de 10 a 12 pasos con nombres consistentes: `primario` (azul marino), `acento` (cian),
`lima`, `neutro`, `exito` (verde profundo), `aviso` (amarillo) y `error` (rojo).

Reglas de color semantico:

- **Verde** = exito (registro creado, refrigerio entregado).
- **Ambar** = "ya registrado" / duplicado (nunca es error).
- **Rojo** = error / no permitido / ID no encontrado.

**Degradados.** Se permiten, siempre derivados de la propia rampa institucional
(`--gradient-marca`: azul marino a cian) y nunca con la combinacion generica morado-azul de las
plantillas. Se usan solo en la banda superior del certificado, el encabezado del panel, el boton
principal y el relleno de las barras de progreso.

> **DecisionOverride (2026-10-21).** El enunciado original prohibia los degradados. Con la
> peticion explicita de la coordinacion y la referencia visual "gradient colored UI kit" se
> autorizan **degradados propios** derivados de la rampa institucional, conservando la
> prohibicion de paletas genericas.

**Contraste WCAG AA minimo** (texto normal 4.5:1, elementos de interfaz 3:1). La verificacion es
automatica en `apps/web/test/contraste.test.ts` y el resultado se documenta en
`docs/05-guia-diseno.md`.

### 5.3 Tipografia

Una sola familia sans-serif: **Montserrat** (la familia de la institucion y de la referencia
visual), servida localmente con `@fontsource/montserrat`, sin CDN externo. Escala: 12/13/15/16/18/20/24/30
px, pesos 400/500/600/700, `line-height` 1.4 en texto y 1.25 en titulos. Sin decoraciones
innecesarias.

### 5.4 Responsive mobile-first

- La app del **operador** debe funcionar perfectamente en celulares de **360 px** de ancho en adelante:
  botones de **minimo 48 px** de alto, campo de ID **siempre visible** y con teclado apropiado
  (`inputmode="numeric"` o `text` segun formato de ID), **sin scroll horizontal**, uso a una mano.
- El **panel de administracion** se adapta a tablet y escritorio: las tablas se transforman en
  **tarjetas** en pantallas pequenas o usan scroll horizontal controlado con la primera columna fija.
- Puntos de corte Tailwind: `sm` 640, `md` 768, `lg` 1024, `xl` 1280. Mobile-first (base sin prefijo).

### 5.5 Estados y accesibilidad

- Estados vacios, de carga (**skeletons**) y de error cuidados.
- Foco visible en todos los elementos interactivos (anillo `focus-visible` de 2 px con contraste).
- Etiquetas asociadas a todos los campos (`htmlFor` + `id`, o `aria-label`).
- `aria-live="polite"` (y `role="status"`) en el bloque de resultado del escaneo, para que el lector de
  pantalla anuncie el registro.
- Contraste AA verificado (test automatico).
- Iconos decorativos con `aria-hidden="true"`; iconos con significado con `aria-label` o texto
  asociado.

### 5.6 Retroalimentacion inmediata en cada registro

Bloque de resultado **a pantalla completa o muy prominente** con: icono, color semantico, nombre,
rol, ID y hora. Mas vibracion y sonido opcionales, configurables por el operador (preferencia local
persistida, por defecto activados con sonido). Nunca se navega a otra pagina para confirmar un
registro: el campo de ID se limpia y se re-enfoca para el siguiente.

---

## 6. Modelo de datos (DDL canonico)

Ver `apps/api/drizzle/0000_init.sql` (version de verdad) y `docs/04-reglas-negocio.md`.

### 6.1 `asistentes` (obligatorio)

- `id` **TEXT PRIMARY KEY**: ID institucional (cedula o codigo estudiantil), clave de negocio,
  **unico e inmutable**, normalizado (trim, sin espacios, mayusculas). Formato validado con una
  expresion regular **configurable** (`seminario_config.id_regex`, por defecto
  `^[A-Z0-9]{4,20}$`).
- `cedula_ciudadania` **TEXT NULL**: cedula de ciudadania (5 a 20 caracteres alfanumericos,
  normalizada sin espacios ni guiones). **Unica cuando existe** (indice unico parcial): dos
  asistentes no pueden compartir cedula. Opcional: se importa y se edita desde el panel, y
  tambien sirve como clave de busqueda en la app del operador.
- `codigo_registro` **TEXT UNIQUE e inmutable**: codigo corto de 6 caracteres generado por el
  sistema con el alfabeto `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (sin `O`, `I`, `0` ni `1`, para
  que se pueda dictar sin ambiguedad). **Es lo que codifica el QR.** La unicidad la impone un
  indice unico y la inmutabilidad un trigger.
- `email` **TEXT NULL**: correo institucional. Es el destino del envio del codigo de registro y
  del QR. Validado por formato, con indice parcial sobre `lower(email)`.
- `nombres` TEXT NOT NULL, `apellidos` TEXT NOT NULL.
- `semestre` INTEGER NULL: **obligatorio para estudiantes, nullable para docentes**.
- `rol` ENUM('estudiante','docente') NOT NULL.
- `created_at`, `updated_at` TIMESTAMPTZ NOT NULL DEFAULT now().
- CHECK: `rol = 'estudiante' AND semestre IS NOT NULL` OR `rol = 'docente'`. Es decir:
  `(rol = 'estudiante') = (semestre IS NOT NULL)`.
- **La busqueda durante el registro acepta el `id` o el `codigo_registro`**: el operador nunca
  tiene que saber cual de los dos digito.

### 6.2 Tablas

1. `asistentes` (campos de 6.1 + timestamps).
2. `seminario_config` (una sola fila, `id = 1`): nombre, fecha, `hora_fin_seminario` (TIMESTAMPTZ,
   **configurable por el administrador**), `tolerancia_minutos` (INTEGER), `exigir_ambas_jornadas`
   (BOOLEAN), intensidad horaria (INTEGER), `permitir_registro_fuera_de_ventana` (BOOLEAN), textos
   del certificado, **`firmas` (JSONB, hasta 3 firmantes)**, lugar, facultad, contacto,
   `id_regex`, `url_publica`, timestamps.
3. `jornadas`: id, nombre (`manana`/`tarde` o texto libre), `inicio`, `fin`,
   `ventana_checkin_inicio`, `ventana_checkin_fin`, `orden`.
4. `asistencias`: `asistente_id` FK, `jornada_id` FK, `hora_ingreso` TIMESTAMPTZ,
   `hora_salida` TIMESTAMPTZ NULL, `registrado_por` FK usuarios_sistema, `dispositivo` TEXT,
   `idempotency_key` TEXT UNIQUE. **UNIQUE (asistente_id, jornada_id).**
5. `tipos_refrigerio`: id, nombre, `jornada_id` FK, `activo` BOOLEAN, `orden`.
6. `entregas_refrigerio`: `asistente_id` FK, `tipo_refrigerio_id` FK, `entregado_at` TIMESTAMPTZ,
   `entregado_por` FK, `idempotency_key` TEXT UNIQUE.
   **UNIQUE (asistente_id, tipo_refrigerio_id).**
7. `usuarios_sistema`: id (UUID), nombre, email UNIQUE, `password_hash` (argon2id), rol
   ENUM('admin','operador'), activo BOOLEAN, `refresh_token_hash`, timestamps.
8. `certificados`: `asistente_id` UNIQUE FK, `codigo_verificacion` UNIQUE, `emitido_at`,
   `emitido_por` FK (admin), `hash_pdf` TEXT, `revocado` BOOLEAN, `motivo_revocacion` TEXT,
   `excepcion_manual` BOOLEAN, `motivo_excepcion` TEXT, `lote_id` FK NULL.
9. `auditoria`: id, `usuario_id` FK NULL, `accion` TEXT, `entidad` TEXT, `entidad_id` TEXT,
   `datos_antes` JSONB, `datos_despues` JSONB, `ip` INET, `user_agent` TEXT, `created_at`.
10. `certificados_lotes`: id, `solicitado_por`, `total`, `procesados`, `exitosos`, `fallidos`,
    `estado` (en_proceso/completado/fallido), `errores` JSONB, `iniciado_at`, `finalizado_at`.
11. `idempotencia`: clave, `usuario_id`, `endpoint`, `respuesta_hash`, `created_at`, UNIQUE
    (usuario_id, endpoint, clave). Respaldo en BD de la idempotencia por cabecera HTTP.

### 6.3 Requisitos de BD

- Indices pertinentes: PKs/FKs, `UNIQUE (asistente_id, jornada_id)`, `UNIQUE (asistente_id,
tipo_refrigerio_id)`, indice por `asistentes.apellidos` y por `nombres`, indice GIN con `pg_trgm`
  para busqueda por nombre/apellido, indice por `hora_ingreso` (ritmo de ingreso), indice por
  `entregado_at`.
- Constraints e integridad referencial estrictas (`ON DELETE RESTRICT` en datos historicos).
- Migraciones **reversibles** y seed con **600 asistentes ficticios**.
- Todas las fechas en `timestamptz`.
- Extensiones: `pgcrypto` (gen_random_uuid) y `pg_trgm`.

---

## 7. Reglas de negocio criticas (contrato funcional)

1. **Registro de asistencia por ID.** El operador digita o escanea el ID; **la jornada no la
   elige**: la determina el servidor con el horario de las jornadas (manana y tarde) y el margen
   posterior al cierre. La API rechaza cualquier registro con una jornada distinta a la vigente.
   El sistema busca al asistente y registra el ingreso con `INSERT ... ON CONFLICT DO NOTHING`.
2. **Alerta de registro duplicado.** Si el asistente ya tiene asistencia en esa jornada, el sistema
   **NO** crea otro registro y muestra una **alerta ambar prominente** con icono: "Asistencia ya
   registrada" + nombre, ID, hora del registro original y quien lo registro. **Nunca un error 500.**
   Si el ID no existe: alerta roja "ID no encontrado" con opcion de busqueda manual por
   nombre/apellido.
3. **Refrigerio sin doble entrega.** Misma logica atomica con `ON CONFLICT DO NOTHING`. Solo se
   entrega si el asistente tiene asistencia en la jornada correspondiente. Si ya recibio: alerta
   visible con hora y operador de la entrega previa.
4. **Elegibilidad de certificado.** Un asistente es elegible unicamente si:
   - Tiene asistencia en las jornadas exigidas (ambas si `exigir_ambas_jornadas = true`).
   - Registro de **ingreso y salida en cada jornada exigida** (las **4 marcas**: ingreso y salida de
     la manana y de la tarde). Es la regla oficial de la Universidad y la aplican por igual el
     certificado en Word y la copia verificable en PDF.
   - Permanecio **hasta que finalizo el seminario**: alguna salida con
     `hora_salida >= hora_fin_seminario - tolerancia`, segun la hora configurada por el administrador.
   - **Permanecio el minimo de horas configurado en cada jornada exigida**
     (`minimo_permanencia_horas`, 3 horas por defecto, ajustable por el administrador; con 0 la
     regla no se aplica): `hora_salida - hora_ingreso >= minimo_permanencia_horas`.
   - La elegibilidad se **calcula en consulta/servicio**, **no se persiste** como hecho irreversible:
     si el administrador cambia la hora de fin, la tolerancia o el minimo de permanencia, aplica de
     inmediato.
   - El **formato oficial del certificado es Word (.docx)** desde la plantilla institucional; el PDF
     con codigo y QR es la copia verificable.
5. **Los certificados los emite solo el administrador.** Puede (a) generar el certificado de un
   asistente individual, (b) generar **en lote** los de todos los elegibles, (c) descargar el lote
   como ZIP o PDF combinado, (d) regenerar o revocar un certificado. El sistema **no permite emitir**
   a un no elegible, salvo **excepcion manual** del administrador con **motivo obligatorio**, auditada.
6. El administrador puede registrar **excepciones manuales** (ingreso o salida) con **motivo
   obligatorio**, quedando auditado.

---

## 8. Funcionalidades

### A. Panel de administracion (rol `admin`)

- Login seguro, gestion de usuarios operadores.
- Configuracion del seminario, jornadas, refrigerios, hora de fin y tolerancia.
- **Importacion masiva de asistentes** por CSV/XLSX con validacion fila a fila (formato del ID,
  duplicados, semestre segun rol), vista previa y reporte de errores.
- CRUD de asistentes con busqueda y filtros (rol, semestre).
- Generacion de **escarapelas/carnets con QR** por asistente y descarga masiva en PDF.
- **Modulo de certificados**: listado con estado (elegible, no elegible con motivo, emitido,
  revocado), emision individual y masiva, descarga, y barra de progreso del lote.
- **Dashboard en tiempo real** (polling cada 5 s o SSE): asistentes por jornada, % de asistencia,
  refrigerios entregados vs. pendientes, ritmo de ingreso por minuto, quienes estan dentro/fuera,
  cantidad de elegibles.
- **Reportes** con filtros y exportacion CSV/XLSX/PDF: asistencia por jornada, asistencia parcial,
  refrigerios entregados y pendientes, elegibles/no elegibles, certificados emitidos, auditoria.
- **Mantenimiento**: limpieza de los datos operativos (padron, asistencias, refrigerios,
  certificados y auditoria) para volver a probar. Exige la **contrasena del administrador** y la
  frase `BORRAR TODOS LOS DATOS`; conserva configuracion, jornadas, refrigerios y cuentas. Se
  puede deshabilitar con `LIMPIAR_BASE_HABILITADO=false`.

### B. Aplicacion de operador (rol `operador`, mobile-first)

- Pantalla principal con **campo de ID grande y enfocado automaticamente**, y boton de **escaner con
  la camara** (`html5-qrcode` o `@zxing/browser`) como alternativa.
- Busqueda de respaldo por nombre o apellido.
- Modos de trabajo: **Ingreso**, **Refrigerio**, **Salida/Cierre** y **Souvenir**. **La jornada y el
  refrigerio los determina el sistema por el horario**; el operador no los elige. El administrador
  decide que modos estan visibles (interruptores en Configuracion) y la API rechaza los que esten
  apagados.
- Contador en vivo de los registros de la jornada en curso, actualizado cada 20 segundos.
- Tras cada registro, el campo se limpia y se enfoca de nuevo (flujo continuo, minimo de toques).
- Resultado inmediato: exito (verde), ya registrado (ambar), no encontrado/no permitido (rojo), con
  icono, nombre, rol y hora.
- Historial corto de los ultimos registros de la sesion.
- **Cola offline (PWA + IndexedDB)**: si se cae la red, guarda los registros con `idempotency_key` y
  los sincroniza al volver la conexion, sin duplicar. Indicador visible de estado de conexion y de
  registros pendientes de sincronizar. **Documentado:** estando offline la deteccion de duplicados
  entre dispositivos se resuelve al sincronizar, y el conflicto se muestra al operador.

### C. Verificacion publica de certificados

- **Unica superficie publica**: `GET /publico/verificar/:codigo` y pagina `/verificar/:codigo`, que
  confirma la autenticidad (nombre, rol, seminario, fecha de emision, estado) sin exponer datos
  innecesarios. Con **rate limit**.
- El PDF del certificado incluye: nombre completo, ID, rol, nombre del seminario, fecha, intensidad
  horaria configurable, firmas, codigo de verificacion y QR a la URL de verificacion.

---

## 9. Concurrencia, rendimiento y resiliencia

1. **Pool de conexiones** dimensionado (por defecto `max: 20` por instancia) + PgBouncer en modo
   `transaction`. Calculo documentado: 2 replicas de API x 20 = 40 conexiones de aplicacion;
   PgBouncer `default_pool_size = 40`, `max_client_conn = 200`; Postgres `max_connections = 200`.
   Timeouts: `connectionTimeoutMillis = 5000`, `idleTimeoutMillis = 30000`,
   `statement_timeout = 10000` (15 s para reportes), `query_timeout = 12000`.
2. **Atomicidad.** Toda escritura critica es una sola sentencia atomica o transaccion corta, apoyada en
   constraints UNIQUE. **Nunca "consultar y luego insertar".**
3. **Rate limiting** por IP y por usuario/token, con limites distintos por ruta (login estricto,
   escaneo holgado por dispositivo, verificacion publica limitada por IP). Respuestas `429` con
   `Retry-After`.
4. **Idempotencia** mediante cabecera `Idempotency-Key` en endpoints de escritura.
5. **Cache** de configuracion del seminario y de agregados del dashboard (TTL de 2-5 s) para que el
   polling no sobrecargue la BD.
6. **Polling eficiente.** Endpoints de dashboard livianos con `ETag` / `If-None-Match`. SSE
   documentado como alternativa. Sin N+1. Consultas agregadas indexadas.
7. **Generacion masiva de certificados** con concurrencia controlada (cola BullMQ), procesamiento por
   lotes con progreso consultable, cache del PDF generado y reintentos ante fallo individual sin
   detener el lote.
8. **Resiliencia.** Health checks (`/health/live`, `/health/ready`), graceful shutdown, reintentos con
   backoff en el cliente, timeouts, manejo centralizado de errores y logs estructurados (pino) con
   `request-id`.
9. **Compresion**, **paginacion obligatoria** en listados y limites de tamano de payload.

---

## 10. Seguridad

- Contrasenas con **argon2id**.
- **JWT de corta duracion + refresh token** en cookie httpOnly, `SameSite=Lax`, `Secure` en
  produccion, con rotacion y revocacion (hash del refresh token en BD).
- **RBAC estricto** (`admin` / `operador`) en cada endpoint. **La emision y descarga de certificados
  exige rol `admin`.**
- Validacion de entrada con **Zod** en todas las rutas; consultas **parametrizadas**.
- **Helmet**, CORS restrictivo, CSRF donde aplique (double-submit cookie para operaciones
  sensibles), validacion de cargas CSV/XLSX (tipo MIME, tamano maximo) y **proteccion contra
  inyeccion de formulas** en exportaciones (prefijo `'` en celdas que empiezan con `= + - @`).
- Como el QR codifica un ID institucional **predecible**, **todos los endpoints de registro exigen
  autenticacion de operador**; ningun dato personal se expone sin sesion.
- Cumplimiento de la **Ley 1581 de 2012 (Habeas Data, Colombia)**: aviso de tratamiento de datos,
  minimizacion, acceso restringido a roles autorizados,.rights de titular via administrador.
- Secretos **solo** por variables de entorno. Ningun secreto en el repositorio.
- **Auditoria** de acciones sensibles: emision/revocacion de certificados, excepciones manuales,
  cambios de configuracion,进口aciones, gestion de usuarios.

---

## 11. Estructura del repositorio (monorepo, npm workspaces)

```
proyectoAsistencia/
  AGENTS.md                 # este documento (fuente de verdad)
  README.md
  package.json              # workspaces + scripts raiz (dev, build, test, lint, migrate, seed, load-test)
  docker-compose.yml
  docker-compose.dokploy.yml # despliegue de produccion (Dokploy)
  .env.example
  .env.dokploy.example      # variables del despliegue en Dokploy
  .eslintrc.cjs / eslint.config.js
  .prettierrc
  tsconfig.base.json
  apps/
    api/                    # Fastify + TypeScript (rutas, servicios, repos, drizzle, jobs)
    web/                    # React + Vite + Tailwind (operador + admin + público)
  packages/
    shared/                 # tipos y esquemas Zod compartidos (contratos de API)
  infra/
    docker/                 # Dockerfile.api, Dockerfile.web
    pgbouncer/              # pgbouncer.ini, userlist.txt
    nginx/                  # reverse proxy
  docs/
    01-arquitectura.md
    02-decisiones-tecnicas.md
    03-operacion-dia-evento.md
    04-reglas-negocio.md
    05-guia-diseno.md
    06-pruebas-carga.md
    07-manuales.md
  load-tests/
    k6/                     # checkin.js, dashboard.js, certificados.js
  e2e/                      # Playwright (viewport movil 360x640)
```

Scripts raiz esperados: `dev`, `build`, `test`, `test:e2e`, `lint`, `format`, `migrate`,
`migrate:revert`, `seed`, `load-test`, `docker:up`, `docker:down`.

Convenciones: **ESLint + Prettier**, **commits convencionales**
(`feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `build`), sin emojis en los mensajes.

---

## 12. Especificacion de la API (ajustable con criterio)

```
POST   /auth/login
POST   /auth/refresh
POST   /auth/logout
GET    /auth/sesion
GET    /asistentes            (paginacion + filtros + busqueda)
POST   /asistentes
PATCH  /asistentes/:id
GET    /asistentes/:id
GET    /asistentes/verificar?codigo=...   (nombre del asistente antes de registrar)
GET    /asistentes/plantilla              (plantilla XLSX de importacion)
POST   /asistentes/importar/previa        (validacion fila a fila, sin escribir)
POST   /asistentes/importar/confirmar     (aplica las filas validas)
GET    /asistentes/carnets                (PDF de escarapelas con QR)
GET    /asistentes/carta-qr               (PDF con el codigo y el QR para entregar)
POST   /asistentes/enviar-qr              (encola el envio de la credencial por correo)
GET    /asistentes/enviar-qr/lote/:loteId (avance del envio)
POST   /asistencias/ingreso
POST   /asistencias/salida
POST   /asistencias/excepcion             (ingreso o salida manual, admin, con motivo)
GET    /asistencias/asistente/:asistenteId
POST   /refrigerios/entregar
GET    /refrigerios/estado/:asistenteId
GET    /refrigerios/tipos
POST   /souvenirs/entregar
GET    /souvenirs/estado/:asistenteId
GET    /souvenirs/tipos
POST   /souvenirs/tipos
PATCH  /souvenirs/tipos/:id
GET    /dashboard/resumen     (ETag / If-None-Match)
GET    /reportes/*            (?formato=csv|xlsx|pdf)
GET    /config
PUT    /config
GET    /jornadas
POST   /jornadas
PATCH  /jornadas/:id
GET    /certificados
POST   /certificados/emitir/:asistenteId
POST   /certificados/emitir-lote
GET    /certificados/lote/:loteId
GET    /certificados/lote/:loteId/descarga   (ZIP)
GET    /certificados/:asistenteId/pdf
POST   /certificados/:id/revocar
GET    /publico/verificar/:codigo
GET    /publico/seminario       (datos publicos del evento)
GET    /operador/contexto       (config, jornadas, jornada activa, refrigerios)
GET    /usuarios
POST   /usuarios
PATCH  /usuarios/:id
GET    /mantenimiento/resumen   (conteos de datos operativos)
POST   /mantenimiento/limpiar   (borra datos de prueba; exige contrasena de admin)
GET    /health/live
GET    /health/ready
```

La especificacion **OpenAPI se genera automaticamente** (Fastify Swagger) y se expone en
`/docs` (Swagger UI) y `/openapi.json`.

---

## 13. Calidad y pruebas

- **Unitarias** de reglas de negocio: elegibilidad, ventanas de check-in, tolerancia, formato del ID,
  normalizacion de ID, validacion de semestre por rol, proteccion contra inyeccion de formulas.
- **Integracion de concurrencia**: 100 peticiones simultaneas de refrigerio e ingreso para el mismo
  asistente; verificar **exactamente 1 registro** y que las demas respondan con la alerta de
  duplicado (estado `200`/`409` con cuerpo de alerta, nunca 500).
- **E2E con Playwright**, incluyendo **viewport movil 360x640**: importar, registrar ingreso por ID,
  intentar ingreso duplicado y ver la alerta, entregar refrigerio, registrar salida, emitir
  certificado como admin.
- **Carga con k6**: 600 check-ins en 3 minutos, dashboard con polling de 10 administradores y emision
  masiva de certificados. Umbrales: **p95 < 300 ms** en escrituras, **0 % duplicados**, **error rate
  < 1 %**.
- Revision de accesibilidad y contraste de la paleta (test automatico de contraste + revision
  manual documentada).

---

## 14. Entregables

1. Codigo completo y funcional, ejecutable con `docker compose up`.
2. Migraciones y seeds.
3. README con arquitectura (diagrama Mermaid), decisiones tecnicas y trade-offs, instalacion,
   variables de entorno, **manual de operacion del dia del evento** y **plan de contingencia** (caida
   de internet, caida de BD).
4. Documento de reglas de negocio y elegibilidad del certificado.
5. Guia de diseno: paleta, tipografia, iconos usados y componentes.
6. Informe de resultados de pruebas de carga.
7. Manual breve para administrador y operador.

---

## 15. Forma de trabajo (obligatoria)

1. **Antes de escribir codigo**, presentar plan por fases con el DDL completo, la arquitectura, la
   paleta propuesta y la lista de decisiones. Si hay ambiguedades menores, decidir lo mas razonable,
   documentarlo y continuar; **solo preguntar si algo bloquea**.
2. Trabajar **por fases** con commits atomicos:
   1. Infraestructura y BD
   2. Auth y RBAC
   3. Asistentes e importacion
   4. Ingreso/refrigerios/salida con alertas de duplicado
   5. Dashboard y reportes
   6. Certificados administrados y verificacion publica
   7. PWA offline y pulido responsivo
   8. Pruebas, carga y documentacion
3. Despues de cada fase: **ejecutar tests y linter**, corregir y **resumir que quedo hecho**.
4. Sin datos hardcodeados en produccion, sin TODOs sin documentar, sin codigo muerto.
5. Priorizar **integridad de datos sobre velocidad de desarrollo** y simplicidad sobre
   sobreingenieria: el sistema atiende ~600 personas; dimensionar de forma proporcionada sin
   comprometer la robustez.
6. Si se detecta una regla contradictoria o un riesgo no contemplado, **reportarlo explicitamente**.

---

## 16. Criterios de aceptacion

1. Es **imposible** registrar dos ingresos a la misma jornada ni dos entregas del mismo refrigerio,
   incluso con peticiones simultaneas; el segundo intento siempre muestra la alerta con datos del
   registro original.
2. Un operador registra asistencia desde un celular **solo digitando el ID**, en **menos de 3 toques**
   por estudiante.
3. **Solo el administrador** puede emitir y descargar certificados; un no elegible no puede recibirlo
   sin excepcion auditada.
4. Al cambiar la hora de fin en el panel, la **elegibilidad se recalcula** sin migraciones ni scripts.
5. La interfaz **no contiene emojis**, usa una **unica biblioteca de iconos** y una **paleta propia
   sin morado ni degradados ajenos a la rampa institucional**.
6. Todos los reportes **se exportan y coinciden con los totales** del dashboard.
7. El sistema **soporta la prueba de carga** sin errores ni duplicados.
8. Un certificado emitido **puede verificarse publicamente** con su codigo.

---

## 17. Riesgos y observaciones reportados por el agente

- **R-01** El ID institucional es predecible (viene en el QR). Mitigacion: todo endpoint de registro
  exige sesion de operador, la API publica solo expone la verificacion de certificados, y el acceso a
  datos personales esta registrado en auditoria.
- **R-02** La deteccion de duplicados **entre dispositivos** no puede garantizarse en modo offline. El
  operador ve el conflicto en el momento de la sincronizacion; la garantia real de unicidad la da el
  constraint `UNIQUE` en la base de datos.
- **R-03** La fecha/hora del servidor es la unica referencia temporal: el reloj del celular no se usa
  para decisiones de negocio, solo se muestra como referencia local.
- **R-04** `exigir_ambas_jornadas` + `hora_salida` por jornada: la elegibilidad exige salida registrada
  **en la jornada** donde se imparte la jornada final del seminario. Documentado en
  `docs/04-reglas-negocio.md`.
- **R-05** Si el administrador modifica `hora_fin_seminario` despues de emitir certificados, los
  certificados ya emitidos **no se revocan solos** (la elegibilidad se recalcula, pero el documento
  emitido es un hecho historico auditable). Se documenta el procedimiento de re-emision/revocacion.

---

## 18. Souvenirs y regalos

Ademas de la asistencia y los refrigerios, el sistema controla la **entrega del souvenir o regalo**
del seminario, con el mismo criterio de una sola entrega por persona.

- **Modelo:** `tipos_souvenir` (id, nombre, activo, orden) y `entregas_souvenir`
  (asistente_id, tipo_souvenir_id, entregado_at, entregado_por, dispositivo, idempotency_key) con
  **`UNIQUE (asistente_id, tipo_souvenir_id)`**. La entrega es del **evento**, no de una jornada:
  no depende de la jornada vigente.
- **Requisito:** el asistente debe tener **al menos una asistencia** registrada en el seminario.
- **Sin doble entrega:** `INSERT ... ON CONFLICT DO NOTHING`; el segundo intento responde
  `resultado: "duplicado"` con la fecha y el operador que lo entrego, **aunque sea otro operador**.
- **Modulo configurable:** `seminario_config.operador_souvenir_habilitado` (apagado por defecto).
  Se activa en **Configuracion > Accesos del operador > Souvenir**. Apagado, la app no muestra el
  modo y la API responde `403`.
- **Operador:** modo **Souvenir** en la misma pantalla, con el tipo preseleccionado si hay uno solo y
  cola offline igual que los demas registros. **En este modo la app no muestra la jornada**: el
  souvenir es unico por seminario.
- **Reportes:** `souvenirs-entregados` (detalle con fecha y responsable) y `souvenirs-pendientes`
  (asistentes con asistencia que aun no lo recibieron), exportables en CSV, XLSX y PDF.
- **API:** `POST /souvenirs/entregar`, `GET /souvenirs/estado/:asistenteId`,
  `GET/POST /souvenirs/tipos`, `PATCH /souvenirs/tipos/:id`.
