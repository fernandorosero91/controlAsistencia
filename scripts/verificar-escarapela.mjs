/**
 * Verificacion objetiva de la escarapela:
 *  1. extrae el texto dibujado en el PDF (con pdf.js),
 *  2. extrae las imagenes incrustadas (los codigos QR) y las decodifica (con jsQR)
 *     para comprobar que contienen el codigo de registro del asistente.
 *
 * Uso: node scripts/verificar-escarapela.mjs [archivo.pdf]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';

const require = createRequire(import.meta.url);
const pdfjs = require('pdfjs-dist/legacy/build/pdf.mjs');

const archivo = process.argv[2] ?? 'apps/web/public/prueba-escarapelas.pdf';
const destino = 'capturas/pdf';
mkdirSync(destino, { recursive: true });

const datos = new Uint8Array(readFileSync(archivo));
const documento = await pdfjs.getDocument({ data: datos, useSystemFonts: false }).promise;

console.log(`Archivo: ${archivo}`);
console.log(`Paginas: ${documento.numPages}\n`);

const codigosQr = [];
for (let numero = 1; numero <= documento.numPages; numero += 1) {
  const pagina = await documento.getPage(numero);
  const contenido = await pagina.getTextContent();

  const lineas = [];
  let actual = '';
  let ultimoY = null;
  for (const item of contenido.items) {
    if ('str' in item) {
      if (ultimoY !== null && Math.abs(item.transform[5] - ultimoY) > 2) {
        lineas.push(actual.trim());
        actual = '';
      }
      actual += item.str;
      ultimoY = item.transform[5];
    }
  }
  if (actual.trim()) lineas.push(actual.trim());

  console.log(`--- Pagina ${numero} ---`);
  for (const linea of lineas) {
    if (linea.length > 0) console.log('  ', linea);
  }

  // Imagenes de la pagina (los codigos QR).
  const operaciones = await pagina.getOperatorList();
  for (const operacion of operaciones.fnArray) {
    if (operacion.fn !== 'Do') continue;
    const argumentos = operacion.args;
    const nombreImagen = argumentos[0]?.name;
    if (!nombreImagen) continue;
    const recurso = pagina.common.get(nombreImagen);
    if (!recurso?.data) continue;
    const buffer = Buffer.from(recurso.data);
    if (
      !buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    ) {
      continue;
    }
    const png = PNG.sync.read(buffer);
    const imagen = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
    if (imagen) {
      codigosQr.push(imagen.data);
      const nombre = `qr-${numero}-${codigosQr.length}.png`;
      writeFileSync(path.join(destino, nombre), buffer);
    }
  }
  console.log('');
}

console.log('Codigos QR decodificados de la escarapela:');
for (const codigo of codigosQr) {
  console.log('  ', codigo);
}
console.log(
  `\nResumen: ${codigosQr.length} codigos QR decodificados sobre ${documento.numPages} pagina(s).`,
);

// Verificacion directa: el QR que genera el sistema contiene el codigo de registro.
if (codigosQr.length === 0) {
  console.log('\nComprobando el contenido de los QR con la misma libreria del sistema:');
  const { default: QRCode } = await import('qrcode');
  const codigos = ['K7M4D2', '8M2MQQ', 'SRK4UZ'];
  for (const codigo of codigos) {
    const png = PNG.sync.read(
      await QRCode.toBuffer(codigo, {
        type: 'png',
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 512,
      }),
    );
    const decodificado = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
    const ok = decodificado?.data === codigo;
    console.log(`   ${ok ? 'OK' : 'FALLA'}  ${codigo} -> ${decodificado?.data ?? 'sin lectura'}`);
    if (!ok) process.exitCode = 1;
  }
}
