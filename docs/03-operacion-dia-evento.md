# Operacion del dia del evento

Guia para la coordinacion del **IV Seminario de Ingenieria de Software** (27 de octubre de
2026, Camara de Comercio, Pasto). Esta es la lista que se sigue el dia del evento.

---

## 1. Antes del evento (2 horas antes)

### 1.1 Verificar la plataforma

```bash
docker compose ps
```

Todos los servicios deben estar en `healthy` (`postgres`, `pgbouncer`, `redis`, `api`, `web`).

```bash
curl http://localhost:8080/api/health/ready
# {"estado":"ok","baseDatos":true}
```

Si `baseDatos` es `false`, la API no puede registrar: revise `docker compose logs postgres`.

### 1.2 Cargar el padron de asistentes (idealmente el dia anterior)

1. Panel de administracion > **Importar**.
2. Descargue la **plantilla** y envie el archivo XLSX con las columnas `id`, `nombres`,
   `apellidos`, `rol`, `semestre`, `cedula` y `email`.
3. Revise la **vista previa**: el sistema informa fila por fila que es valida y que no. La
   tabla muestra las primeras 50 filas, pero el boton importa **todas** las filas validas del
   archivo (hasta 5000 por importacion).
4. Confirme la importacion.

**Verificacion:** en **Asistentes** el total debe coincidir con el listado de la universidad.
El sistema asigna a cada asistente un **codigo de registro** de 6 caracteres (por ejemplo
`K7M4D2`) que es lo que va en el QR.

> Si el archivo ya tiene los datos cargados, la importacion los **actualiza** en vez de
> duplicarlos: el total de asistentes del panel no debe cambiar.
>
> Si vas a hacer **pruebas** y necesitas empezar de cero, usa **Configuracion > Mantenimiento
> de la base de datos > Borrar todos los datos**. Pide la contrasena del administrador y la frase
> `BORRAR TODOS LOS DATOS`. Borra el padron, las asistencias, los refrigerios entregados, los
> certificados, la auditoria y la idempotencia; conserva la configuracion, las jornadas, los
> refrigerios configurados y las cuentas. Cuando la base ya tenga el padron **real**, apague la
> funcion con `LIMPIAR_BASE_HABILITADO=false` en el entorno.

### 1.3 Entregar el codigo de registro

| Via    | Como                                                        | Cuando                    |
| ------ | ----------------------------------------------------------- | ------------------------- |
| Correo | **Carnets y QR > Enviar codigo y QR por correo**            | Si hay SMTP configurado   |
| Papel  | **Carnets y QR > Descargar carta de QR** (PDF, escarapelas) | Alternativa o complemento |

El correo incluye el codigo, la imagen del QR y la indicacion de que se puede dictar, y adjunta la
**escarapela en PDF del tamano de la tarjeta** (280 x 400 pt, no una hoja A4), lista para imprimir
o mostrar en el celular. La carta en PDF de cuatro por hoja sirve para los asistentes sin correo o
para entregarla en la puerta.

### 1.4 Imprimir los carnets

**Carnets y QR > Descargar carnets** genera un PDF con 6 escarapelas por hoja: codigo QR, nombre,
rol, semestre e ID institucional. Imprima en papel grueso o plastificado.

**Carnets y QR > Descargar carta de QR** genera las escarapelas grandes: 4 por hoja, con el logo de
la Universidad, el nombre del asistente en grande, el rol, la facultad, el QR, el **ID institucional
en grande** y los datos de identificacion (cedula y correo).

> El codigo de registro de 6 caracteres **no se imprime**: ya va dentro del QR. Si el escaner
> falla, el operador puede dictarlo desde la lista del panel o buscando por nombre.

### 1.5 Configurar el evento

En **Configuracion**, confirme:

- Nombre del seminario y fecha: 27 de octubre de 2026.
- **Hora de fin: 18:00**. Es el dato que determina quien recibe certificado.
- **Tolerancia: 15 minutos** (se puede ajustar si el cierre se retrasa).
- **Permanencia minima por jornada: 3 horas**. Es el tiempo que debe estar cada asistente en
  cada jornada para ser elegible. Con 0 la regla no se aplica.
- **Exigir asistencia en ambas jornadas**: activado.
- Horarios de las jornadas: **manana de 8:00 a 12:00** y **tarde de 14:00 a 18:00**. La app del
  operador toma la jornada de estos horarios; no hay que elegirla.
- **Permitir registro fuera de la ventana**: activelo si espera filas o retrasos. Queda
  registrado en la auditoria.

En **Configuracion > Accesos del operador**:

- **Ingreso**, **Refrigerio**, **Salida** y **Souvenir**: deje encendido solo lo que corresponda a
  cada momento. Lo que se apague desaparece de la app del operador y la API lo rechaza.
- **Jornada en curso**: en *Automatica (segun el horario)*. Solo fijela si el evento se corre o
  se adelanta.
- **Minutos de margen despues del cierre**: 20 por defecto; es el tiempo extra para registrar
  las salidas de la jornada que acaba de terminar.

### 1.6 Probar con un celular

1. Entre como operador desde el celular.
2. Compruebe que arriba aparece la **jornada vigente con su horario** y que no hay selector de
   jornada.
3. Registre un ingreso de prueba y compruebe que aparece el **nombre** del asistente para
   contrastarlo con la escarapela.
4. Pruebe el escaner de QR.
5. **Elimine el registro de prueba** o use un ID de prueba que no exista en el padron.
6. Apague y vuelva a encender el interruptor **Refrigerio** en el panel y confirme que el boton
   desaparece y reaparece en el celular en menos de medio minuto.

> La camara del navegador **solo funciona en un sitio seguro (HTTPS)**. Si se accede por IP
> local, el operador debe digitar el codigo de 6 caracteres. La aplicacion lo avisa.

---

## 2. Durante el evento

### 2.1 Organizacion sugerida

| Punto de control                   | Personal | Equipo                                  |
| ---------------------------------- | -------- | --------------------------------------- |
| Entrada al recinto                 | 2        | Celulares con la app, carnets impresos  |
| Registro de asistencia (jornada 1) | 2        | Tablets o celulares, un enlace por fila |
| Refrigerio                         | 2        | Mesón con el listado de refrigerios     |
| Registro de asistencia (jornada 2) | 2        | Igual que la jornada 1                  |
| Souvenir o regalo                  | 1        | Mesa de entrega con la app del operador |
| Cierre y salidas                   | 2        | tablets                                 |

Cada operador inicia sesion con **su propia cuenta**. Las credenciales se entregan en mano.

### 2.2 Flujo del operador

1. Elige el modo habilitado: **Ingreso**, **Refrigerio**, **Salida** o **Souvenir**.
2. El participante entrega la escarapela o dicta su codigo.
3. El operador escribe o escanea. La app **verifica y muestra el nombre**: se compara con la
   escarapela y con el rostro. Si no coincide, **no se registra**.
4. Se pulsa **Registrar**.
5. La app muestra el resultado y deja el campo listo para el siguiente.

- La **jornada** y el **refrigerio** salen solos de la hora; el operador no los escoge.
- Arriba se ve cuantos registros lleva la jornada en curso, actualizado cada 20 segundos.
- Un duplicado **no es un error**: sale una alerta ambar con la hora del registro original y el
  operador que lo hizo, **aunque el primero lo haya registrado un companero**. Se continua con la
  siguiente persona.
- Un ID desconocido sale una alerta roja y ofrece la busqueda manual por nombre.
- El icono de la camara abre el escaner; el QR se lee solo.
- **No hay jornada activa** (entre jornadas o despues del margen): la app avisa y bloquea el
  registro. Si el evento se corre, el administrador fija la jornada en el panel.

### 2.3 Cierre de cada jornada

Al terminar cada jornada, registre las **salidas** en el modo Salida: son las que determinan la
elegibilidad. Un participante que se retiro sin registrar su salida **no** recibirá certificado.

### 2.4 Durante el evento

El panel de administracion muestra en vivo:

- Asistentes registrados por jornada y porcentaje de asistencia.
- Refrigerios entregados frente a pendientes.
- Ritmo de ingreso por minuto (ultima hora).
- Cuantos estan dentro y cuantos ya salieron.
- Cuantos son elegibles a certificado.

---

## 3. Al cerrar el evento

1. **Verifique que no queden salidas pendientes**: filtre por jornada y revise la lista.
2. **Revise los no elegibles** (Certificados > filtro "No elegibles"): el motivo aparece junto a
   cada nombre. Corrija con una excepcion manual si corresponde.
3. **Emita en lote** (Certificados > "Emitir en lote") y espere la barra de progreso al 100 %.
4. **Descargue el ZIP** con un PDF por asistente.
5. **Exporte los reportes**: asistencia por jornada, refrigerios entregados y pendientes,
   elegibles y no elegibles, certificados emitidos y auditoria (CSV, Excel o PDF).

---

## 4. Plan de contingencia

| Falla                                       | Como se detecta                                 | Respuesta inmediata                                                                                                                                     | Respuesta definitiva                                                                                     |
| ------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **El evento se corre o se adelanta**        | La app dice "No hay jornada activa"             | El administrador fija la jornada en **Configuracion > Accesos del operador > Jornada en curso**.                                                         | Volver a *Automatica (segun el horario)* cuando el cronograma se normalice.                              |
| **Se cae internet**                         | Indicador "Sin conexion" en la app del operador | La app guarda el registro en el dispositivo y lo sincroniza al volver la red. Los duplicados que aparezcan al sincronizar se marcan como **conflicto**. | Sincronizacion automatica cada 15 s. Antes de emitir certificados, verifique que no queden pendientes.   |
| **Se cae la base de datos**                 | `/api/health/ready` responde 503                | La API responde 503 sin caerse. El operador sigue registrando en la cola offline.                                                                       | `docker compose restart postgres`. Los datos estan en el volumen `postgres_datos`.                       |
| **Se cae la API**                           | El panel muestra error de red                   | El operador continua en modo offline.                                                                                                                   | `docker compose restart api`. El cierre es ordenado y las colas se reanudan.                             |
| **PgBouncer no responde**                   | La API reporta timeout de conexion              | La API sigue operativa con las conexiones que ya tiene abiertas.                                                                                        | `docker compose logs pgbouncer`. Con una sola replica puede apuntar `DATABASE_URL` directo a PostgreSQL. |
| **Redis no responde**                       | Log "Redis no disponible"                       | La API sigue con cache en memoria y rate limit local.                                                                                                   | `docker compose restart redis`.                                                                          |
| **No se puede enviar el correo con los QR** | El envio informa que no hay SMTP                | Use la **carta de QR en PDF**.                                                                                                                          | Configurar `SMTP_*` y reenviar a los que falten.                                                         |
| **Se emitio un certificado por error**      | Panel de certificados                           | Use **Revocar** con motivo: la verificacion publica pasa a "no valido" y queda auditado.                                                                | Reemita el certificado corregido (conserva el codigo de verificacion).                                   |
| **Se perdio el celular de un operador**     | El operador no puede iniciar sesion             | Su sesion caduca a los 15 minutos. Las operaciones pendientes siguen en su cola offline.                                                                | Desactive la cuenta en **Usuarios** y cree una nueva.                                                    |
| **Un asistente no aparece**                 | La app responde "ID no encontrado"              | Use la busqueda manual por nombre y apellido.                                                                                                           | Verifique que el ID fue importado; si falta, agreguelo en **Asistentes**.                                |

### Datos y respaldo

- El padron, las asistencias, los refrigerios y los certificados viven en el volumen
  `postgres_datos`. Un `docker compose down` **no** los borra; `docker compose down -v` si.
- Los PDF generados se guardan en el volumen `certificados` y su hash en la base de datos. Si se
  pierde el volumen, el sistema los regenera al descargarlos.
- La cola offline del navegador sobrevive a un cierre de la app, pero **no** a borrar los datos
  del navegador: verifique que no queden pendientes antes de emitir certificados.
