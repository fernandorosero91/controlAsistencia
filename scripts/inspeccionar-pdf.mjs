/**
 * Inspecciona un PDF del sistema: extrae el texto dibujado y las imagenes
 * incrustadas (los codigos QR). Sirve para verificar que la escarapela lleva el
 * nombre, el ID, el codigo de registro y el QR correcto.
 *
 * Uso: node scripts/inspeccionar-pdf.mjs apps/web/public/prueba-escarapelas.pdf
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import path from 'node:path';

const archivo = process.argv[2] ?? 'apps/web/public/prueba-escarapelas.pdf';
const destino = process.argv[3] ?? 'capturas/pdf';
mkdirSync(destino, { recursive: true });

const buffer = readFileSync(archivo);
console.log(`Archivo: ${archivo} (${buffer.length} bytes)`);

// Se recorren los objetos del PDF buscando flujos y recursos.
const objetos = buffer.toString('latin1').match(/(\d+) 0 obj[\s\S]*?endobj/g) ?? [];
console.log(`Objetos en el PDF: ${objetos.length}`);

const texto = [];
const imagenes = [];

for (const objeto of objetos) {
  const referencia = /^(\d+) 0 obj/.exec(objeto)?.[1];

  if (/FlateDecode/.test(objeto) && /stream/.test(objeto)) {
    const inicio = objeto.indexOf('stream');
    const fin = objeto.indexOf('endstream');
    if (inicio < 0 || fin < 0) continue;
    const crudo = Buffer.from(objeto.slice(inicio + 6, fin), 'latin1');
    let inflado;
    try {
      inflado = inflateSync(crudo);
    } catch {
      continue;
    }
    const contenido = inflado.toString('latin1');

    // Texto mostrado en la pagina.
    for (const coincidencia of contenido.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g)) {
      texto.push(coincidencia[1].replace(/\\([()\\])/g, '$1'));
    }
    for (const coincidencia of contenido.matchAll(/\[((?:[^\]\\]|\\.)*)\]\s*TJ/g)) {
      const partes = [...coincidencia[1].matchAll(/\(((?:[^()\\]|\\.)*)\)/g)].map((p) => p[1]);
      texto.push(partes.join(''));
    }

    // Imagenes incrustadas (codigos QR en PNG).
    if (/\/Subtype\s*\/Image/.test(objeto) || contenido.startsWith('\x89PNG')) {
      const esPng = contenido.startsWith('\x89PNG');
      const esJpg = contenido.startsWith('\xff\xd8');
      if (esPng || esJpg) {
        const nombre = `imagen-${referencia ?? 'x'}.${esPng ? 'png' : 'jpg'}`;
        writeFileSync(path.join(destino, nombre), inflado);
        imagenes.push(`${nombre} (${inflado.length} bytes)`);
      }
    }
  }
}

console.log('\nTexto dibujado en el PDF:');
const unicos = [...new Set(texto)].filter((linea) => linea.trim().length > 0);
for (const linea of unicos.slice(0, 40)) {
  console.log('  ', linea);
}

console.log('\nImagenes incrustadas:');
if (imagenes.length === 0) {
  console.log('   (seLocalizan en el recurso de la pagina)');
} else {
  for (const imagen of imagenes) console.log('  ', imagen);
}
