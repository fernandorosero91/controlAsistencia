import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import QRCode from 'qrcode';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Firmante } from '@seminario/shared';

/**
 * Plantilla del certificado.
 *
 * Diseno: hoja horizontal, banda superior con degradado de marca y el logotipo
 * institucional, motivo visual de ingenieria de software (retícula de pixeles),
 * bloque central con el titular del certificado, panel de verificacion con QR y
 * hasta tres firmantes configurables.
 */

const ANCHO = 792;
const ALTO = 612;
const MARGEN = 44;

const AZUL = rgb(0.075, 0.153, 0.251);
const CIAN = rgb(0, 0.675, 0.788);
const LIMA = rgb(0.502, 0.729, 0.153);
const AZUL_NOCHE = rgb(0.075, 0.153, 0.251);
const GRIS = rgb(0.373, 0.369, 0.369);
const GRIS_LINEA = rgb(0.882, 0.882, 0.882);

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
  firmas: Firmante[];
  codigoVerificacion: string;
  urlVerificacion: string;
}

function rutasLogo(): { color: string | null; blanco: string | null } {
  const candidatos = [
    path.resolve(process.cwd(), 'assets'),
    path.resolve(process.cwd(), 'apps', 'api', 'assets'),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets'),
  ];
  for (const directorio of candidatos) {
    const color = path.join(directorio, 'logo-ucc-horizontal.png');
    if (!existsSync(color)) continue;
    const blanco = path.join(directorio, 'logo-ucc-blanco-horizontal.png');
    return { color, blanco: existsSync(blanco) ? blanco : null };
  }
  return { color: null, blanco: null };
}

/** Dibuja un degradado horizontal con una franja de color solido por paso. */
function degradado(
  pagina: PDFPage,
  x: number,
  y: number,
  ancho: number,
  alto: number,
  desde: { r: number; g: number; b: number },
  hasta: { r: number; g: number; b: number },
  pasos = 48,
): void {
  const paso = ancho / pasos;
  for (let indice = 0; indice < pasos; indice += 1) {
    const t = indice / (pasos - 1);
    pagina.drawRectangle({
      x: x + indice * paso,
      y,
      width: paso + 0.6,
      height: alto,
      color: rgb(
        desde.r + (hasta.r - desde.r) * t,
        desde.g + (hasta.g - desde.g) * t,
        desde.b + (hasta.b - desde.b) * t,
      ),
    });
  }
}

/**
 * Motivo visual: retícula de pixeles que evoca el software y la ingenieria.
 * Se dibuja en la esquina inferior derecha con baja opacidad.
 */
function reticulaSoftware(
  pagina: PDFPage,
  x: number,
  y: number,
  columnas: number,
  filas: number,
): void {
  const paso = 11;
  for (let fila = 0; fila < filas; fila += 1) {
    for (let columna = 0; columna < columnas; columna += 1) {
      const destacado = (fila * 7 + columna * 3) % 11 === 0;
      if (!destacado && (fila + columna) % 3 !== 0) continue;
      pagina.drawRectangle({
        x: x + columna * paso,
        y: y + fila * paso,
        width: 3.4,
        height: 3.4,
        color: destacado ? LIMA : CIAN,
        opacity: destacado ? 0.34 : 0.18,
      });
    }
  }
}

function envolver(texto: string, fuente: PDFFont, tamano: number, anchoMax: number): string[] {
  const palabras = texto.split(/\s+/).filter((palabra) => palabra.length > 0);
  const lineas: string[] = [];
  let actual = '';
  for (const palabra of palabras) {
    const candidata = actual.length === 0 ? palabra : `${actual} ${palabra}`;
    if (fuente.widthOfTextAtSize(candidata, tamano) <= anchoMax) {
      actual = candidata;
    } else {
      if (actual.length > 0) lineas.push(actual);
      actual = palabra;
    }
  }
  if (actual.length > 0) lineas.push(actual);
  return lineas;
}

export async function generarCertificadoPDF(datos: DatosCertificado): Promise<Uint8Array> {
  const documento = await PDFDocument.create();
  const pagina = documento.addPage([ANCHO, ALTO]);

  const fuente = await documento.embedFont(StandardFonts.Helvetica);
  const fuenteNegrita = await documento.embedFont(StandardFonts.HelveticaBold);
  const fuenteTitulo = await documento.embedFont(StandardFonts.TimesRomanBold);
  const fuenteSerif = await documento.embedFont(StandardFonts.TimesRoman);

  pagina.drawRectangle({ x: 0, y: 0, width: ANCHO, height: ALTO, color: rgb(1, 1, 1) });
  reticulaSoftware(pagina, ANCHO - 210, 120, 17, 15);

  // ------------------------------------------------------------------ marco
  pagina.drawRectangle({
    x: 22,
    y: 22,
    width: ANCHO - 44,
    height: ALTO - 44,
    borderColor: AZUL,
    borderWidth: 1.1,
    opacity: 0,
  });
  pagina.drawRectangle({
    x: 27,
    y: 27,
    width: ANCHO - 54,
    height: ALTO - 54,
    borderColor: GRIS_LINEA,
    borderWidth: 0.6,
    opacity: 0,
  });

  // -------------------------------------------------------------- banda superior
  const altoBanda = 96;
  degradado(
    pagina,
    0,
    ALTO - altoBanda,
    ANCHO,
    altoBanda,
    { r: 0.075, g: 0.153, b: 0.251 },
    { r: 0, g: 0.675, b: 0.788 },
  );
  pagina.drawRectangle({
    x: 0,
    y: ALTO - altoBanda - 4,
    width: ANCHO,
    height: 4,
    color: LIMA,
  });

  const logos = rutasLogo();
  if (logos.blanco) {
    try {
      const logo = await documento.embedPng(await readFile(logos.blanco));
      const anchoLogo = 176;
      const altoLogo = (logo.height / logo.width) * anchoLogo;
      pagina.drawImage(logo, {
        x: MARGEN,
        y: ALTO - altoBanda + (altoBanda - altoLogo) / 2,
        width: anchoLogo,
        height: altoLogo,
      });
    } catch {
      // Si el logotipo no esta disponible, el certificado se genera sin el.
    }
  }

  const tituloBand = datos.nombreSeminario.toUpperCase();
  const lineasTitulo = envolver(tituloBand, fuenteNegrita, 14, 320);
  let cursorTitulo = ALTO - altoBanda + 56;
  for (const linea of lineasTitulo.slice(0, 2)) {
    pagina.drawText(linea, {
      x: ANCHO - MARGEN - 320,
      y: cursorTitulo,
      size: 14,
      font: fuenteNegrita,
      color: rgb(1, 1, 1),
    });
    cursorTitulo -= 18;
  }
  const detallesEvento = [datos.facultad, datos.lugar, datos.fecha]
    .filter((valor): valor is string => Boolean(valor))
    .join('   |   ');
  if (detallesEvento) {
    const lineasEvento = envolver(detallesEvento, fuente, 9, 320);
    let cursorEvento = cursorTitulo - 2;
    for (const linea of lineasEvento.slice(0, 2)) {
      pagina.drawText(linea, {
        x: ANCHO - MARGEN - 320,
        y: cursorEvento,
        size: 9,
        font: fuente,
        color: rgb(0.86, 0.89, 0.99),
      });
      cursorEvento -= 12;
    }
  }

  // ------------------------------------------------------------------ titulo
  let cursorY = ALTO - altoBanda - 46;
  pagina.drawText('CERTIFICADO DE ASISTENCIA', {
    x: MARGEN,
    y: cursorY,
    size: 22,
    font: fuenteTitulo,
    color: AZUL_NOCHE,
  });
  const anchoTitulo = fuenteTitulo.widthOfTextAtSize('CERTIFICADO DE ASISTENCIA', 22);
  pagina.drawRectangle({
    x: MARGEN,
    y: cursorY - 12,
    width: anchoTitulo,
    height: 2.4,
    color: AZUL,
  });
  cursorY -= 44;

  if (datos.textoEncabezado) {
    for (const linea of envolver(datos.textoEncabezado, fuente, 10.5, 440).slice(0, 2)) {
      pagina.drawText(linea, { x: MARGEN, y: cursorY, size: 10.5, font: fuente, color: GRIS });
      cursorY -= 14;
    }
    cursorY -= 8;
  }

  pagina.drawText('Se certifica que', {
    x: MARGEN,
    y: cursorY,
    size: 12,
    font: fuente,
    color: GRIS,
  });
  cursorY -= 26;

  const nombreCompleto = datos.nombre;
  const lineasNombre = envolver(nombreCompleto, fuenteSerif, 26, 440);
  for (const linea of lineasNombre.slice(0, 2)) {
    pagina.drawText(linea, {
      x: MARGEN,
      y: cursorY,
      size: 26,
      font: fuenteSerif,
      color: AZUL_NOCHE,
    });
    cursorY -= 30;
  }

  cursorY -= 6;
  const cuerpo =
    `identificado(a) con el ID institucional ${datos.id}, participó como ${datos.rol} ` +
    `en el ${datos.nombreSeminario}, ` +
    `realizado el ${datos.fecha}, con una intensidad horaria de ${datos.intensidadHoraria} horas.`;
  for (const linea of envolver(cuerpo, fuente, 11.5, 440)) {
    pagina.drawText(linea, { x: MARGEN, y: cursorY, size: 11.5, font: fuente, color: AZUL_NOCHE });
    cursorY -= 16;
  }

  if (datos.textoCierre) {
    cursorY -= 8;
    for (const linea of envolver(datos.textoCierre, fuente, 10, 440).slice(0, 3)) {
      pagina.drawText(linea, { x: MARGEN, y: cursorY, size: 10, font: fuente, color: GRIS });
      cursorY -= 13;
    }
  }

  // ------------------------------------------------------- panel de verificacion
  const panelX = ANCHO - MARGEN - 208;
  const panelY = 150;
  const panelAncho = 208;
  const panelAlto = 244;
  pagina.drawRectangle({
    x: panelX + 3,
    y: panelY - 3,
    width: panelAncho,
    height: panelAlto,
    color: rgb(0.88, 0.91, 0.95),
    opacity: 0.6,
  });
  pagina.drawRectangle({
    x: panelX,
    y: panelY,
    width: panelAncho,
    height: panelAlto,
    color: rgb(1, 1, 1),
    borderColor: GRIS_LINEA,
    borderWidth: 0.8,
  });
  pagina.drawRectangle({
    x: panelX,
    y: panelY + panelAlto - 26,
    width: panelAncho,
    height: 26,
    color: AZUL,
  });
  pagina.drawText('VERIFICACION DEL CERTIFICADO', {
    x: panelX + 10,
    y: panelY + panelAlto - 17,
    size: 8.5,
    font: fuenteNegrita,
    color: rgb(1, 1, 1),
  });

  const qr = await documento.embedPng(
    await QRCode.toBuffer(datos.urlVerificacion, {
      type: 'png',
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 640,
    }),
  );
  const tamanoQr = 132;
  pagina.drawImage(qr, {
    x: panelX + (panelAncho - tamanoQr) / 2,
    y: panelY + 74,
    width: tamanoQr,
    height: tamanoQr,
  });

  pagina.drawText('CODIGO DE VERIFICACION', {
    x: panelX + 10,
    y: panelY + 58,
    size: 8,
    font: fuente,
    color: GRIS,
  });
  pagina.drawText(datos.codigoVerificacion, {
    x: panelX + 10,
    y: panelY + 40,
    size: 16,
    font: fuenteNegrita,
    color: AZUL,
  });
  pagina.drawText('Consulte en', {
    x: panelX + 10,
    y: panelY + 22,
    size: 8,
    font: fuente,
    color: GRIS,
  });
  pagina.drawText(datos.urlVerificacion, {
    x: panelX + 10,
    y: panelY + 8,
    size: 8.5,
    font: fuente,
    color: AZUL_NOCHE,
    maxWidth: panelAncho - 20,
  });

  // ------------------------------------------------------------------ firmantes
  const firmantes = datos.firmas;
  if (firmantes.length === 0) {
    pagina.drawText('Firmado digitalmente por la coordinacion del seminario', {
      x: MARGEN,
      y: 112,
      size: 9.5,
      font: fuente,
      color: GRIS,
    });
  }
  const anchoFirma =
    (ANCHO - MARGEN * 2 - (firmantes.length - 1) * 30) / Math.max(firmantes.length, 1);
  firmantes.forEach((firmante, indice) => {
    const x = MARGEN + indice * (anchoFirma + 30);
    const y = 116;
    pagina.drawLine({
      start: { x, y: y + 34 },
      end: { x: x + anchoFirma, y: y + 34 },
      thickness: 0.9,
      color: AZUL_NOCHE,
    });
    const lineasNombre = envolver(firmante.nombre, fuenteNegrita, 10, anchoFirma).slice(0, 2);
    let cursorNombre = y + 18;
    for (const linea of lineasNombre) {
      pagina.drawText(linea, {
        x,
        y: cursorNombre,
        size: 10,
        font: fuenteNegrita,
        color: AZUL_NOCHE,
      });
      cursorNombre -= 12;
    }
    pagina.drawText(firmante.cargo, {
      x,
      y: cursorNombre,
      size: 8.5,
      font: fuente,
      color: GRIS,
      maxWidth: anchoFirma,
    });
    if (firmante.entidad) {
      pagina.drawText(firmante.entidad, {
        x,
        y: cursorNombre - 11,
        size: 8,
        font: fuente,
        color: GRIS,
        maxWidth: anchoFirma,
      });
    }
  });

  // ------------------------------------------------------------------- pie
  pagina.drawLine({
    start: { x: MARGEN, y: 74 },
    end: { x: ANCHO - MARGEN, y: 74 },
    thickness: 0.6,
    color: GRIS_LINEA,
  });
  pagina.drawText(
    'Documento generado electronicamente por el sistema de control de asistencia. ' +
      'Los datos personales se tratan conforme a la Ley 1581 de 2012 (Habeas Data).',
    { x: MARGEN, y: 58, size: 8, font: fuente, color: GRIS, maxWidth: 520 },
  );
  pagina.drawText(datos.codigoVerificacion, {
    x: ANCHO - MARGEN - 130,
    y: 58,
    size: 9,
    font: fuenteNegrita,
    color: AZUL,
  });

  return documento.save();
}
