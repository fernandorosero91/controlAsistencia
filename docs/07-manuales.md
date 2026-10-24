# Manuales breves

Dos manuales de una pagina: uno para el administrador y otro para el operador.

---

## Manual del administrador

### Antes del evento

1. **Verifique el sistema**: `docker compose ps` (todo en `healthy`) y
   `http://localhost:8080/api/health/ready` (debe responder `ok`).
2. **Importe el padron** (Importar): descargue la plantilla, complete las filas y revise la
   vista previa antes de confirmar.
3. **Entregue los codigos**: por correo (Carnets y QR > Enviar pendientes) o en papel (Descargar
   carta de QR).
   - El envio sale **uno cada 3 minutos (20 por hora)** para no caer en spam; puedes cerrar la
     pestaña, la cola sigue en el servidor.
   - En **Asistentes** la columna *Credencial* dice a quién ya se le envió, a quién está en cola y a
     quién le falló (con el motivo). El botón de cada fila permite **enviar o reenviar** solo a esa
     persona, y el filtro *Pendientes de envio* deja a la vista lo que falta.
   - Para saber si llegaron a la bandeja, pide a TI de la universidad la **traza de mensajes** del
     remitente.
4. **Imprima los carnets** (Descargar carnets).
5. **Revise la configuracion**: hora de fin (18:00), tolerancia (15 min), ventanas de check-in y
   si se permite registrar fuera de ventana.
6. **Cree las cuentas de los operadores** (Usuarios) y entréguelas en mano.

### Durante el evento

- **Panel de administracion** (Dashboard): asistencia por jornada, refrigerios, ritmo de ingreso,
  quien esta dentro y fuera, y cuantos son elegibles.
- Si un operador pierde el celular: desactive su cuenta en **Usuarios**.

### Al cerrar

1. Registre las **salidas** pendientes (es lo que define la elegibilidad).
2. **Certificados > filtre "No elegibles"** y revise los motivos de cada caso.
3. **Emita en lote** y espere el 100 %.
4. **Descargue el ZIP** y distribuyalo.
5. **Exporte los reportes** en CSV, Excel o PDF (asistencia, refrigerios, elegibilidad,
   certificados y auditoria).

### Certificados en Word (.docx)

El modulo **Certificados (Word)** genera el documento oficial de la Universidad a partir de la
plantilla institucional. El modulo **Certificados PDF** produce la copia verificable con codigo y
QR de consulta publica.

**Regla de habilitacion (igual para Word y PDF):** solo se genera el certificado de los asistentes
con las **4 marcas** (ingreso y salida de la **manana** e ingreso y salida de la **tarde**), que
hayan cumplido la **permanencia minima por jornada** (3 horas por defecto) y que hayan estado hasta
el **cierre del seminario**. Quien no cumpla queda omitido y se muestra el motivo (por ejemplo,
"Falta: salida Tarde" o "La permanencia en una de las jornadas exigidas fue menor al minimo").

1. **Prepare la plantilla** en Word y marque los datos del titular entre dobles llaves. Campos
   disponibles: `{{nombre}}`, `{{cedula}}`, `{{id}}`, `{{rol}}` y `{{semestre}}`.
2. **Cargue la plantilla** en **Crear certificados**. El sistema la guarda y muestra los campos
   detectados. Si no detecta ninguno, revise la ortografia de los marcadores.
3. Marque una plantilla como **Predeterminada** si va a ser la habitual (solo puede haber una).
4. Pulse **Generar certificados**, elija el rol de los asistentes (todos, estudiantes o docentes) y
   confirme. Solo entran los elegibles (las 4 marcas); el resumen indica cuantos se generaron y
   cuantos quedaron omitidos y por que.
5. **Caso especial:** si necesita el certificado de alguien que no cumplio el horario, marque
   **"Emitir tambien a quienes no cumplen las condiciones"** y escriba el motivo (minimo 10
   caracteres). Queda registrado en la auditoria.
6. Los `.docx` se guardan en la carpeta **`certificadosGenerados`** (una subcarpeta por lote) junto
   con un ZIP. En la seccion **Certificados generados**, el boton **Descargar ZIP** baja el lote.

Los errores por fila (por ejemplo, un asistente sin cedula) se listan sin detener el lote. Cargar,
actualizar, generar, descargar o eliminar un lote o una plantilla queda en la auditoria.

### Excepciones y errores

| Situacion                                     | Que hacer                                                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Un asistente no tiene certificado y si cumple | Certificados > **Excepcion**, con motivo obligatorio. Queda auditado.                                              |
| Se emitio un certificado equivocado           | **Revocar** con motivo. La verificacion publica pasa a "no valido".                                                |
| Un asistente no aparece en el padron          | Agreguelo en **Asistentes** (el sistema le asigna el codigo de registro) o importelo de nuevo.                     |
| Se registro un ingreso de mas                 | No se puede borrar: use **excepcion manual** para registrar la salida correcta y deje el registro en la auditoria. |

---

## Manual del operador

### Que hacer

1. Entre con el usuario que le entregaron. La sesion dura 15 minutos; si expira, entre de nuevo.
2. Elija el modo: **Ingreso**, **Refrigerio**, **Salida** o **Souvenir**. El sistema le muestra siempre la
   jornada activa.
3. **Escanee el QR** con el boton de camara, o **escriba** el codigo de 6 caracteres, o la
   cedula o el codigo estudiantil.
4. **Compare el nombre** que aparece en pantalla con la escarapela y con la persona. Si no
   coincide, **no registre**: pida la correccion.
5. Pulse **Registrar**. El campo queda limpio y listo para la siguiente persona.

### Que significa cada resultado

| Color                     | Significado                     | Que hacer                                                                                |
| ------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------- |
| **Verde**                 | Registro creado                 | Continúe con la siguiente persona.                                                       |
| **Ambar**                 | Ya estaba registrado            | Continúe: no es un error. El bloque muestra la hora y el operador del registro original. |
| **Rojo**                  | ID no encontrado o no permitido | Use la busqueda manual por nombre o llame a la coordinacion.                             |
| **Ambar con informacion** | Fuera de la ventana de registro | Avise a la coordinacion: puede habilitarla.                                              |

### Consejos

- **Dictar el codigo** es mas rapido que escribirlo: el codigo de 6 caracteres no tiene letras
  ni digitos ambiguos.
- Si el escaner falla (la camara necesita **HTTPS**), escriba el codigo a mano.
- La app **funciona sin internet**: guarda los registros en el celular y los sube cuando vuelve
  la red. Si ve el aviso "Sin conexion", continue registrando.
- El **bipido y la vibracion** se pueden apagar en los ajustes del operador.
- Al terminar la jornada, registre las **salidas**. Sin salida no hay certificado.

### A quien llamar

| Problema                            | Quien                       |
| ----------------------------------- | --------------------------- |
| El sistema no responde              | Soporte tecnico             |
| Un ID no aparece                    | Administrador del seminario |
| Necesita registrar fuera de ventana | Administrador del seminario |
| Perdio o rompio el celular          | Administrador del seminario |

---

## Creditos

Aplicacion desarrollada por estudiantes de Ingenieria de Software de la Universidad Cooperativa
de Colombia: **Elier Fernando Rosero Bravo** y **Edwar Alexander Benito Basante**.

### Souvenirs y regalos

El sistema tambien controla la entrega del souvenir o regalo del seminario, con una sola entrega
por asistente.

1. En **Configuracion > Souvenirs** cree el o los souvenirs (por ejemplo "Camiseta del seminario") y
   dejelos activos.
2. En **Configuracion > Accesos del operador** encienda el interruptor **Souvenir**.
3. El operador elige el modo **Souvenir**, escanea el ID y registra. Solo se entrega a quien tenga
   al menos una asistencia; el segundo intento muestra la alerta con la fecha y el operador que lo
   entrego.
4. Para saber quien lo recibio y quien no: **Reportes > Souvenirs entregados** y
   **Souvenirs pendientes** (CSV, Excel o PDF).
