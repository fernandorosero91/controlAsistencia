# Decisiones tecnicas

Cada decision indica el contexto, la alternativa descartada y el trade-off asumido.

---

## 1. ORM y esquema: Drizzle ORM con migraciones SQL versionadas

**Decision.** Drizzle define el esquema tipado en `apps/api/src/db/esquema.ts`; las migraciones
son archivos SQL en `apps/api/drizzle/*.sql` con bloques `-- migrate:up` y `-- migrate:down`,
aplicados por un runner propio que registra version y checksum en `schema_migrations`.

**Alternativas descartadas.**

| Alternativa | Motivo |
| --- | --- |
| Prisma | Su generador no produce bloques de reversa y su motor agrega una capa de runtime que este dominio no necesita. |
| Knex + SQL puro | Sin tipos: los errores de nombre de columna aparecen en ejecucion y no al compilar. |
| Migraciones generadas automaticamente | Se perdia el control de la reversibleidad y del orden, que es justo lo que exige este dominio. |

**Trade-off.** Hay que mantener el esquema de Drizzle y el SQL en paralelo. Se mitiga con el
checksum: si una migracion ya aplicada cambia, el runner lo detecta y falla en lugar de dejar
la base de datos en un estado incoherente.

**Por que importa aqui.** La integridad depende de `CHECK`, `UNIQUE` y `ON DELETE RESTRICT`, que
no se pueden expresar con seguridad en un ORM que es dueno del esquema.

---

## 2. Framework del backend: Fastify

**Decision.** Fastify 5 con TypeScript.

| Alternativa | Motivo del descarte |
| --- | --- |
| NestJS | Su inyeccion de dependencias y decoradores aportan estructura que el dominio no necesita, y su coste de CPU es mayor: en el pico de check-ins cada milisegundo cuenta. |
| Express | Sin esquema de respuesta, serializacion mas lenta y hooks menos ergonomicos. |

**Trade-off.** Fastify obliga a conocer sus plugins (encapsulamiento, decoradores, `schema` de
respuesta). A cambio: serializacion por esquema, validacion de respuesta y aislamiento real por
modulo.

---

## 3. Estado en el cliente: Zustand + TanStack Query

**Decision.** TanStack Query para todo lo que viene del servidor (cache, reintentos,
invalidacion) y Zustand para tres cosas: sesion, preferencias locales del operador y cola
offline.

**Alternativa.** Context de React para todo: obliga a re-renderizar el arbol completo en cada
cambio de sesion y no aporta cache ni invalidacion.

**Trade-off.** Dos mecanismos que aprender. Se mitiga con una regla simple: **el servidor es la
fuente de verdad y TanStack Query; Zustand solo guarda lo que el navegador controla**.

---

## 4. Idempotencia en dos niveles

**Decision.** Cabecera `Idempotency-Key` respaldada por la tabla `idempotencia`, **y** constraints
`UNIQUE` en la base de datos.

| Nivel | Que resuelve |
| --- | --- |
| `Idempotency-Key` | La app reintenta sin miedo: la segunda peticion devuelve la primera respuesta, sin repetir el efecto. |
| `UNIQUE (asistente_id, jornada_id)` | La garantia real: aunque se pierda la clave (por ejemplo, si el operador reinstala la PWA), no se puede crear un segundo ingreso. |

**Por que no basta la clave.** El ID institucional es predecible y la app trabaja sin conexion:
un dispositivo puede reintentar con una clave nueva. La garantia de no duplicado tiene que
estar en el dato, no en el cliente.

---

## 5. Generacion del codigo de registro

**Decision.** Cada asistente recibe un **codigo de registro** de 6 caracteres del alfabeto
`ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (sin `O`, `I`, `0` ni `1`), generado por la aplicacion y
protegido por un indice unico y un trigger de inmutabilidad.

| Alternativa | Motivo del descarte |
| --- | --- |
| Usar el ID institucional en el QR | La cedula es larga y contiene digitos ambiguos: dictarla en un aula con ruido es lento y propenso a errores. |
| Codigo numerico de 6 digitos | Los `0` y `1` se confunden al dictarlos. |
| UUID completo | Demasiado largo para leer en voz alta. |

**Trade-off.** El asistente tiene dos identificadores (el institucional y el corto). A cambio,
el operador puede dictar un codigo de 6 caracteres sin ambiguedad y la aplicacion acepta
**cualquiera de los dos** en el mismo campo.

---

## 6. Verificacion previa del nombre

**Decision.** Antes de registrar, la aplicacion **verifica** el codigo y muestra el nombre del
asistente, su rol y el estado de cada jornada. El boton de registro permanece deshabilitado
mientras no exista una verificacion valida del texto actual.

**Por que.** El QR de un asistente es un documento que puede hacerse copiar o falsificar.
Mostrar el nombre permite contrastarlo con la escarapela y con el rostro antes de registrar:
es la unica barrera real contra registrar a otra persona.

**Trade-off.** Un paso mas en el flujo. Se mantiene por debajo de los tres toques: escribir o
escanear (que verifica solo) y confirmar.

---

## 7. Importacion masiva en dos pasos

**Decision.** Vista previa (validacion fila a fila, sin escribir) y luego confirmacion.

**Por que.** Importar 600 filas con un error de formato en la fila 312 y descubrirlo despues es
un problema operacional: el evento empieza en dos horas. La vista previa deja corregir el
archivo antes de tocar la base de datos.

**Trade-off.** Dos pasos en lugar de uno. Se compensa con una plantilla XLSX descargable desde el
propio panel, con las columnas exactas y una hoja de instrucciones.

---

## 8. Correo electronico: opcional, con salida en papel

**Decision.** El envio del codigo de registro y el QR por correo usa SMTP configurable. **Si no
hay SMTP configurado la funcion no falla**: lo indica y el administrador usa la **carta de QR en
PDF**, que es un camino de primera clase y no un plan B.

**Por que.** Un servidor SMTP que no responde el dia del evento no puede dejar a 600 personas
sin codigo. El sistema tiene que funcionar sin el.

**Trade-off.** Dos caminos de entrega que mantener. A cambio, ninguno depende del otro.

---

## 9. Cola de emision masiva: BullMQ con Redis y respaldo en el proceso

**Decision.** Con Redis, la emision en lote se procesa en una cola **BullMQ** (reintentos
exponenciales, concurrencia limitada a 2 lotes, progreso consultable). Sin Redis, el lote se
procesa en el proceso de la API con la misma mecanica de progreso y reintentos por elemento.

**Por que no un proceso dedicado.** El lote son unos cientos de PDF: un worker dedicado seria
mas infraestructura (proceso, despliegue, monitoreo) sin ganancia proporcional.

**Trade-off.** Sin Redis, si la API se reinicia durante el lote, este se pierde. Con Redis,
`jobId` es el `loteId`, de modo que reencolar el mismo lote no duplica trabajo.

---

## 10. Cache y rate limit: Redis con respaldo en memoria

**Decision.** Redis es el almacen compartido. Si no esta disponible, la API sigue operando con
cache en memoria **por proceso** y rate limit local.

**Consecuencia documentada.** Con varias replicas y sin Redis, el limite de solicitudes se
aplica **por replica**: el limite efectivo es `limite x replicas`. En el despliegue documentado
Redis es obligatorio.

---

## 11. Pool de conexiones y PgBouncer

**Decision.** `pg-pool` con 20 conexiones por instancia, PgBouncer en modo `transaction` y
`max_connections = 200` en PostgreSQL. El calculo esta en
[`01-arquitectura.md`](01-arquitectura.md).

**Por que PgBouncer.** Sin pooler, cada replica mantiene 20 conexiones reales: con varias
replicas se agotan rapido. En modo `transaction` las conexiones reales se comparten y se
liberan al terminar cada sentencia, que es el perfil de este sistema.

**Por que 20 y no mas.** El pico son 600 check-ins en 3 minutos: unas 4 escrituras por segundo.
Un pool mayor no aporta y compite por los recursos de PostgreSQL.

---

## 12. Generacion de PDF: pdf-lib

**Decision.** `pdf-lib` para el certificado y los carnets, y `qrcode` para las imagenes QR.

**Alternativa.** Puppeteer o un motor de plantillas (Handlebars con WeasyPrint) maquetan mejor,
pero requieren **Chromium o cairo en el servidor**, con cientos de megabytes de memoria y una
superficie de dependencias grande. Para una maqueta fija, `pdf-lib` es suficiente.

**Consecuencia.** La composicion es manual (coordenadas en puntos). El certificado tiene una
maqueta fija; lo variable son textos, imagenes y posiciones.

**Cache en disco.** El PDF se guarda en `CERTIFICADOS_DIR` y su SHA-256 queda en la base de
datos. Al descargar se compara el hash: si el archivo cambio, se regenera. Asi el certificado
descargado es siempre el emitido.

---

## 13. Identidad visual institucional

**Decision.** La paleta es la de la **Universidad Cooperativa de Colombia** (azul marino
`#132740`, cian `#00ACC9`, verde lima `#80BA27`, amarillo `#FFCE36`), con degradados derivados
de esa misma rampa. Tipografia **Montserrat**. Iconografia de **Lucide React**.

**Por que.** El sistema lo usa la institucion: identidad visual coherente con la marca y con la
referencia "gradient colored UI kit" aportada por la coordinacion.

**Contraste.** Verificado de forma automatica en `apps/web/test/contraste.test.ts` (WCAG AA: 4.5:1
en texto normal y 3:1 en el anillo de foco y los bordes con significado).

**Nota de proceso.** El enunciado original prohibia los degradados. Con la peticion explicita y la
referencia visual aportada, se autorizan **degradados propios** de la rampa institucional,
conservando la prohibicion de paletas genericas.

---

## 14. Pruebas: Vitest, Playwright y k6

| Herramienta | Alcance | Motivo |
| --- | --- | --- |
| Vitest | Unitarias (reglas de negocio) e integracion (concurrencia sobre PostgreSQL real) | Rapida, con tipado y sin navegador. |
| Playwright | E2E con viewport movil de 360x640 | Es el ancho real del operador; comprueba el flujo completo y la ausencia de desbordes. |
| k6 | Carga | Escenario de llegada realista (ramping arrival rate) y umbrales declarados en el codigo. |

**Decision adicional.** La prueba de concurrencia usa **100 peticiones simultaneas reales**
contra la base de datos (no un mock): el objetivo es demostrar que el constraint `UNIQUE` hace
su trabajo.

**Planificador Node equivalente.** `load-tests/run.mjs` reproduce los escenarios sin k6, para
que la verificacion de carga pueda ejecutarse en un equipo sin k6 instalado.
