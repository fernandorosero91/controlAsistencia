# Reglas de negocio y elegibilidad del certificado

Este documento es el contrato funcional del sistema. Si el codigo y este texto discrepan,
prevalece el codigo, pero la discrepancia es un error que hay que corregir.

---

## 1. Asistentes

### 1.1 Identificacion

Cada asistente tiene tres identificadores:

| Identificador     | Origen                                       | Uso                                                                                                                                      |
| ----------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `id`              | Institucional (cedula o codigo estudiantil)  | Clave primaria. Se normaliza a mayusculas sin espacios.                                                                                  |
| `codigo_registro` | Generado por el sistema                      | 6 caracteres del alfabeto `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (sin `O`, `I`, `0` ni `1` para que se pueda dictar). **Unico e inmutable.** |
| `email`           | Institucional o institucional del estudiante | Destino del codigo de registro y del QR. Opcional.                                                                                       |

- El `id` institucional es **inmutable** una vez creado.
- El `codigo_registro` es **inmutable** (garantizado por trigger en la base de datos).
- El formato del `id` se valida con una expresion regular **configurable** por el
  administrador (`seminario_config.id_regex`, por defecto `^[A-Z0-9]{4,20}$`).
- Al buscar durante el registro se acepta **cualquiera de los dos**: el operador puede
  escribir la cedula o el codigo corto, indistintamente.

### 1.2 Roles y semestre

- `rol` es `estudiante` o `docente`.
- El **semestre es obligatorio para estudiantes** y **nulo para docentes**. Lo garantiza un
  `CHECK` en la base de datos: `(rol = 'estudiante') = (semestre IS NOT NULL)`.
- El rango del semestre es de 1 a 30.

---

## 2. Registro de asistencia

### 2.0 Jornada vigente: la decide el reloj, no el operador

El operador **no elige la jornada**. La API calcula la **jornada vigente** con la hora del
servidor (`America/Bogota`) a partir del horario de cada jornada:

- Vigente = `inicio <= ahora <= fin`, mas un **margen de cierre** (20 minutos por defecto,
  configurable) para alcanzar a registrar las salidas.
- Fuera de ese rango **no hay jornada vigente** y la API responde `resultado: "no_permitido"`
  con la hora de la proxima jornada. El administrador puede **fijar la jornada en curso** desde
  Configuracion si el evento se corre o se adelanta.
- Todo registro con un `jornada_id` distinto al vigente se rechaza, incluso si la peticion no
  viene de la app (pestana vieja, llamada directa). **La unica excepcion** son los registros de
  la cola offline, que viajan con `registradoEn` (la hora de captura) y se aceptan con esa hora.

El refrigerio se deduce igual: se entrega el **tipo de refrigerio de la jornada vigente**, sin
que el operador tenga que escogerlo.

### 2.0.1 Accesos que controla el administrador

En **Configuracion > Accesos del operador** hay tres interruptores: **Ingreso**, **Refrigerio** y
**Salida**. Lo que este apagado:

- No aparece en la app del operador.
- La API responde `403 NO_AUTORIZADO` si alguien lo intenta por fuera de la app.

Los cambios se aplican de inmediato (el contexto del operador se refresca cada 20 segundos y al
volver a la app) y quedan registrados en la auditoria (`config.accesos_operador`).

### 2.1 Ingreso

1. El operador elige el modo **Ingreso** y escribe o escanea el ID o el codigo.
2. La API busca al asistente (activo) por `id` o `codigo_registro`.
3. Si **no existe**, responde `200` con `resultado: "no_encontrado"` y la interfaz ofrece la
   busqueda manual por nombre o apellido. **Nunca** un error 500.
4. Si **esta inactivo**, responde `resultado: "no_permitido"`.
5. Si la jornada **no es la vigente**, responde `resultado: "no_permitido"` indicando cual es la
   jornada activa.
6. Si la jornada **no tiene abierta la ventana de check-in** y el administrador no habilito
   "permitir registro fuera de ventana", responde `resultado: "fuera_de_ventana"` con el
   horario de la ventana.
7. La escritura es atomica:

   ```sql
   INSERT INTO asistencias (asistente_id, jornada_id, hora_ingreso, registrado_por, ...)
   VALUES (...) ON CONFLICT (asistente_id, jornada_id) DO NOTHING RETURNING id;
   ```

8. Si se creo el registro: `resultado: "exito"`.
9. Si no se creo porque ya existia: `resultado: "duplicado"` con la **hora del registro
   original**, la **jornada** y **quien lo registro**. Esto aplica **aunque el segundo intento lo
   haga otro operador**: la base de datos garantiza un solo ingreso por persona y jornada.

### 2.2 Salida (cierre)

- Solo es posible si existe un ingreso en la misma jornada.
- Es una unica operacion: `UPDATE ... WHERE hora_salida IS NULL`.
- Si la salida ya existia: `resultado: "duplicado"` con la hora de la salida original.
- Si no hay ingreso: `resultado: "no_permitido"`.

### 2.3 Alertas de la interfaz

| Situacion        | Color | Icono       | Mensaje                                         |
| ---------------- | ----- | ----------- | ----------------------------------------------- |
| Registro creado  | Verde | check       | "Registro exitoso"                              |
| Ya existia       | Ambar | alerta      | "Asistencia ya registrada" + hora y responsable |
| ID no encontrado | Rojo  | equis       | "ID no encontrado" + busqueda manual            |
| Fuera de ventana | Ambar | informacion | Horario de la ventana y a quien llamar          |
| No permitido     | Rojo  | equis       | Motivo (inactivo, sin asistencia...)            |

Un duplicado **nunca** es un error de servidor.

---

## 3. Refrigerios

- Un refrigerio pertenece a una jornada (`tipos_refrigerio.jornada_id`).
- Solo se entrega si el asistente **tiene asistencia registrada en esa jornada**.
- La unicidad la impone `UNIQUE (asistente_id, tipo_refrigerio_id)`.
- Un duplicado responde `resultado: "duplicado"` con la hora de la entrega previa y quien la
  realizo.

### 3.1 Souvenirs y regalos

- El souvenir **no pertenece a una jornada**: se entrega una vez por evento.
- Solo se entrega a quien tenga **al menos una asistencia** registrada en el seminario.
- La unicidad la impone `UNIQUE (asistente_id, tipo_souvenir_id)`, con la misma escritura atomica
  (`ON CONFLICT DO NOTHING`).
- Un duplicado responde `resultado: "duplicado"` con la fecha y el operador de la entrega previa,
  aunque el segundo intento lo haga otro operador.
- El modulo se activa en **Configuracion > Accesos del operador > Souvenir** y viene **apagado**;
  mientras este apagado, la API responde `403`.
- Para saber a quien se le entrego y a quien no: **Reportes > Souvenirs entregados** y
  **Souvenirs pendientes**.

---

## 4. Elegibilidad para el certificado

La elegibilidad se **calcula en cada consulta**, nunca se persiste como un hecho
irreversible. Por eso, cambiar la hora de fin o la tolerancia en el panel tiene efecto
inmediato, sin migraciones ni scripts.

### 4.1 Reglas

Un asistente es **elegible** si cumple las condiciones siguientes:

1. **Asistencia en todas las jornadas exigidas.**
   - Si `exigir_ambas_jornadas = true`: debe tener ingreso en **las dos** jornadas.
   - Si `exigir_ambas_jornadas = false`: basta con la asistencia en la **jornada de cierre**
     (la de `fin` mas tardio).
2. **Ingreso y salida en cada jornada exigida** (las **4 marcas**: ingreso y salida de la manana y
   de la tarde). Es la regla oficial y la aplican igual el certificado en Word y la copia PDF.
3. **Permanencia hasta el final:** alguna salida debe cumplir

   ```
   hora_salida >= hora_fin_seminario - tolerancia_minutos
   ```

4. **Permanencia minima en cada jornada exigida:**

   ```
   hora_salida - hora_ingreso >= minimo_permanencia_horas
   ```

   El valor es configurable en **Configuracion > Permanencia minima por jornada** (3 horas por
   defecto). Con `0` la regla no se aplica. Al cambiarlo, la elegibilidad se recalcula en la
   siguiente consulta, sin migraciones ni scripts.

### 4.2 Motivos de inelegibilidad

| Motivo                      | Significado                                                    |
| --------------------------- | -------------------------------------------------------------- |
| `falta_asistencia_jornada`  | No tiene ingreso en una de las jornadas exigidas.              |
| `sin_registro_salida`       | Le falta la salida en alguna jornada exigida.                  |
| `salida_antes_de_hora_fin`  | Registro la salida antes de la hora de fin mas la tolerancia.  |
| `permanencia_insuficiente`  | Permanecio menos horas que el minimo en una jornada exigida.   |
| `sin_jornadas_configuradas` | El seminario no tiene jornadas (error de configuracion).       |

El panel muestra estos motivos junto al nombre del asistente, para que la coordinacion
sepa exactamente que falta.

### 4.3 Ejemplo con los parametros del evento

- Evento: 27 de octubre de 2026, jornadas de 8:00 a 12:00 y de 14:00 a 18:00.
- `hora_fin_seminario = 2026-10-27 18:00 (America/Bogota)`.
- `tolerancia_minutos = 15`, por lo que el umbral de salida es **17:45**.
- `minimo_permanencia_horas = 3`.

| Escenario                                                                  | Resultado                               |
| -------------------------------------------------------------------------- | --------------------------------------- |
| Ingreso y salida en ambas jornadas, salida final a las 18:10               | Elegible                                |
| Lo mismo, pero sale a las 17:40                                            | No elegible: `salida_antes_de_hora_fin` |
| Ingresa a la manana y no registra salida                                   | No elegible: `sin_registro_salida`      |
| Solo asiste a la manana                                                    | No elegible: `falta_asistencia_jornada` |
| Ingresa 08:05 y sale 09:30 en la manana, y completa la tarde               | No elegible: `permanencia_insuficiente` |
| Ingresa y sale solo en la tarde, con `exigir_ambas_jornadas = false`       | Elegible                                |

---

## 5. Emision de certificados

### 5.1 Quién puede emitir

**Solo el rol `admin`.** El rol `operador` no puede listar, emitir, descargar ni revocar
certificados: la API responde `403` y la interfaz no muestra esas acciones.

### 5.2 Emision individual

- Si el asistente es elegible: se emite.
- Si **no** es elegible: la API responde `409` con los motivos y **no** emite.
- El administrador puede forzar la emision con **excepcion manual**, que exige un **motivo de
  al menos 10 caracteres**. La excepcion queda en la tabla de certificados (`excepcion_manual`,
  `motivo_excepcion`) y en la auditoria.

### 5.3 Emision en lote

- El lote se crea con los asistentes elegibles y se procesa en segundo plano.
- El panel muestra el progreso: total, procesados, exitosos, fallidos y porcentaje.
- Un fallo individual no detiene el lote: queda registrado en `errores`.
- Al terminar se puede descargar el **ZIP** con un PDF por asistente.

### 5.4 Revocacion

- Un certificado se puede revocar con un motivo obligatorio (minimo 10 caracteres).
- Tras la revocacion, la verificacion publica responde "no valido".
- La revocacion queda auditada con el estado anterior y el motivo.

### 5.5 Regeneracion

- Un certificado emitido puede **regenerarse** (por ejemplo, si cambian los datos del
  evento). Se conserva el **mismo codigo de verificacion** y se actualiza el PDF y su hash.

### 5.6 Verificacion publica

`GET /publico/verificar/:codigo` (con rate limit por IP) devuelve **solo**:

- Validez del certificado.
- Nombre del titular, rol, seminario, fecha de emision, intensidad horaria y estado.

No expone el ID institucional, el correo ni ningun dato de la lista de asistentes.

### 5.7 Certificado en Word (.docx) por plantilla

Flujo adicional al PDF, administrado por el panel **Crear certificados**:

- **Regla de habilitacion:** solo se genera el certificado de los asistentes con las **4 marcas**:
  ingreso y salida registrados en **cada** jornada (manana y tarde). Si faltara cualquiera de las
  cuatro, el asistente se omite y el resumen indica el motivo (`Falta: ...`). No hay excepcion de
  inclusion en este flujo: quien no cumple las 4 marcas no recibe el `.docx`.
- La plantilla es un `.docx` con los campos `{{nombre}}`, `{{cedula}}`, `{{id}}`, `{{rol}}` y
  `{{semestre}}`. El reemplazo respeta los runs en que Word divida el texto.
- Los documentos se persisten en disco en la carpeta **`certificadosGenerados`** (una subcarpeta por
  lote) junto con un **ZIP** del lote; el ZIP se descarga desde la interfaz.
- El lote queda registrado en `lotes_certificados_docx` con sus conteos (total, generados, omitidos).
- Cargar/actualizar/eliminar plantillas, generar lotes, descargar y eliminar lotes quedan auditados.
- Todo el modulo exige rol `admin`.

---

## 6. Excepciones manuales del administrador

El administrador puede registrar un ingreso o una salida manual cuando el sistema no
registro algo (por ejemplo, un ingreso por la puerta de servicio). **Siempre** con motivo
obligatorio de al menos 10 caracteres, y queda en la auditoria.

- No se puede crear un ingreso manual si ya existe uno para esa jornada: la API responde
  `409`.
- No se puede registrar una salida manual si no existe ingreso: la API responde `409`.

---

## 7. Importacion masiva

El archivo (XLSX o CSV) tiene las columnas:

| Columna     | Obligatoria      | Regla                                                                                                                      |
| ----------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `id`        | Si               | ID institucional, se normaliza a mayusculas y se valida con la expresion regular configurada.                              |
| `nombres`   | Si               | Texto, maximo 80 caracteres.                                                                                               |
| `apellidos` | Si               | Texto, maximo 80 caracteres.                                                                                               |
| `rol`       | Si               | `estudiante` o `docente`.                                                                                                  |
| `semestre`  | Solo estudiantes | Entero entre 1 y 30. Vacio en docentes.                                                                                    |
| `cedula`    | No               | Cedula de ciudadania: entre 5 y 20 caracteres alfanumericos, sin espacios ni guiones. **No puede repetirse** en el padron. |
| `email`     | No               | Correo valido. Destino del QR.                                                                                             |

El flujo es en **dos pasos**:

1. **Vista previa**: se valida fila a fila y se devuelve el informe de errores sin tocar la
   base de datos.
2. **Confirmacion**: se aplican solo las filas validas.

`codigo_registro` **no se importa**: lo genera el sistema. Tampoco se puede importar el
padron ya existente con un ID distinto (el `id` es inmutable).

La cedula se valida tambien contra el padron: la vista previa marca la fila con error si la
cedula ya esta registrada (y no es el mismo asistente) o si se repite dentro del archivo. Esa
fila no se importa, pero las demas si.

---

## 8. Auditoria

Quedan registradas, con usuario, IP, fecha y datos antes/despues:

- Inicio y cierre de sesion.
- Creacion y actualizacion de asistentes, e importacion masiva.
- Registros de ingreso, salida y entrega de refrigerio.
- Cambios de configuracion del seminario y de jornadas.
- Emision, revocacion y regeneracion de certificados.
- Envio de QR por correo.
- Exportacion de reportes.
- Operaciones administrativas sobre usuarios.
