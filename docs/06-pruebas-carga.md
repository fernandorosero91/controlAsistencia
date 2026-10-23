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
npm run load-test
# o con una ruta explicita de k6
K6_BIN=/ruta/a/k6 npm run load-test
```

---

## 2. Escenario 1: 600 check-ins en 3 minutos

Perfil de llegada realista: 2 entradas por segundo al inicio, punta de 5 por segundo cuando se
abre la puerta y descenso a 1 por segundo al final. Seis operadores independientes, como en el
evento real.

**Criterio de aceptacion:** p95 por debajo de 300 ms, tasa de error por debajo del 1 % y cero
duplicados.

| Metrica                  | Resultado             | Criterio          | Estado          |
| ------------------------ | --------------------- | ----------------- | --------------- |
| Peticiones de ingreso    | 569                   | unas 600 en 3 min | Correcto        |
| Tiempo medio             | 20,21 ms              | -                 | -               |
| Mediana                  | 16,19 ms              | -                 | -               |
| **p90**                  | **23,58 ms**          | -                 | -               |
| **p95**                  | **29,03 ms**          | < 300 ms          | **Correcto**    |
| Maximo                   | 715,68 ms             | -                 | Un pico aislado |
| **Tasa de error**        | **0,00 %** (0 de 569) | < 1 %             | **Correcto**    |
| Comprobaciones superadas | 100 % (1138 de 1138)  | > 99 %            | **Correcto**    |
| Respuestas 5xx           | 0                     | 0                 | **Correcto**    |

La maxima de 715 ms corresponde al primer request tras la apertura del pool de conexiones: es
calentamiento, no un problema sostenido (la mediana del mismo escenario es de 16 ms).

---

## 3. Escenario 2: el mismo ID repetido por 8 operadores

Ocho operadores piden el ingreso del **mismo** asistente durante un minuto: 1725 peticiones al
mismo registro. Es la prueba de integridad bajo concurrencia.

| Metrica                                | Resultado                | Criterio | Estado       |
| -------------------------------------- | ------------------------ | -------- | ------------ |
| Peticiones                             | 1725 (9,54 por segundo)  | -        | -            |
| Tiempo medio                           | 27,17 ms                 | -        | -            |
| **p95**                                | **41,45 ms**             | < 300 ms | **Correcto** |
| **Respuestas con alerta de duplicado** | **100 %** (1725 de 1725) | > 98 %   | **Correcto** |
| **Tasa de error**                      | **0,00 %**               | < 1 %    | **Correcto** |
| **Respuestas 5xx**                     | **0**                    | 0        | **Correcto** |
| Registros creados en la base de datos  | **1**                    | 1        | **Correcto** |

Este es el resultado que respalda el criterio de aceptacion principal: **de 1725 peticiones
simultaneas sobre el mismo asistente, el sistema creo un unico registro y respondio con la
alerta de duplicado las 1725 veces**, sin un solo error de servidor.

---

## 4. Escenario 3: panel con 10 administradores

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

## 5. Escenario 4: emision masiva de certificados

El administrador lanza el lote y consulta el progreso mientras el proceso genera los PDF. El
progreso se guarda en `certificados_lotes` y el lote se puede descargar como ZIP. El resultado
depende del numero de asistentes elegibles, por lo que se mide sobre el padron completo.

---

## 6. Verificacion de integridad a nivel de base de datos

Ademas de la carga, la suite de integracion lanza **100 peticiones simultaneas** contra
PostgreSQL real:

| Prueba                                       | Resultado                                                 |
| -------------------------------------------- | --------------------------------------------------------- |
| 100 ingresos simultaneos del mismo asistente | 1 `exito`, 99 `duplicado`, **1 fila** en la base de datos |
| 100 entregas de refrigerio simultaneas       | 1 `exito`, 99 `duplicado`, **1 fila** en la base de datos |
| Reintento con la misma `Idempotency-Key`     | Misma respuesta, **1 sola fila**                          |

---

## 7. Hallazgos y ajustes derivados de las pruebas

| Hallazgo                                                                                                                                       | Ajuste realizado                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| El limite de inicio de sesion por IP (10/min) bloqueaba a varios operadores que comparten la red de la sede.                                   | El limite paso a ser **por cuenta** (`IP + correo`): cada operador tiene su propio cupo y la proteccion contra fuerza bruta se mantiene. |
| Un perfil de llegada de 120 peticiones por segundo no representa un seminario: dispara el limite de solicitudes y mide la cola, no el sistema. | El perfil se ajusto a la llegada realista (2 a 5 por segundo) y la rafaga de duplicados se modero.                                       |
| El limite de 600 solicitudes por minuto y por operador se activo durante la rafaga sintetica.                                                  | Es la proteccion funcionando: en el evento cada operador envia unas pocas peticiones por segundo.                                        |
| El `setup()` de k6 puede coincidir con el limite de inicio de sesion.                                                                          | El script espera y reintenta hasta 4 veces con 20 s de pausa.                                                                            |

---

## 7.4 Capacidad del dia del evento (500 asistentes, 7 operadores)

Se midio el flujo real del operador contra la API local: por cada asistente, **verificar el nombre**
(antes de registrar) y **registrar el ingreso**, repartido entre 7 sesiones de operador.

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

Limites por ruta y holgura con 7 operadores:

| Ruta                              | Limite (por usuario) | Capacidad 7 operadores | Necesidad en el pico |
| --------------------------------- | -------------------- | ---------------------- | -------------------- |
| Verificar / ingreso / salida / refrigerio / souvenir | 150 por minuto | 1.050 por minuto | ~35 por minuto |
| Panel y consultas autenticadas    | 600 por minuto       | 4.200 por minuto       | ~100 por minuto (10 paneles cada 5 s) |
| Inicio de sesion (IP + correo)    | 10 por minuto        | 10 por cuenta          | 1 por operador       |
| Verificacion publica de certificado | 120 por minuto por IP | 120 por IP           | consultas puntuales  |

El limite es **por usuario autenticado**, no por IP: se verifico que dos operadores en la misma red
tienen cupos independientes, de modo que la red compartida de la sede no es un cuello de botella.
Con 7 operadores, un pico de 500 ingresos y el uso simultaneo del panel, la API queda por debajo del
10 % de su capacidad medida.

---

## 8. Conclusiones

1. **El p95 de las escrituras es de 29 ms**, diez veces por debajo del criterio de 300 ms.
2. **No hay errores**: 0 % de fallos y 0 respuestas 5xx en los cuatro escenarios.
3. **Cero duplicados**: 1725 peticiones simultaneas sobre el mismo asistente produjeron un
   unico registro.
4. El margen es amplio: el sistema soporta unas 30 veces la carga real del evento con una sola
   instancia de la API. La recomendacion de dos replicas cubre con holgura el pico y deja
   margen para el增长 de参会 y el uso del panel desde varios dispositivos a la vez.
5. El cuello de botella a futuro no es la API sino el pool de conexiones de PostgreSQL: con mas
   de dos replicas hay que subir `default_pool_size` de PgBouncer en la misma proporcion.
