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
   `apellidos`, `rol`, `semestre` y `email`.
3. Revise la **vista previa**: el sistema informa fila por fila que es valida y que no.
4. Confirme la importacion.

**Verificacion:** en **Asistentes** el total debe coincidir con el listado de la universidad.
El sistema asigna a cada asistente un **codigo de registro** de 6 caracteres (por ejemplo
`K7M4D2`) que es lo que va en el QR.

### 1.3 Entregar el codigo de registro

| Via | Como | Cuando |
| --- | --- | --- |
| Correo | **Carnets y QR > Enviar codigo y QR por correo** | Si hay SMTP configurado |
| Papel | **Carnets y QR > Descargar carta de QR** (PDF, una tarjeta por persona) | Alternativa o complemento |

El correo incluye el codigo, la imagen del QR y la indicacion de que se puede dictar.
La carta en PDF sirve para los asistentes sin correo o para entregarla en la puerta.

### 1.4 Imprimir los carnets

**Carnets y QR > Descargar carnets** genera un PDF con 6 escarapelas por hoja: codigo QR, nombre,
rol, semestre, ID institucional y codigo de registro. Imprima en papel grueso o plastificado.

### 1.5 Configurar el evento

En **Configuracion**, confirme:

- Nombre del seminario y fecha: 27 de octubre de 2026.
- **Hora de fin: 18:00**. Es el dato que determina quien recibe certificado.
- **Tolerancia: 15 minutos** (se puede ajustar si el cierre se retrasa).
- **Exigir asistencia en ambas jornadas**: activado.
- Ventanas de check-in de las dos jornadas: 07:30 a 09:00 y 12:30 a 14:00.
- **Permitir registro fuera de la ventana**: activelo si espera filas o retrasos. Queda
  registrado en la auditoria.

### 1.6 Probar con un celular

1. Entre como operador desde el celular.
2. Registre un ingreso de prueba y compruebe que aparece el **nombre** del asistente para
   contrastarlo con la escarapela.
3. Pruebe el escaner de QR.
4. **Elimine el registro de prueba** o use un ID de prueba que no exista en el padron.

> La camara del navegador **solo funciona en un sitio seguro (HTTPS)**. Si se accede por IP
> local, el operador debe digitar el codigo de 6 caracteres. La aplicacion lo avisa.

---

## 2. Durante el evento

### 2.1 Organizacion sugerida

| Punto de control | Personal | Equipo |
| --- | --- | --- |
| Entrada al recinto | 2 | Celulares con la app, carnets impresos |
| Registro de asistencia (jornada 1) | 2 | Tablets o celulares, un enlace por fila |
| Refrigerio | 2 | Mesón con el listado de refrigerios |
| Registro de asistencia (jornada 2) | 2 | Igual que la jornada 1 |
| Cierre y salidas | 2 | tablets |

Cada operador inicia sesion con **su propia cuenta**. Las credenciales se entregan en mano.

### 2.2 Flujo del operador

1. Elige el modo: **Ingreso**, **Refrigerio** o **Salida**.
2. El participante entrega la escarapela o dicta su codigo.
3. El operador escribe o escanea. La app **verifica y muestra el nombre**: se compara con la
   escarapela y con el rostro. Si no coincide, **no se registra**.
4. Se pulsa **Registrar**.
5. La app muestra el resultado y deja el campo listo para el siguiente.

- Un duplicado **no es un error**: sale una alerta ambar con la hora del registro original y el
  operador que lo hizo. Se continua con la siguiente persona.
- Un ID desconocido sale una alerta roja y ofrece la busqueda manual por nombre.
- El icono de la camara abre el escaner; el QR se lee solo.

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

| Falla | Como se detecta | Respuesta inmediata | Respuesta definitiva |
| --- | --- | --- | --- |
| **Se cae internet** | Indicador "Sin conexion" en la app del operador | La app guarda el registro en el dispositivo y lo sincroniza al volver la red. Los duplicados que aparezcan al sincronizar se marcan como **conflicto**. | Sincronizacion automatica cada 15 s. Antes de emitir certificados, verifique que no queden pendientes. |
| **Se cae la base de datos** | `/api/health/ready` responde 503 | La API responde 503 sin caerse. El operador sigue registrando en la cola offline. | `docker compose restart postgres`. Los datos estan en el volumen `postgres_datos`. |
| **Se cae la API** | El panel muestra error de red | El operador continua en modo offline. | `docker compose restart api`. El cierre es ordenado y las colas se reanudan. |
| **PgBouncer no responde** | La API reporta timeout de conexion | La API sigue operativa con las conexiones que ya tiene abiertas. | `docker compose logs pgbouncer`. Con una sola replica puede apuntar `DATABASE_URL` directo a PostgreSQL. |
| **Redis no responde** | Log "Redis no disponible" | La API sigue con cache en memoria y rate limit local. | `docker compose restart redis`. |
| **No se puede enviar el correo con los QR** | El envio informa que no hay SMTP | Use la **carta de QR en PDF**. | Configurar `SMTP_*` y reenviar a los que falten. |
| **Se emitio un certificado por error** | Panel de certificados | Use **Revocar** con motivo: la verificacion publica pasa a "no valido" y queda auditado. | Reemita el certificado corregido (conserva el codigo de verificacion). |
| **Se perdio el celular de un operador** | El operador no puede iniciar sesion | Su sesion caduca a los 15 minutos. Las operaciones pendientes siguen en su cola offline. | Desactive la cuenta en **Usuarios** y cree una nueva. |
| **Un asistente no aparece** | La app responde "ID no encontrado" | Use la busqueda manual por nombre y apellido. | Verifique que el ID fue importado; si falta, agreguelo en **Asistentes**. |

### Datos y respaldo

- El padron, las asistencias, los refrigerios y los certificados viven en el volumen
  `postgres_datos`. Un `docker compose down` **no** los borra; `docker compose down -v` si.
- Los PDF generados se guardan en el volumen `certificados` y su hash en la base de datos. Si se
  pierde el volumen, el sistema los regenera al descargarlos.
- La cola offline del navegador sobrevive a un cierre de la app, pero **no** a borrar los datos
  del navegador: verifique que no queden pendientes antes de emitir certificados.
