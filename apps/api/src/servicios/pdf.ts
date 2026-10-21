import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
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
  email: string | null;
  nombreSeminario: string;
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
    actual.drawText(`ID: ${participante.asistente.id}`, {
      x: textoX,
      y: cursorY,
      size: 11,
      font: fuenteNegrita,
      color: AZUL_PETROLEO,
    });
    cursorY -= 14;
    actual.drawText(`Codigo: ${participante.codigoRegistro}`, {
      x: textoX,
      y: cursorY,
      size: 13,
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
 * Carta de QR: una tarjeta por asistente con el codigo, el QR, el nombre, el ID
 * institucional y el correo. Sirve para entregar el codigo en papel cuando no
 * hay servidor de correo configurado.
 */
export async function generarCartaQrPDF(datos: DatosCartaQr[]): Promise<Uint8Array> {
  const documento = await PDFDocument.create();
  const fuenteNormal = await documento.embedFont(StandardFonts.Helvetica);
  const fuenteNegrita = await documento.embedFont(StandardFonts.HelveticaBold);

  const anchoPagina = 595.28;
  const altoPagina = 841.89;
  const margen = 28;
  const anchoTarjeta = anchoPagina - margen * 2;
  const altoTarjeta = 118;
  const tarjetasPorPagina = Math.floor((altoPagina - margen * 2 - 40) / (altoTarjeta + 10));

  let pagina: PDFPage | null = null;
  let indice = 0;

  for (const item of datos) {
    if (indice % tarjetasPorPagina === 0) {
      pagina = documento.addPage([anchoPagina, altoPagina]);
    }
    const actual = pagina!;
    const y = altoPagina - margen - (indice % tarjetasPorPagina) * (altoTarjeta + 10) - altoTarjeta;

    actual.drawRectangle({
      x: margen,
      y,
      width: anchoTarjeta,
      height: altoTarjeta,
      borderColor: GRIS_LINEA,
      borderWidth: 1,
      color: rgb(1, 1, 1),
    });

    const qr = await documento.embedPng(await imagenQr(item.codigoRegistro));
    actual.drawImage(qr, { x: margen + 14, y: y + 14, width: 90, height: 90 });

    const textoX = margen + 120;
    let cursorY = y + altoTarjeta - 26;

    actual.drawText(`${item.asistente.nombres} ${item.asistente.apellidos}`, {
      x: textoX,
      y: cursorY,
      size: 13,
      font: fuenteNegrita,
      color: NEGRO,
      maxWidth: 330,
    });
    cursorY -= 17;
    actual.drawText(`Codigo de registro: ${item.codigoRegistro}`, {
      x: textoX,
      y: cursorY,
      size: 13,
      font: fuenteNegrita,
      color: AZUL_PETROLEO,
    });
    cursorY -= 14;
    actual.drawText(`ID institucional: ${item.idInstitucional}`, {
      x: textoX,
      y: cursorY,
      size: 10,
      font: fuenteNormal,
      color: GRIS_TEXTO,
    });
    cursorY -= 13;
    actual.drawText(`Correo: ${item.email ?? 'no informado'}`, {
      x: textoX,
      y: cursorY,
      size: 10,
      font: fuenteNormal,
      color: GRIS_TEXTO,
    });
    cursorY -= 13;
    actual.drawText(item.nombreSeminario, {
      x: textoX,
      y: cursorY,
      size: 9,
      font: fuenteNormal,
      color: GRIS_TEXTO,
      maxWidth: 330,
    });

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
