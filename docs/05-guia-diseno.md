# Guia de diseno

Sistema del **IV Seminario de Ingenieria de Software** - Universidad Cooperativa de Colombia.

---

## 1. Principios

1. **Institucional antes que decorativo.** La identidad es la de la universidad: azul marino,
   cian, verde lima y la tipografia Montserrat.
2. **Una sola biblioteca de iconos.** Todo el sistema usa **Lucide React**, trazo 2, tamano por
   defecto 20. No hay emojis en ninguna parte de la interfaz.
3. **El color comunica, no decora.** Verde = exito, ambar = ya registrado, rojo = error o no
   permitido. Un color nunca se usa para otra cosa.
4. **El operador es la prioridad.** Pantallas de 360 px, botones de 48 px como minimo, un solo
   campo de escritura y la confirmacion visual antes de registrar.
5. **Legibilidad por encima de la estetica.** Contraste WCAG AA verificado automaticamente.

---

## 2. Paleta

### 2.1 Colores institucionales

| Color | Valor | Uso |
| --- | --- | --- |
| Azul marino | `#132740` | Encabezado del panel, boton principal, titulos. |
| Cian | `#00ACC9` | Acento: datos, barras de progreso, anillo de foco. |
| Verde lima | `#80BA27` | Detalle decorativo: retícula del certificado, linea de acento. |
| Amarillo | `#FFCE36` | Base de la familia de aviso. |
| Gris claro | `#EFEFEF` | Fondos de superficie y campos. |
| Gris medio | `#5F5E5E` | Texto secundario. |

### 2.2 Rampas

Cada familia tiene 10 a 12 pasos, con nombres consistentes (`primario-50` ... `primario-950`).
Los tokens viven en `apps/web/src/estilos/tokens.css` y se replican en
`apps/web/tailwind.config.ts`.

| Familia | Significado | Pasos |
| --- | --- | --- |
| `primario` | Azul marino institucional | 50 a 950 |
| `acento` | Cian institucional | 50 a 950 |
| `lima` | Verde lima decorativo | 100 a 700 |
| `neutro` | Grises de la institucion | 50 a 950 |
| `exito` | Verde profundo (exito) | 100 a 900 |
| `aviso` | Amarillo institucional (duplicado) | 100 a 900 |
| `error` | Rojo (error, no permitido) | 100 to 900 |

### 2.3 Degradados

Solo tres, todos derivados de la rampa institucional:

| Token | Uso |
| --- | --- |
| `--gradient-marca` | Boton principal, encabezado del panel, banda del certificado. |
| `--gradient-marca-suave` | Fondo de la tarjeta de verificacion del operador. |
| `--gradient-acento` | Relleno de las barras de progreso y de la retícula decorativa. |

**Prohibido** el degradado morado-azul generico de las plantillas: la combinacion no pertenece
a la identidad institucional.

### 2.4 Contraste

`apps/web/test/contraste.test.ts` calcula la razon de contraste WCAG de 14 combinaciones
criticas y falla si alguna baja del minimo (4.5:1 en texto normal, 3:1 en el anillo de foco).

| Uso | Par | Razon |
| --- | --- | --- |
| Texto principal | `neutro-900` sobre `neutro-50` | 16.4:1 |
| Texto secundario | `neutro-600` sobre `neutro-50` | 6.4:1 |
| Boton principal | blanco sobre `primario-600` | 11.6:1 |
| Extremo claro del degradado | blanco sobre `marca-500` | 8.3:1 |
| Anillo de foco | `acento-600` sobre `neutro-50` | 4.1:1 |
| Exito | `exito-700` sobre `exito-100` | 6.9:1 |
| Aviso | `aviso-700` sobre `aviso-100` | 6.2:1 |
| Error | `error-700` sobre `error-100` | 6.5:1 |

---

## 3. Tipografia

**Montserrat** (400, 500, 600, 700), servida localmente con `@fontsource/montserrat`. Sin CDN
externo: el sistema debe funcionar en una sala con internet inestable.

| Token | Tamano | Interlineado | Uso |
| --- | --- | --- | --- |
| `xs` | 12 px | 1.4 | Texto auxiliar, pie de pagina |
| `sm` | 13 px | 1.4 | Etiquetas, ayuda de campos |
| `base` | 15 px | 1.5 | Texto de lectura |
| `md` | 16 px | 1.5 | Texto de formulario |
| `lg` | 18 px | 1.35 | Titulo de tarjeta |
| `xl` | 20 px | 1.3 | Titulo de seccion |
| `2xl` | 24 px | 1.25 | Numero destacado |
| `3xl` | 30 px | 1.2 | Cifra del panel |

---

## 4. Iconografia

Unica biblioteca: **Lucide React**. Trazo 2 (`strokeWidth={2}`), esquinas redondeadas.

| Contexto | Icono |
| --- | --- |
| Ingreso | `UserCheck` |
| Refrigerio | `Package` |
| Salida | `ClipboardCheck` |
| Escaner | `ScanLine` |
| Verificar | `Search` |
| Resultado exitoso | `CheckCircle2` |
| Resultado duplicado | `AlertTriangle` |
| Resultado con error | `XCircle` |
| Fuera de ventana | `Info` |
| Sin conexion | `WifiOff` |
| Panel | `LayoutDashboard` |
| Asistentes | `Users` |
| Importar | `Upload` |
| Carnets y QR | `QrCode` |
| Certificados | `Award` |
| Reportes | `FileSpreadsheet` |
| Configuracion | `Settings` |
| Usuarios | `UserCheck` |
| Cerrar sesion | `LogOut` |

Reglas: los iconos decorativos llevan `aria-hidden="true"`; los que tienen significado propio
llevan `aria-label`. Ningun icono se usa como texto.

---

## 5. Componentes

### 5.1 Botones

| Variante | Aspecto | Uso |
| --- | --- | --- |
| `boton-primario` | Degradado de marca, texto blanco, sombra de marca | Accion principal de la pantalla |
| `boton-secundario` | Blanco, sombra difusa, borde al enfocar | Accion secundaria |
| `boton-peligro` | Rojo solido | Revocar, eliminar |
| `boton-compacto` | 40 px de alto | Acciones dentro de una tabla o tarjeta |

Altura minima **48 px** en los botones de la app del operador (verificado por la prueba E2E).

### 5.2 Campos

- Relleno `neutro-100`, radio 16 px, sin borde visible en reposo.
- Al enfocar: borde `acento-300` y halo `acento-100`.
- Etiqueta siempre visible encima del campo, asociada por `htmlFor` e `id`.
- El campo del ID usa `font-mono` y `tracking-wider`: los codigos se leen mejor asi.

### 5.3 Superficies

Tarjetas blancas, radio 24 px, sombra difusa de dos niveles (sin bordes oscuros). El fondo de la
aplicacion es un gradido hielo con dos luces radiales de la rampa institucional: da profundidad
sin distraer.

### 5.4 Bloque de resultado del registro

Es el elemento mas importante de la app del operador:

| Situacion | Fondo | Icono | Contenido |
| --- | --- | --- | --- |
| Exito | Tinte verde suave | `CheckCircle2` | Nombre, rol, ID, codigo, hora |
| Duplicado | Tinte ambar suave | `AlertTriangle` | "Asistencia ya registrada", hora del original y responsable |
| No encontrado | Tinte rojo suave | `XCircle` | "ID no encontrado" y busqueda manual |
| Fuera de ventana | Tinte ambar suave | `Info` | Horario de la ventana |

En todos los casos el texto principal esta en 18 px y el nombre del asistente en 18 px en
serif. El bloque tiene `role="status"` y `aria-live="assertive"`: el lector de pantalla anuncia
el resultado.

### 5.5 Tarjeta de verificacion previa

Antes de registrar, la aplicacion muestra el nombre del asistente, su rol, el ID, el codigo de
registro y el estado de cada jornada. Es la pieza que permite contrastar la escarapela con la
persona. Si la jornada activa ya tiene un ingreso, la tarjeta lo dice en ambar.

### 5.6 Tablas

- En escritorio: tabla con cabecera fija y filas alternas.
- En celular: la tabla se oculta y aparece una **tarjeta por fila** con la misma informacion
  reorganizada. Nunca hay scroll horizontal obligatorio.

---

## 6. Accesibilidad

| Requisito | Como se cumple |
| --- | --- |
| Contraste | Verificado automaticamente (WCAG AA). |
| Foco visible | Anillo de 2 px en `acento-600` con separacion de 2 px. |
| Etiquetas | Cada campo tiene etiqueta visible; las tablas tienen `scope="col"`. |
| Lectores de pantalla | `aria-live` en el resultado y en la verificacion; `aria-label` en los botones de icono. |
| Alcanzabilidad por teclado | Todos los controles son elementos nativos; el modal cierra con `Escape` y atrapa el foco visual. |
| Objetivos tactiles | 48 px minimo en la app del operador; 40 px en acciones secundarias. |
| Sin desbordes | Pruebas E2E que verifican `scrollWidth <= clientWidth` a 360 px. |

---

## 7. Reglas para quien mantenga el sistema

1. **No introducir emojis.** Toda señal visual es un icono de Lucide.
2. **No usar colores fuera de los tokens.** Si falta un tono, se agrega a la rampa, no se
   inventa un hexadecimal suelto.
3. **No usar degradados que no estén en `tokens.css`.**
4. **Verificar el contraste** al tocar una rampa: `npm -w @seminario/web run test`.
5. **Probar en 360 px** antes de dar por terminado un componente nuevo.
