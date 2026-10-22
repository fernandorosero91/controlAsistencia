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

  it('rechaza un archivo que ni siquiera es un ZIP', async () => {
    await expect(abrirPlantilla(Buffer.from('esto no es un docx'))).rejects.toThrow(
      /no es un documento .docx valido/,
    );
  });

  it('reemplaza los cinco campos reconocidos de la plantilla', async () => {
    const documento =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document ${NS}><w:body>` +
      parrafo('{{nombre}}|{{cedula}}|{{id}}|{{rol}}|{{semestre}}') +
      `</w:body></w:document>`;
    const plantilla = await abrirPlantilla(await construirDocx(documento));
    const salida = await generarDocx(plantilla, DATOS);
    const zip = await JSZip.loadAsync(salida);
    const xml = await zip.file('word/document.xml')!.async('string');

    expect(xml).toContain('ANA MARIA PEREZ GOMEZ|1088123456|EST00121|Estudiante|4');
    expect(xml).not.toContain('{{');
  });

  it('detecta los campos aunque tengan espacios internos', () => {
    const campos = detectarCampos(parrafo('{{ nombre }} y {{  cedula  }}'));
    expect(campos.sort()).toEqual(['cedula', 'nombre']);
  });

  it('escapa los caracteres especiales de XML en los datos del titular', async () => {
    const documento =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document ${NS}><w:body>${parrafo('{{nombre}}')}</w:body></w:document>`;
    const plantilla = await abrirPlantilla(await construirDocx(documento));
    const tituloRiesgoso = { ...DATOS, nombre: 'ANA & CIA <S.A.> "especial"' };
    const salida = await generarDocx(plantilla, tituloRiesgoso);
    const zip = await JSZip.loadAsync(salida);
    const xml = await zip.file('word/document.xml')!.async('string');

    // El XML debe quedar bien formado: los caracteres se escapan, no se interpolan crudos.
    expect(xml).toContain('ANA &amp; CIA &lt;S.A.&gt; &quot;especial&quot;');
    expect(xml).not.toContain('ANA & CIA');
    // El documento sigue siendo un ZIP valido y parseable.
    const salidaZip = new JSZip();
    await expect(salidaZip.loadAsync(salida)).resolves.toBeTruthy();
  });

  it('deja vacio el campo del titular cuando el dato no viene', async () => {
    const documento =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document ${NS}><w:body>${parrafo('Semestre: {{semestre}}.')}</w:body></w:document>`;
    const plantilla = await abrirPlantilla(await construirDocx(documento));
    const sinSemestre = { ...DATOS, semestre: '' };
    const salida = await generarDocx(plantilla, sinSemestre);
    const zip = await JSZip.loadAsync(salida);
    const xml = await zip.file('word/document.xml')!.async('string');

    expect(xml).toContain('Semestre: .');
    expect(xml).not.toContain('{{semestre}}');
  });

  it('conserva el XML del encabezado y pie con campos', async () => {
    const encabezado = `<w:hdr ${NS}>${parrafo('Certificado de {{nombre}}')}</w:hdr>`;
    const plantilla = await abrirPlantilla(
      await construirDocx(DOCUMENTO_BASE, { 'word/header1.xml': encabezado }),
    );
    const salida = await generarDocx(plantilla, DATOS);
    const zip = await JSZip.loadAsync(salida);
    const headerXml = await zip.file('word/header1.xml')!.async('string');

    expect(headerXml).toContain('ANA MARIA PEREZ GOMEZ');
    expect(headerXml).not.toContain('{{nombre}}');
  });
});
