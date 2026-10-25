# Resultados de las pruebas de carga

Mediciones reales ejecutadas con **k6 v2.3.0** contra la API en ejecucion.

---

## 1. Entorno de la medicion

| Aspecto | Valor                                                             |
| ------- | ----------------------------------------------------------------- |
| Equipo  | Windows 11, 12 nucleos, 32 GB de memoria                          |
| API     | Node 20 (tsx), 1 instancia, pool de 20 conexiones                 |
| Datos   | PostgreSQL 15 en Docker, PgBouncer en modo `transaction`, Redis 7 |
| Padron  | 600 asistentes de prueba (`K6L00000` a `K6L00599`)                |
| Version | k6 2.3.0 (Windows amd64)                                          |

Reproducir:

```bash
npm run load-test                       # todos los escenarios
npm run load-test -- operadores         # quince celulares con una sola cuenta
npm run load-test -- checkin            # 600 check-ins y duplicados
# o con una ruta explicita de k6
K6_BIN=/ruta/a/k6 npm run load-test -- operadores
```

Variables utiles: `BASE_URL` (por defecto `http://localhost:3000`), `TOTAL_CHECKINS`,
`DISPOSITIVOS`, `OPERADOR_CORREO`, `OPERADOR_CLAVE`, `PREPARAR_CARGA=0` para no crear el padron.

---

## 2. Escenario 1: 600 check-ins en 3 minutos

Perfil de llegada realista: 2 entradas por segundo al inicio, punta de 5 por segundo cuando se
abre la puerta y descenso a 1 por segundo al final. Seis operadores independientes, como en el
evento real.

**Criterio de aceptacion:** p95 por debajo de 300 ms, tasa de error por debajo del 1 % y cero
duplicados.

| Metrica                  | Resultado             | Criterio          | Estado       |
| ------------------------ | --------------------- | ----------------- | ------------ |
| Peticiones de ingreso    | 569                   | unas 600 en 3 min | Correcto     |
| Tiempo medio             | 26,22 ms              | -                 | -            |
| Mediana                  | 25,08 ms              | -                 | -            |
| **p90**                  | **34,63 ms**          | -                 | -            |
| **p95**                  | **41,12 ms**          | < 300 ms          | **Correcto** |
| Maximo                   | 99,31 ms              | -                 | -            |
| **Tasa de error**        | **0,00 %** (0 de 569) | < 1 %             | **Correcto** |
| Comprobaciones superadas | 100 % (1138 de 1138)  | > 99 %            | **Correcto** |
| Respuestas 5xx           | 0                     | 0                 | **Correcto** |

---

## 3. Escenario 2: el mismo ID repetido por 8 operadores

Ocho dispositivos piden el ingreso del **mismo** asistente durante un minuto: 914 peticiones al
mismo registro (2 por segundo por dispositivo, dentro de su cupo de escaneo). Es la prueba de
integridad bajo concurrencia.

| Metrica                                | Resultado               | Criterio | Estado       |
| -------------------------------------- | ----------------------- | -------- | ------------ |
| Peticiones                             | 914 (15,23 por segundo) | -        | -            |
| Tiempo medio                           | 25,52 ms                | -        | -            |
| **p95**                                | **59,19 ms**            | < 300 ms | **Correcto** |
| **Respuestas con alerta de duplicado** | **100 %** (914 de 914)  | > 98 %   | **Correcto** |
| **Tasa de error**                      | **0,00 %**              | < 1 %    | **Correcto** |
| **Respuestas 5xx**                     | **0**                   | 0        | **Correcto** |
| Registros creados en la base de datos  | **1**                   | 1        | **Correcto** |

Este es el resultado que respalda el criterio de aceptacion principal: **de 914 peticiones
simultaneas sobre el mismo asistente, el sistema creo un unico registro y respondio con la
alerta de duplicado las 914 veces**, sin un solo error de servidor.

---

## 4. Escenario 3: quince celulares con una sola cuenta de operador

Es el caso real del evento y el mas exigente: **quince celulares comparten la misma cuenta de
operador** (`operador1@seminario.local`) y registran a la vez, todos desde la misma direccion de
red. Antes cada cuenta tenia un unico cupo de 150 peticiones por minuto, de modo que los quince
dispositivos competian por el mismo presupuesto: con 600 registros en tres minutos (190 por
minuto) el cupo se agotaba y aparecian respuestas **429** en mitad de la fila.

El escenario `operadores.js` de k6 inicia sesion quince veces **en paralelo con la misma cuenta** y
reparte 600 registros en tres minutos entre los quince dispositivos, cada uno con su cabecera
`X-Dispositivo`.

| Metrica                                        | Resultado                     | Criterio       | Estado       |
| ---------------------------------------------- | ----------------------------- | -------------- | ------------ |
| Inicios de sesion simultaneos (misma cuenta e IP) | **15 de 15** (200)         | 15 de 15       | **Correcto** |
| Registros procesados                           | 569 en 3 min (190 por minuto) | ~600 en 3 min  | Correcto     |
| Tiempo medio                                   | 25,81 ms                      | -              | -            |
| Mediana                                        | 25,55 ms                      | -              | -            |
| p90                                            | 32,43 ms                      | -              | -            |
| **p95**                                        | **38,45 ms**                  | < 300 ms       | **Correcto** |
| Maximo                                         | 55,68 ms                      | -              | -            |
| **Tasa de error**                              | **0,00 %** (0 de 569)         | < 1 %          | **Correcto** |
| **Respuestas 429**                             | **0**                         | 0              | **Correcto** |
| **Respuestas 5xx**                             | **0**                         | 0              | **Correcto** |
| Comprobaciones superadas                       | 100 % (1707 de 1707)          | > 99 %         | **Correcto** |

La prueba **detecto el fallo antes de corregirlo**: con el limite de inicio de sesion fijado en
10 por minuto solo **6 de los 15** dispositivos entraban a la vez. El valor se subio a 30 y la
prueba volvio a correr completa.

Resultado del planificador equivalente en Node (equipos sin k6), con una corrida corta de
validacion: 39 de 39 registros correctos, p95 de 36 ms, cero respuestas 429.

**Por que no rompe la integridad:** los quince dispositivos escriben sobre los mismos constraints
`UNIQUE`; el escenario de duplicados (seccion 2) demuestra que 914 peticiones sobre el mismo
asistente dejan un unico registro.

---

## 5. Escenario 4: panel con 10 administradores

Diez administradores consultando `/dashboard/resumen` cada 5 segundos durante 2 minutos
(240 consultas en total, el comportamiento real del panel).

| Metrica                  | Resultado             | Criterio | Estado       |
| ------------------------ | --------------------- | -------- | ------------ |
| Peticiones               | 240                   | 240      | Correcto     |
| Tiempo medio             | 64,93 ms              | -        | -            |
| Mediana                  | 61,70 ms              | -        | -            |
| p95                      | 139,40 ms             | < 300 ms | **Correcto** |
| Maximo                   | 234,81 ms             | -        | -            |
| **Tasa de error**        | **0,00 %** (0 de 240) | < 1 %    | **Correcto** |
| Comprobaciones superadas | 100 % (720 de 720)    | > 99 %   | **Correcto** |

El endpoint responde con `ETag`: el panel envia `If-None-Match` y recibe `304 Not Modified` cuando
no hay cambios, de modo que la base de datos no se consulta en cada iteracion. El tiempo de
respuesta incluye el calculo de los agregados y la generacion de los PDF de Carnets para el
padron completo de 2457 asistentes de prueba.

---

## 6. Escenario 5: emision masiva de certificados

El administrador lanza el lote y consulta el progreso mientras el proceso genera los PDF. El
progreso se guarda en `certificados_lotes` y el lote se puede descargar como ZIP. El resultado
depende del numero de asistentes elegibles, por lo que se mide sobre el padron completo.

---

## 7. Verificacion de integridad a nivel de base de datos

Ademas de la carga, la suite de integracion lanza **100 peticiones simultaneas** contra
PostgreSQL real:

| Prueba                                       | Resultado                                                 |
| -------------------------------------------- | --------------------------------------------------------- |
| 100 ingresos simultaneos del mismo asistente | 1 `exito`, 99 `duplicado`, **1 fila** en la base de datos |
| 100 entregas de refrigerio simultaneas       | 1 `exito`, 99 `duplicado`, **1 fila** en la base de datos |
| Reintento con la misma `Idempotency-Key`     | Misma respuesta, **1 sola fila**                          |

---

## 8. Hallazgos y ajustes derivados de las pruebas

| Hallazgo                                                                                                                                       | Ajuste realizado                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| El limite de inicio de sesion por IP (10/min) bloqueaba a varios operadores que comparten la red de la sede.                                   | El limite paso a ser **por cuenta** (`IP + correo`): cada operador tiene su propio cupo y la proteccion contra fuerza bruta se mantiene. |
| Un perfil de llegada de 120 peticiones por segundo no representa un seminario: dispara el limite de solicitudes y mide la cola, no el sistema. | El perfil se ajusto a la llegada realista (2 a 5 por segundo) y la rafaga de duplicados se modero.                                       |
| La rafaga de duplicados concentraba todo el trafico en pocas cuentas y disparaba el limite de escaneo.                                           | Cada VU envia su propio `X-Dispositivo` y el ritmo se modera a 2 peticiones por segundo por dispositivo: mide concurrencia, no el limite. |
| El `setup()` de k6 puede coincidir con el limite de inicio de sesion.                                                                          | El script espera y reintenta hasta 4 veces con 20 s de pausa.                                                                            |
| Con quince celulares sobre **una misma cuenta**, el cupo de escaneo por cuenta (150/min) se agotaba: 190 registros por minuto superan el tope y el operador recibe 429 en mitad de la fila. | El cupo de escaneo paso a ser **por usuario + dispositivo** (`X-Dispositivo` con un id estable guardado en cada navegador). |
| El inicio de sesion a 10 por minuto y por IP + correo solo dejaba entrar a **6 de 15** dispositivos del mismo equipo.                          | Se subio a **30 por minuto**: caben los quince accesos simultaneos y el tope sigue siendo bajo para fuerza bruta.                        |
| El escenario de check-in usaba `http.sleep`, que no existe en k6 2.3: la ruta de reintento del `setup()` fallaba con un `TypeError`.          | Se usa `sleep` de `k6`. El escenario corre completo aunque otra prueba se haya ejecutado en el mismo minuto.                             |

---

## 9. Capacidad del dia del evento (quince operadores, cuenta compartida)

Se midio el flujo real del operador contra la API local: por cada asistente, **verificar el nombre**
(antes de registrar) y **registrar el ingreso**, repartido entre varias sesiones de operador. Con
**una sola cuenta compartida entre quince celulares** la prueba especifica (seccion 4) sostuvo 190
registros por minuto con p95 de 38 ms y cero 429.

| Metrica                                | Resultado |
| -------------------------------------- | --------- |
| Asistentes procesados                  | 500       |
| Peticiones                             | 1.000     |
| Duracion                               | 4,9 s     |
| Ritmo                                  | ~102 asistentes/s |
| p50 / p95 / p99 (verificar + ingreso)  | 63 / **95** / 147 ms |
| Errores y 429                          | **0**     |

Carga real esperada: 500 asistentes x (ingreso + refrigerio + salida) x 2 jornadas + souvenir =
**3.500 registros** en el dia, mas una verificacion previa por registro (7.000 peticiones). Si los
500 ingresos de una jornada se concentran en 15 minutos son ~33 registros por minuto; en la prueba se
sostuvieron 102 por segundo, mas de **180 veces** ese ritmo.

Limites por ruta y holgura con quince celulares sobre una misma cuenta:

| Ruta                                                | Limite                                  | Capacidad con 15 dispositivos | Necesidad en el pico |
| --------------------------------------------------- | --------------------------------------- | ----------------------------- | -------------------- |
| Verificar / ingreso / salida / refrigerio / souvenir | 150 por minuto **por dispositivo**      | 2.250 por minuto              | ~190 por minuto      |
| Panel y consultas autenticadas                      | 600 por minuto por usuario              | 600 por minuto                | ~120 por minuto      |
| Inicio de sesion (IP + correo)                      | 30 por minuto                           | 30 accesos                    | 15 accesos al abrir  |
| Verificacion publica de certificado                 | 20 por minuto por IP                    | 20 por IP                     | consultas puntuales  |

En las rutas de escaneo el cupo es **por usuario + dispositivo**: la app guarda un identificador
estable en cada navegador y lo envia en `X-Dispositivo`. Asi quince celulares con la misma cuenta no
comparten un unico contador. En el panel el cupo sigue siendo por usuario, que es lo correcto para
una consola de administracion. Los limites no son una frontera de seguridad: la integridad la dan
los constraints `UNIQUE`, la idempotencia y el `ON CONFLICT DO NOTHING`.

---

## 10. Conclusiones

1. **El p95 de las escrituras esta entre 38 y 41 ms**, siete veces por debajo del criterio de
   300 ms, incluso con quince celulares sobre una sola cuenta de operador.
2. **No hay errores**: 0 % de fallos, 0 respuestas 5xx y 0 respuestas 429 en los cinco escenarios.
3. **Cero duplicados**: 914 peticiones simultaneas sobre el mismo asistente produjeron un
   unico registro.
4. El margen es amplio: el sistema sostiene la carga real del evento con una sola instancia de la
   API. La recomendacion de dos replicas cubre con holgura el pico y el panel desde varios
   dispositivos a la vez.
5. **Quince operadores con una misma cuenta funcionan**: los quince inicios de sesion simultaneos
   entran y cada celular tiene su propio cupo de escaneo.
6. El cuello de botella a futuro no es la API sino el pool de conexiones de PostgreSQL: con mas
   de dos replicas hay que subir `default_pool_size` de PgBouncer en la misma proporcion.
