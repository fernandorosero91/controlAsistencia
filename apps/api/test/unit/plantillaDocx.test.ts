import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { abrirPlantilla, detectarCampos, generarDocx } from '../../src/servicios/plantillaDocx.js';

/**
 * Generacion de certificados en .docx a partir de una plantilla.
 *
 * Un .docx es un ZIP con XML adentro. Estas pruebas fijan el contrato del
 * reemplazo: los campos {{campo}} se sustituyen aunque Word haya partido el
 * texto en varios runs, y los demas recursos del documento se conservan.
 */

/** Construye un .docx minimo con el XML del documento indicado. */
async function construirDocx(documentXml: string, extras: Record<string, string> = {}): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="xml" ContentType="application/xml"/></Types>',
  );
  zip.file('word/document.xml', documentXml);
  for (const [nombre, contenido] of Object.entries(extras)) {
    zip.file(nombre, contenido);
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function parrafo(texto: string): string {
  return `<w:p ${NS}><w:r><w:t>${texto}</w:t></w:r></w:p>`;
}

const DOCUMENTO_BASE =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:document ${NS}><w:body>` +
  parrafo('Certificado para {{nombre}}') +
  parrafo('Documento {{cedula}}') +
  `</w:body></w:document>`;

const DATOS = {
  asistenteId: 'EST00121',
  nombre: 'ANA MARIA PEREZ GOMEZ',
  cedula: '1088123456',
  id: 'EST00121',
  rol: 'Estudiante',
  semestre: '4',
};

describe('deteccion de campos de una plantilla', () => {
  it('reconoce los campos conocidos entre dobles llaves', () => {
    const campos = detectarCampos(DOCUMENTO_BASE);
    expect(campos.sort()).toEqual(['cedula', 'nombre']);
  });

  it('ignora los campos desconocidos', () => {
    const campos = detectarCampos(parrafo('{{nombre}} {{desconocido}}'));
    expect(campos).toEqual(['nombre']);
  });
});

describe('generacion de certificados desde plantilla', () => {
  it('reemplaza los campos por los datos del titular', async () => {
    const plantilla = await abrirPlantilla(await construirDocx(DOCUMENTO_BASE));
    const salida = await generarDocx(plantilla, DATOS);
    const zip = await JSZip.loadAsync(salida);
    const xml = await zip.file('word/document.xml')!.async('string');

    expect(xml).toContain('ANA MARIA PEREZ GOMEZ');
    expect(xml).toContain('1088123456');
    expect(xml).not.toContain('{{nombre}}');
    expect(xml).not.toContain('{{cedula}}');
  });

  it('reconoce los campos aunque Word haya partido el texto en varios runs', async () => {
    const documento =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document ${NS}><w:body>` +
      `<w:p ${NS}><w:r><w:t>{{nom</w:t></w:r><w:r><w:t>bre}}</w:t></w:r></w:p>` +
      `</w:body></w:document>`;

    const plantilla = await abrirPlantilla(await construirDocx(documento));
    const salida = await generarDocx(plantilla, DATOS);
    const zip = await JSZip.loadAsync(salida);
    const xml = await zip.file('word/document.xml')!.async('string');

    expect(xml).toContain('ANA MARIA PEREZ GOMEZ');
    expect(xml).not.toContain('{{');
  });

  it('conserva los recursos binarios de la plantilla', async () => {
    const documento = DOCUMENTO_BASE.replace('</w:body>', '<w:r><w:drawing/></w:r></w:body>');
    const plantilla = await abrirPlantilla(
      await construirDocx(documento, { 'word/media/image1.png': 'PNGDATA' }),
    );
    const salida = await generarDocx(plantilla, DATOS);
    const zip = await JSZip.loadAsync(salida);

    expect(zip.file('word/media/image1.png')).not.toBeNull();
    expect(zip.file('[Content_Types].xml')).not.toBeNull();
  });

  it('rechaza un archivo que no es un .docx', async () => {
    const zip = new JSZip();
    zip.file('archivo.txt', 'no es word');
    const contenido = await zip.generateAsync({ type: 'nodebuffer' });

    await expect(abrirPlantilla(contenido)).rejects.toThrow(/word\/document\.xml/);
  });
});
