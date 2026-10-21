/**
 * Genera los recursos de marca derivados del logotipo oficial de la
 * Universidad Cooperativa de Colombia:
 *  - icono-192.png e icono-512.png para la PWA (mascara y escritorio)
 *  - logo-ucc-horizontal.png para el certificado en PDF
 *  - favicon.svg con el simbolo sobre fondo de marca
 *
 * El archivo fuente es apps/web/public/logo-ucc.svg (logotipo oficial).
 * Uso: node scripts/generar-iconos.mjs
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const raiz = process.cwd();
const publicDir = path.join(raiz, 'apps', 'web', 'public');
const apiAssetsDir = path.join(raiz, 'apps', 'api', 'assets');

const FUENTE_LOGO = path.join(publicDir, 'logo-ucc.svg');

if (!existsSync(FUENTE_LOGO)) {
  console.error(
    `No se encontro el logotipo en ${FUENTE_LOGO}. Descarguelo desde el sitio institucional.`,
  );
  process.exit(1);
}

mkdirSync(publicDir, { recursive: true });
mkdirSync(apiAssetsDir, { recursive: true });

// Version en blanco del logotipo, para los fondos oscuros (encabezado del panel
// y banda superior del certificado).
const contenido = readFileSync(FUENTE_LOGO, 'utf8');
const versionBlanca = contenido.replace(/fill="#[0-9a-fA-F]{3,8}"/g, 'fill="#ffffff"');
await writeFileSync(path.join(publicDir, 'logo-ucc-blanco.svg'), versionBlanca, 'utf8');
console.log('Generado logo-ucc-blanco.svg');

// Iconos de la PWA: el logotipo centrado sobre fondo blanco de marca.
const icono = await sharp({
  create: {
    width: 512,
    height: 512,
    channels: 4,
    background: '#ffffff',
  },
})
  .composite([
    {
      input: await sharp(FUENTE_LOGO).resize({ width: 380, fit: 'inside' }).png().toBuffer(),
      gravity: 'center',
    },
  ])
  .png()
  .toBuffer();

await sharp(icono).resize(192, 192).png().toFile(path.join(publicDir, 'icono-192.png'));
await sharp(icono).resize(512, 512).png().toFile(path.join(publicDir, 'icono-512.png'));
console.log('Generados icono-192.png e icono-512.png');

// Version horizontal del logotipo para el certificado en PDF.
const horizontal = await sharp(FUENTE_LOGO).resize({ width: 900, fit: 'inside' }).png().toBuffer();
await writeFileSync(path.join(apiAssetsDir, 'logo-ucc-horizontal.png'), horizontal);
console.log('Generado apps/api/assets/logo-ucc-horizontal.png');

// Version en blanco para la banda superior del certificado.
const blancoHorizontal = await sharp(path.join(publicDir, 'logo-ucc-blanco.svg'))
  .resize({ width: 900, fit: 'inside' })
  .png()
  .toBuffer();
await writeFileSync(path.join(apiAssetsDir, 'logo-ucc-blanco-horizontal.png'), blancoHorizontal);
console.log('Generado apps/api/assets/logo-ucc-blanco-horizontal.png');

// Favicon vectorial: el mismo logotipo sobre fondo transparente.
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 208.888 55" role="img" aria-label="Universidad Cooperativa de Colombia">
  <title>Universidad Cooperativa de Colombia</title>
  <rect width="208.888" height="55" fill="none" />
  ${extraerContenedor()}
</svg>
`;

function extraerContenedor() {
  const contenido = readFileSync(FUENTE_LOGO, 'utf8');
  const inicio = contenido.indexOf('<g id="logotipo"');
  const fin = contenido.lastIndexOf('</svg>');
  return inicio >= 0 && fin > inicio ? contenido.slice(inicio, fin) : contenido;
}

await writeFileSync(path.join(publicDir, 'favicon.svg'), favicon, 'utf8');
console.log('Generado favicon.svg');
