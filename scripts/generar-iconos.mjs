/**
 * Genera los iconos de la aplicacion (PNG) y el favicon (SVG) sin dependencias
 * externas: se rasteriza un fondo azul petroleo con una marca de verificacion
 * blanca y se arma el PNG a mano (IHDR + IDAT + IEND) con zlib.
 *
 * Uso: node scripts/generar-iconos.mjs
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const COLOR_FONDO = [0x12, 0x50, 0x5e];
const COLOR_MARCA = [0xff, 0xff, 0xff];

const TABLA_CRC = (() => {
  const tabla = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    tabla[n] = c;
  }
  return tabla;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) {
    crc = TABLA_CRC[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

function trozo(tipo, datos) {
  const longitud = Buffer.alloc(4);
  longitud.writeUInt32BE(datos.length, 0);
  const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo), 0);
  return Buffer.concat([longitud, cuerpo, crc]);
}

function png(ancho, alto, pixeles) {
  const firma = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const filas = Buffer.alloc((ancho * 3 + 1) * alto);
  for (let y = 0; y < alto; y += 1) {
    const inicio = y * (ancho * 3 + 1);
    filas[inicio] = 0;
    pixeles.copy(filas, inicio + 1, y * ancho * 3, (y + 1) * ancho * 3);
  }

  return Buffer.concat([
    firma,
    trozo('IHDR', ihdr),
    trozo('IDAT', deflateSync(filas, { level: 9 })),
    trozo('IEND', Buffer.alloc(0)),
  ]);
}

function distanciaSegmento(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const largo = dx * dx + dy * dy;
  const t = largo === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / largo));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** Dibuja la marca de verificacion con antialiasing por supermuestreo. */
function dibujarIcono(tamano) {
  const pixeles = Buffer.alloc(tamano * tamano * 3);
  const muestras = 3;
  const grosor = tamano * 0.085;
  const puntos = [
    [tamano * 0.27, tamano * 0.52],
    [tamano * 0.44, tamano * 0.69],
    [tamano * 0.74, tamano * 0.32],
  ];

  for (let y = 0; y < tamano; y += 1) {
    for (let x = 0; x < tamano; x += 1) {
      let dentro = 0;
      for (let sy = 0; sy < muestras; sy += 1) {
        for (let sx = 0; sx < muestras; sx += 1) {
          const px = x + (sx + 0.5) / muestras;
          const py = y + (sy + 0.5) / muestras;
          const d1 = distanciaSegmento(px, py, ...puntos[0], ...puntos[1]);
          const d2 = distanciaSegmento(px, py, ...puntos[1], ...puntos[2]);
          if (Math.min(d1, d2) <= grosor / 2) dentro += 1;
        }
      }
      const total = muestras * muestras;
      const mezcla = dentro / total;
      const indice = (y * tamano + x) * 3;
      for (let canal = 0; canal < 3; canal += 1) {
        pixeles[indice + canal] = Math.round(
          COLOR_FONDO[canal] * (1 - mezcla) + COLOR_MARCA[canal] * mezcla,
        );
      }
    }
  }

  return pixeles;
}

const destino = path.resolve(process.cwd(), 'apps/web/public');
mkdirSync(destino, { recursive: true });

for (const tamano of [192, 512]) {
  const imagen = png(tamano, tamano, dibujarIcono(tamano));
  writeFileSync(path.join(destino, `icono-${tamano}.png`), imagen);
  console.log(`Generado icono-${tamano}.png`);
}

const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Control de asistencia">
  <rect width="64" height="64" rx="14" fill="#12505E" />
  <path d="M17 33 L27 43 L47 21" fill="none" stroke="#ffffff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" />
</svg>
`;
writeFileSync(path.join(destino, 'favicon.svg'), favicon, 'utf8');
console.log('Generado favicon.svg');
