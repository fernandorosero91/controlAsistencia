# Guia de pruebas

Comandos, que se prueba y con que criterio se acepta.

---

## 1. Pruebas unitarias

```bash
npm test                        # los tres paquetes
npm -w @seminario/shared test    # reglas de negocio puras
npm -w @seminario/web test       # contraste de la paleta
```

**Cobertura de `@seminario/shared`** (reglas de negocio, sin base de datos):

| Grupo | Que verifica |
| --- | --- |
| Normalizacion del ID | Recorta, elimina espacios y pasa a mayusculas; es idempotente. |
| Formato del ID | Expresion regular por defecto y configurable; una expresion invalida no rompe. |
| Semestre por rol | Obligatorio en estudiantes, opcional en docentes, rango 1 a 30. |
| Elegibilidad | Asistencia en las jornadas exigidas, salida registrada, salida dentro de la tolerancia, recalculo al cambiar la hora de fin y motivos reportados. |
| Ventanas de check-in | Estado antes, dentro y despues, con los limites incluidos. |
| Formula de inyeccion | `=`, `+`, `-`, `@` y tab quedan escapados en las exportaciones. |
| Codigo de registro | 6 caracteres del alfabeto sin `O`, `I`, `0` ni `1`, reproducible y validable. |
| Codigo de verificacion | Formato `XXXX-XXXX-XXXX`. |

**Contraste de la paleta** (`apps/web/test/contraste.test.ts`): calcula la razon WCAG de 14
combinaciones de la paleta institucional y falla si alguna baja del minimo.

---

## 2. Pruebas de integracion (requieren base de datos)

```bash
docker compose exec -T postgres createdb -U app seminario_test   # una sola vez
npm run test:integration
```

La suite usa una base de datos **aislada** (`DATABASE_URL_TEST`). Si no esta definida, las
pruebas se omiten con un aviso, en lugar de fallar.

### 2.1 Prueba de concurrencia

`apps/api/test/integration/concurrencia.test.ts` lanza **100 peticiones simultaneas** contra
PostgreSQL real:

| Prueba | Resultado esperado |
| --- | --- |
| 100 ingresos simultaneos del mismo asistente | Exactamente **1** `exito` y **99** `duplicado`; en la base de datos **1 sola fila**. Ningun 5xx. |
| La alerta de duplicado | Muestra la hora del registro original y quien lo realizo. |
| 100 entregas de refrigerio simultaneas | Exactamente **1** `exito` y **99** `duplicado`; **1 sola fila**. |
| Refrigerio sin asistencia en la jornada | `no_permitido` y ninguna fila creada. |
| Reintento con la misma `Idempotency-Key` | Devuelve la misma respuesta y no duplica el registro. |
| Salida repetida | La primera registra, la segunda responde `duplicado`. |
| Salida sin ingreso | `no_permitido`. |
| Peticion sin sesion | `401`. |

Esta es la prueba que demuestra el criterio de aceptacion principal: **es imposible registrar
dos ingresos en la misma jornada ni dos entregas del mismo refrigerio**.

---

## 3. Pruebas de extremo a extremo (Playwright)

```bash
npm run test:e2e
```

Requieren la web (`:5173`) y la API (`:3000`) levantadas.

| Prueba | Verifica |
| --- | --- |
| Muestra el nombre del asistente antes de registrar | La tarjeta de verificacion trae nombre, rol, semestre, ID y codigo. |
| Flujo completo del operador | Verifica, registra ingreso, duplicado, refrigerio y salida. |
| Codigo de registro corto | El codigo de 6 caracteres encuentra al asistente. |
| ID inexistente | Alerta roja "ID no encontrado". |
| Sin desbordamiento horizontal | `scrollWidth <= clientWidth` a 360 px. |
| Botones de 48 px | Altura real del boton de registro. |
| Escaner disponible | El boton de camara esta presente. |
| Emision de certificado | Asistente elegible (tras registrar la salida en hora) pasa a `Emitido`. |
| Acceso al modulo del operador | Enlace "Tomar asistencia" en el menu y en el panel. |
| Verificacion publica | Un codigo inexistente se rechaza; uno emitido se confirma. |
| Navegacion del panel | Todas las secciones cargan sin errores. |

El **viewport movil de 360x640** es el ancho minimo soportado y el que usa la suite por defecto.

---

## 4. Verificacion operativa

```bash
node scripts/verificacion-operativa.mjs
```

Comprueba contra la API en ejecucion, en una sola corrida, los 35 puntos criticos: generacion
del codigo y del QR, rechazo del ingreso duplicado con los datos del original, rechazo del
refrigerio duplicado, registro unico de la salida, elegibilidad, emision, descarga, verificacion
publica, revocacion y control de acceso por rol.

---

## 5. Pruebas de carga

```bash
npm run load-test                    # usa k6 si esta instalado
K6_BIN=/ruta/a/k6 npm run load-test  # con una ruta explicita
```

Escenarios en `load-tests/k6/`:

| Escenario | Que mide |
| --- | --- |
| `checkin.js` | 600 check-ins en 3 minutos con llegada escalonada, mas 8 operadores repitiendo el mismo ID. |
| `dashboard.js` | 10 administradores consultando el panel cada 5 segundos. |
| `certificados.js` | Emision en lote y consulta del progreso. |

Si k6 no esta instalado, `load-tests/run.mjs` ejecuta un planificador Node equivalente con los
mismos criterios y el mismo informe.

Los resultados medidos estan en [`06-pruebas-carga.md`](06-pruebas-carga.md).
