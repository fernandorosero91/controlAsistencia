import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib';
import QRCode from 'qrcode';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AsistenteResumen } from '@seminario/shared';

const AZUL_PROFUNDO = rgb(0.047, 0.216, 0.255);
const AZUL_PETROLEO = rgb(0.082, 0.345, 0.4);
const GRIS_TEXTO = rgb(0.227, 0.259, 0.286);
const GRIS_LINEA = rgb(0.788, 0.824, 0.847);
const NEGRO = rgb(0.078, 0.102, 0.122);

// Rampa institucional de la aplicacion (ver apps/web/src/estilos/tokens.css).
const AZUL_MARINO = rgb(0.075, 0.153, 0.251); // #132740
const CIAN = rgb(0, 0.674, 0.788); // #00ACC9
const CIAN_CLARO = rgb(0.929, 0.988, 0.996); // #ECFCFE
const LIMA = rgb(0.502, 0.729, 0.153); // #80BA27
const GRIS_SUAVE = rgb(0.937, 0.937, 0.937); // #EFEFEF
const GRIS_MEDIO = rgb(0.373, 0.369, 0.369); // #5F5E5E

const MESES_ES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/** Convierte una fecha ISO (AAAA-MM-DD) en texto largo en espanol. */
function fechaLarga(iso: string): string {
  const [anio, mes, dia] = iso.split('-');
  const nombre = MESES_ES[Number(mes) - 1] ?? mes;
  return `${dia} de ${nombre} de ${anio}`;
}

/**
 * Reduce el tamano de la fuente hasta que el texto quepa en el ancho dado.
 * En una escarapela el nombre se ajusta, nunca se recorta: un nombre a medio
 * leer es peor que un nombre un punto mas pequeno.
 */
function ajustarTamano(fuente: PDFFont, texto: string, tamano: number, anchoMax: number): number {
  const ancho = fuente.widthOfTextAtSize(texto, tamano);
  if (ancho <= anchoMax) return tamano;
  return Math.max(9, (tamano * anchoMax) / ancho);
}

/** Centra un texto horizontalmente respecto a un punto. */
function textoCentrado(
  pagina: PDFPage,
  texto: string,
  centro: number,
  y: number,
  fuente: PDFFont,
  tamano: number,
  color: ReturnType<typeof rgb>,
): void {
  const ancho = fuente.widthOfTextAtSize(texto, tamano);
  pagina.drawText(texto, {
    x: centro - ancho / 2,
    y,
    size: tamano,
    font: fuente,
    color,
  });
}

/** Ubica el logotipo institucional que se imprime en el certificado. */
function rutaLogo(): string | null {
  const candidatos = [
    process.env.LOGO_INSTITUCIONAL,
    path.resolve(process.cwd(), 'assets', 'logo-ucc-horizontal.png'),
    path.resolve(process.cwd(), 'apps', 'api', 'assets', 'logo-ucc-horizontal.png'),
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../assets/logo-ucc-horizontal.png',
    ),
  ].filter((valor): valor is string => typeof valor === 'string' && valor.length > 0);

  for (const candidato of candidatos) {
    if (existsSync(candidato)) return candidato;
  }
  return null;
}

/** Ubica la version en blanco del logotipo, para imprimirla sobre fondo oscuro. */
function rutaLogoBlanco(): string | null {
  const candidatos = [
    process.env.LOGO_INSTITUCIONAL_BLANCO,
    path.resolve(process.cwd(), 'assets', 'logo-ucc-blanco-horizontal.png'),
    path.resolve(process.cwd(), 'apps', 'api', 'assets', 'logo-ucc-blanco-horizontal.png'),
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../assets/logo-ucc-blanco-horizontal.png',
    ),
  ].filter((valor): valor is string => typeof valor === 'string' && valor.length > 0);

  for (const candidato of candidatos) {
    if (existsSync(candidato)) return candidato;
  }
  return null;
}

/**
 * Carga el logotipo indicado para incrustarlo. Si el archivo no existe o no se
 * puede leer, el documento se genera igual, sin logo: es preferible imprimir
 * una escarapela sin logo a no imprimirla.
 */
async function leerLogo(documento: PDFDocument, ruta: string | null): Promise<PDFImage | null> {
  if (!ruta) return null;
  try {
    return await documento.embedPng(await readFile(ruta));
  } catch {
    return null;
  }
}

export interface DatosCarnet {
  asistente: AsistenteResumen;
  /** Codigo de registro corto: es lo que codifica el QR. */
  codigoRegistro: string;
  email: string | null;
}

export interface DatosCartaQr {
  asistente: AsistenteResumen;
  codigoRegistro: string;
  idInstitucional: string;
  cedulaCiudadania: string | null;
  email: string | null;
  nombreSeminario: string;
  facultad: string | null;
  fecha: string;
  lugar: string | null;
}

export interface DatosCertificado {
  nombre: string;
  id: string;
  rol: string;
  nombreSeminario: string;
  fecha: string;
  intensidadHoraria: number;
  lugar?: string | null;
  facultad?: string | null;
  contacto?: string | null;
  textoEncabezado?: string | null;
  textoCierre?: string | null;
  firmaNombre?: string | null;
  firmaCargo?: string | null;
  codigoVerificacion: string;
  urlVerificacion: string;
}

function envolverTexto(texto: string, fuente: PDFFont, tamano: number, anchoMax: number): string[] {
  const palabras = texto.split(/\s+/).filter((palabra) => palabra.length > 0);
  const lineas: string[] = [];
  let lineaActual = '';

  for (const palabra of palabras) {
    const candidata = lineaActual.length === 0 ? palabra : `${lineaActual} ${palabra}`;
    if (fuente.widthOfTextAtSize(candidata, tamano) <= anchoMax) {
      lineaActual = candidata;
    } else {
      if (lineaActual.length > 0) lineas.push(lineaActual);
      lineaActual = palabra;
    }
  }
  if (lineaActual.length > 0) lineas.push(lineaActual);
  return lineas;
}

async function imagenQr(contenido: string): Promise<Buffer> {
  return QRCode.toBuffer(contenido, {
    type: 'png',
    errorCorrectionLevel: 'M',
    // Zona de silencio de 4 modulos (la que pide la norma): sin ella la camara
    // tarda mucho mas en encontrar el codigo.
    margin: 4,
    width: 512,
  });
}

/**
 * Genera los carnetes (escarapelas) con codigo QR en un unico PDF.
 * El QR codifica el ID institucional, que es la clave de busqueda del asistente.
 */
export async function generarCarnetsPDF(
  participantes: DatosCarnet[],
  titulo: string,
): Promise<Uint8Array> {
  const documento = await PDFDocument.create();
  const fuenteNormal = await documento.embedFont(StandardFonts.Helvetica);
  const fuenteNegrita = await documento.embedFont(StandardFonts.HelveticaBold);

  const anchoPagina = 595.28;
  const altoPagina = 841.89;
  const margen = 24;
  const anchoTarjeta = (anchoPagina - margen * 2 - 12) / 2;
  const altoTarjeta = (altoPagina - margen * 2 - 24) / 3;

  let pagina: PDFPage | null = null;
  let indice = 0;

  for (const participante of participantes) {
    if (indice % 6 === 0) {
      pagina = documento.addPage([anchoPagina, altoPagina]);
    }
    const actual = pagina!;
    const columna = indice % 6 < 3 ? 0 : 1;
    const fila = Math.floor((indice % 6) / 2);
    const x = margen + columna * (anchoTarjeta + 12);
    const y = altoPagina - margen - (fila + 1) * altoTarjeta - fila * 12;

    actual.drawRectangle({
      x,
      y,
      width: anchoTarjeta,
      height: altoTarjeta,
      borderColor: GRIS_LINEA,
      borderWidth: 1,
      color: rgb(0.996, 0.998, 0.999),
    });
    actual.drawRectangle({
      x,
      y: y + altoTarjeta - 26,
      width: anchoTarjeta,
      height: 26,
      color: AZUL_PETROLEO,
    });
    actual.drawText(titulo, {
      x: x + 10,
      y: y + altoTarjeta - 18,
      size: 11,
      font: fuenteNegrita,
      color: rgb(1, 1, 1),
      maxWidth: anchoTarjeta - 20,
    });

    const qr = await documento.embedPng(await imagenQr(participante.codigoRegistro));
    const tamanoQr = 100;
    actual.drawImage(qr, {
      x: x + 14,
      y: y + 18,
      width: tamanoQr,
      height: tamanoQr,
    });

    const textoX = x + tamanoQr + 26;
    const anchoTexto = anchoTarjeta - tamanoQr - 40;
    let cursorY = y + altoTarjeta - 46;

    const nombreCompleto = `${participante.asistente.nombres} ${participante.asistente.apellidos}`;
    const lineasNombre = envolverTexto(nombreCompleto, fuenteNegrita, 12, anchoTexto);
    for (const linea of lineasNombre.slice(0, 3)) {
      actual.drawText(linea, {
        x: textoX,
        y: cursorY,
        size: 12,
        font: fuenteNegrita,
        color: NEGRO,
      });
      cursorY -= 15;
    }

    const rol = participante.asistente.rol === 'estudiante' ? 'Estudiante' : 'Docente';
    const semestre =
      participante.asistente.semestre !== null
        ? `Semestre ${participante.asistente.semestre}`
        : 'Docente';
    actual.drawText(rol, {
      x: textoX,
      y: cursorY,
      size: 10,
      font: fuenteNormal,
      color: GRIS_TEXTO,
    });
    cursorY -= 13;
    actual.drawText(semestre, {
      x: textoX,
      y: cursorY,
      size: 10,
      font: fuenteNormal,
      color: GRIS_TEXTO,
    });
    cursorY -= 16;
    // Solo el ID: el codigo de registro ya va dentro del QR. El ID se imprime
    // grande porque es lo que el operador compara con la persona.
    actual.drawText(`ID: ${participante.asistente.id}`, {
      x: textoX,
      y: cursorY,
      size: 16,
      font: fuenteNegrita,
      color: AZUL_PROFUNDO,
    });

    indice += 1;
  }

  if (participantes.length === 0) {
    const paginaVacia = documento.addPage([anchoPagina, altoPagina]);
    paginaVacia.drawText('No hay asistentes para generar.', {
      x: 60,
      y: altoPagina / 2,
      size: 14,
      font: fuenteNormal,
      color: GRIS_TEXTO,
    });
  }

  return documento.save();
}

/**
 * Carta de QR con forma de escarapela.
 *
 * Cuatro tarjetas verticales por hoja A4 (3,9 x 5,4 pulgadas), con el
 * criterio de las escarapelas de eventos: el nombre es lo mas grande y
 * legible, el logo institucional arriba, el QR con su zona de silencio y el
 * codigo de registro en grande por si el escaner falla, y los datos personales
 * en el tamano mas pequeno.
 *
 * Se imprime en papel y se entrega a mano cuando no hay servidor de correo
 * configurado o cuando el asistente no tiene correo registrado.
 */
export async function generarCartaQrPDF(datos: DatosCartaQr[]): Promise<Uint8Array> {
  const documento = await PDFDocument.create();
  const fuenteNormal = await documento.embedFont(StandardFonts.Helvetica);
  const fuenteNegrita = await documento.embedFont(StandardFonts.HelveticaBold);

  const anchoPagina = 595.28;
  const altoPagina = 841.89;
  const anchoEsc = 280;
  const altoEsc = 400;
  const margenLateral = (anchoPagina - anchoEsc * 2) / 2;
  const margenSuperior = 20;
  const separacion = 14;
  const columnas = 2;
  const filas = 2;

  const logoBlanco = await leerLogo(documento, rutaLogoBlanco());

  let pagina: PDFPage | null = null;
  let indice = 0;

  for (const item of datos) {
    const posicion = indice % (columnas * filas);
    if (posicion === 0) {
      pagina = documento.addPage([anchoPagina, altoPagina]);
    }
    const actual = pagina!;
    const columna = posicion % columnas;
    const fila = Math.floor(posicion / columnas);
    const x0 = margenLateral + columna * (anchoEsc + separacion);
    const y0 = altoPagina - margenSuperior - (fila + 1) * altoEsc - fila * separacion;

    // ---------------------------------------------------------- fondo y borde
    actual.drawRectangle({
      x: x0,
      y: y0,
      width: anchoEsc,
      height: altoEsc,
      color: rgb(1, 1, 1),
      borderColor: GRIS_LINEA,
      borderWidth: 1,
    });

    const centro = x0 + anchoEsc / 2;
    const yTop = y0 + altoEsc;

    // ------------------------------------------------------ banda institucional
    // El logo va centrado y el nombre del evento debajo: es la composicion
    // tipica de una escarapela y evita que el texto se monte sobre el logotipo.
    const altoBanda = 84;
    actual.drawRectangle({
      x: x0,
      y: yTop - altoBanda,
      width: anchoEsc,
      height: altoBanda,
      color: AZUL_MARINO,
    });

    if (logoBlanco) {
      const anchoLogo = 108;
      const altoLogo = (logoBlanco.height / logoBlanco.width) * anchoLogo;
      actual.drawImage(logoBlanco, {
        x: centro - anchoLogo / 2,
        y: yTop - 8 - altoLogo,
        width: anchoLogo,
        height: altoLogo,
      });
    }

    const nombreEvento = item.nombreSeminario;
    const anchoDisponible = anchoEsc - 36;
    const tamanoEvento = ajustarTamano(fuenteNegrita, nombreEvento, 10.5, anchoDisponible);
    textoCentrado(
      actual,
      nombreEvento,
      centro,
      yTop - 54,
      fuenteNegrita,
      tamanoEvento,
      rgb(1, 1, 1),
    );

    const pieEvento = [item.fecha ? fechaLarga(item.fecha) : null, item.lugar]
      .filter((valor): valor is string => Boolean(valor))
      .join('  ·  ');
    if (pieEvento.length > 0) {
      const tamanoPie = ajustarTamano(fuenteNormal, pieEvento, 7.5, anchoDisponible);
      textoCentrado(actual, pieEvento, centro, yTop - 68, fuenteNormal, tamanoPie, CIAN);
    }

    // Filas de color: cian con un tramo en verde lima.
    actual.drawRectangle({
      x: x0,
      y: yTop - altoBanda - 3,
      width: anchoEsc,
      height: 3,
      color: CIAN,
    });
    actual.drawRectangle({
      x: x0,
      y: yTop - altoBanda - 3,
      width: anchoEsc * 0.34,
      height: 3,
      color: LIMA,
    });

    let cursor = yTop - altoBanda - 3 - 14;

    // ------------------------------------------------------------ rol y nombre
    // Solo el rol: el semestre no se imprime en la escarapela.
    const etiquetaRol = item.asistente.rol === 'docente' ? 'DOCENTE' : 'ESTUDIANTE';
    const anchoEtiqueta = fuenteNegrita.widthOfTextAtSize(etiquetaRol, 9) + 24;
    actual.drawRectangle({
      x: centro - anchoEtiqueta / 2,
      y: cursor - 19,
      width: anchoEtiqueta,
      height: 19,
      color: CIAN_CLARO,
      borderColor: CIAN,
      borderWidth: 0.75,
    });
    textoCentrado(actual, etiquetaRol, centro, cursor - 13, fuenteNegrita, 9, AZUL_MARINO);
    cursor -= 19 + 26;

    const anchoTexto = anchoEsc - 40;
    const tamanoNombres = ajustarTamano(fuenteNegrita, item.asistente.nombres, 25, anchoTexto);
    textoCentrado(
      actual,
      item.asistente.nombres,
      centro,
      cursor,
      fuenteNegrita,
      tamanoNombres,
      AZUL_MARINO,
    );
    cursor -= 23;

    const tamanoApellidos = ajustarTamano(fuenteNegrita, item.asistente.apellidos, 19, anchoTexto);
    textoCentrado(
      actual,
      item.asistente.apellidos,
      centro,
      cursor,
      fuenteNegrita,
      tamanoApellidos,
      AZUL_MARINO,
    );
    cursor -= 18;

    if (item.facultad) {
      const tamanoFacultad = ajustarTamano(fuenteNormal, item.facultad, 9.5, anchoTexto);
      textoCentrado(
        actual,
        item.facultad,
        centro,
        cursor,
        fuenteNormal,
        tamanoFacultad,
        GRIS_MEDIO,
      );
      cursor -= 14;
    }

    // ------------------------------------------------------- panel con el QR
    const altoPanel = 98;
    const yPanel = cursor - altoPanel;
    actual.drawRectangle({
      x: x0 + 18,
      y: yPanel,
      width: anchoEsc - 36,
      height: altoPanel,
      color: GRIS_SUAVE,
    });

    const tamanoQr = 68;
    const xQr = centro - tamanoQr / 2;
    const yQr = yPanel + altoPanel - 6 - tamanoQr;
    // El marco se dibuja primero: si se dibuja despues, su fondo blanco tapa
    // el codigo.
    actual.drawRectangle({
      x: xQr - 4,
      y: yQr - 4,
      width: tamanoQr + 8,
      height: tamanoQr + 8,
      color: rgb(1, 1, 1),
      borderColor: GRIS_LINEA,
      borderWidth: 0.75,
    });
    const qr = await documento.embedPng(await imagenQr(item.codigoRegistro));
    actual.drawImage(qr, { x: xQr, y: yQr, width: tamanoQr, height: tamanoQr });
    textoCentrado(
      actual,
      'ESCANEE PARA REGISTRAR',
      centro,
      yPanel + 10,
      fuenteNegrita,
      7.5,
      GRIS_MEDIO,
    );
    cursor = yPanel - 10;

    // ------------------------------------------------------------------- ID
    // El codigo de registro ya viaja dentro del QR: lo que debe leerse de un
    // vistazo es el ID institucional, y por eso va grande.
    textoCentrado(actual, 'ID INSTITUCIONAL', centro, cursor, fuenteNegrita, 8, GRIS_MEDIO);
    cursor -= 21;

    const tamanoId = ajustarTamano(fuenteNegrita, item.idInstitucional, 24, anchoTexto);
    textoCentrado(
      actual,
      item.idInstitucional,
      centro,
      cursor,
      fuenteNegrita,
      tamanoId,
      AZUL_MARINO,
    );
    cursor -= 18;

    // ------------------------------------------------------------- datos
    // La cedula va en su propia linea: es un dato de identificacion y debe
    // leerse de un vistazo, igual que el nombre.
    if (item.cedulaCiudadania) {
      const cedula = `C.C. ${item.cedulaCiudadania}`;
      const tamanoCedula = ajustarTamano(fuenteNegrita, cedula, 11, anchoTexto);
      textoCentrado(actual, cedula, centro, cursor, fuenteNegrita, tamanoCedula, AZUL_MARINO);
      cursor -= 13;
    }

    if (item.email) {
      const tamanoCorreo = ajustarTamano(fuenteNormal, item.email, 8.5, anchoTexto);
      textoCentrado(actual, item.email, centro, cursor, fuenteNormal, tamanoCorreo, GRIS_MEDIO);
    }

    // ------------------------------------------------------------- pie azul
    actual.drawRectangle({
      x: x0,
      y: y0,
      width: anchoEsc,
      height: 24,
      color: AZUL_MARINO,
    });
    textoCentrado(
      actual,
      'Universidad Cooperativa de Colombia',
      centro,
      y0 + 8,
      fuenteNegrita,
      8,
      rgb(1, 1, 1),
    );

    indice += 1;
  }

  if (datos.length === 0) {
    const vacia = documento.addPage([anchoPagina, altoPagina]);
    vacia.drawText('No hay asistentes para generar.', {
      x: 60,
      y: altoPagina / 2,
      size: 14,
      font: fuenteNormal,
      color: GRIS_TEXTO,
    });
  }

  return documento.save();
}

/** Genera el certificado de un asistente en formato horizontal. */
export async function generarCertificadoPDF(datos: DatosCertificado): Promise<Uint8Array> {
  const documento = await PDFDocument.create();
  const pagina = documento.addPage([841.89, 595.28]);
  const fuenteTitulo = await documento.embedFont(StandardFonts.TimesRomanBold);
  const fuenteCuerpo = await documento.embedFont(StandardFonts.Helvetica);
  const fuenteCuerpoNegrita = await documento.embedFont(StandardFonts.HelveticaBold);

  const ancho = 841.89;
  const alto = 595.28;
  const margen = 48;

  pagina.drawRectangle({
    x: 0,
    y: 0,
    width: ancho,
    height: alto,
    color: rgb(0.996, 0.998, 0.999),
  });
  pagina.drawRectangle({
    x: 24,
    y: 24,
    width: ancho - 48,
    height: alto - 48,
    borderColor: AZUL_PETROLEO,
    borderWidth: 2,
  });
  pagina.drawRectangle({
    x: 32,
    y: 32,
    width: ancho - 64,
    height: alto - 64,
    borderColor: GRIS_LINEA,
    borderWidth: 0.75,
  });

  let cursorY = alto - 92;
  const ruta = rutaLogo();
  if (ruta) {
    try {
      const logo = await documento.embedPng(await readFile(ruta));
      const anchoLogo = 190;
      const altoLogo = (logo.height / logo.width) * anchoLogo;
      pagina.drawImage(logo, {
        x: ancho - margen - anchoLogo,
        y: alto - margen - altoLogo,
        width: anchoLogo,
        height: altoLogo,
      });
    } catch {
      // Si el logotipo no esta disponible, el certificado se genera sin el.
    }
  }
  pagina.drawText(datos.nombreSeminario, {
    x: margen,
    y: cursorY,
    size: 22,
    font: fuenteTitulo,
    color: AZUL_PROFUNDO,
    maxWidth: ancho - margen * 2 - 160,
  });
  cursorY -= 22;

  if (datos.textoEncabezado) {
    const lineas = envolverTexto(datos.textoEncabezado, fuenteCuerpo, 11, ancho - margen * 2 - 160);
    for (const linea of lineas.slice(0, 3)) {
      pagina.drawText(linea, {
        x: margen,
        y: cursorY,
        size: 11,
        font: fuenteCuerpo,
        color: GRIS_TEXTO,
      });
      cursorY -= 15;
    }
  }

  cursorY -= 30;
  pagina.drawText('CERTIFICADO DE ASISTENCIA', {
    x: margen,
    y: cursorY,
    size: 16,
    font: fuenteCuerpoNegrita,
    color: AZUL_PETROLEO,
  });
  cursorY -= 42;

  const cuerpo =
    `La presente certifica que ${datos.nombre}, identificado(a) con el ID institucional ${datos.id}, ` +
    `participo como ${datos.rol} en el seminario "${datos.nombreSeminario}", ` +
    `realizado el ${datos.fecha}, con una intensidad horaria de ${datos.intensidadHoraria} horas.`;

  for (const linea of envolverTexto(cuerpo, fuenteCuerpo, 12, ancho - margen * 2 - 170)) {
    pagina.drawText(linea, { x: margen, y: cursorY, size: 12, font: fuenteCuerpo, color: NEGRO });
    cursorY -= 17;
  }

  if (datos.lugar) {
    cursorY -= 8;
    pagina.drawText(`Lugar: ${datos.lugar}`, {
      x: margen,
      y: cursorY,
      size: 11,
      font: fuenteCuerpo,
      color: GRIS_TEXTO,
    });
  }

  if (datos.textoCierre) {
    cursorY -= 12;
    for (const linea of envolverTexto(
      datos.textoCierre,
      fuenteCuerpo,
      11,
      ancho - margen * 2 - 170,
    )) {
      pagina.drawText(linea, {
        x: margen,
        y: cursorY,
        size: 11,
        font: fuenteCuerpo,
        color: GRIS_TEXTO,
      });
      cursorY -= 15;
    }
  }

  const qr = await documento.embedPng(await imagenQr(datos.urlVerificacion));
  pagina.drawImage(qr, {
    x: ancho - margen - 120,
    y: alto - margen - 120,
    width: 120,
    height: 120,
  });
  pagina.drawText('Codigo de verificacion', {
    x: ancho - margen - 120,
    y: alto - margen - 136,
    size: 9,
    font: fuenteCuerpo,
    color: GRIS_TEXTO,
  });
  pagina.drawText(datos.codigoVerificacion, {
    x: ancho - margen - 120,
    y: alto - margen - 152,
    size: 12,
    font: fuenteCuerpoNegrita,
    color: AZUL_PETROLEO,
  });

  const firmaX = margen;
  const firmaY = 96;
  pagina.drawLine({
    start: { x: firmaX, y: firmaY + 22 },
    end: { x: firmaX + 200, y: firmaY + 22 },
    thickness: 1,
    color: GRIS_LINEA,
  });
  pagina.drawText(datos.firmaNombre ?? 'Coordinacion del seminario', {
    x: firmaX,
    y: firmaY + 8,
    size: 11,
    font: fuenteCuerpoNegrita,
    color: NEGRO,
  });
  pagina.drawText(datos.firmaCargo ?? '', {
    x: firmaX,
    y: firmaY - 6,
    size: 10,
    font: fuenteCuerpo,
    color: GRIS_TEXTO,
  });

  pagina.drawText(`Emitido el ${datos.fecha}`, {
    x: ancho - margen - 200,
    y: 70,
    size: 10,
    font: fuenteCuerpo,
    color: GRIS_TEXTO,
  });

  return documento.save();
}
