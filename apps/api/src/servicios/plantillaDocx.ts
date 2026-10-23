import JSZip from 'jszip';
import {
  ALIAS_CONTROL_PLANTILLA,
  CAMPOS_PLANTILLA,
  normalizarTituloControl,
  type CampoPlantilla,
  type DatosTitularPlantilla,
} from '@seminario/shared';

/**
 * Manipulacion de plantillas .docx sin dependencias nativas.
 *
 * Un .docx es un archivo ZIP con XML adentro. Para emitir un certificado se abre
 * la plantilla, se recorren los XML de `word/` y se reemplazan los campos
 * `{{campo}}` por los datos del titular, y se vuelve a comprimir. Es la misma
 * estrategia del script de escritorio (CertificateCreator.py), pero resuelta
 * aqui con JSZip para que corra dentro de la API.
 *
 * Nota sobre el XML de Word: un texto puede quedar partido en varios runs
 * (`<w:r><w:t>NOM</w:t></w:r><w:r><w:t>BRE</w:t></w:r>`). Antes de reemplazar se
 * "aplanan" los run, de modo que `{{nombre}}` se reconoce aunque Word lo haya
 * fragmentado. El aplanado solo toca el texto; el formato del primer run se
 * conserva.
 */

const ARCHIVOS_XML_DOCX = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/;

/** Escapa un valor para incrustarlo en XML. */
function escaparXml(valor: string): string {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Une en un solo run los fragmentos de texto consecutivos de un parrafo.
 *
 * Word parte el texto en varios `<w:r>` cuando cambia el formato o cuando se
 * edita el documento varias veces. Eso rompe la deteccion de `{{campo}}`, que
 * queda repartido entre runs. El aplanado deja el contenido textual completo en
 * el primer `<w:t>` del parrafo y vacia los demas, conservando sus propiedades.
 */
function aplanarRuns(xml: string): string {
  // El grupo 1 es el prefijo de apertura del parrafo (para recortar solo dentro),
  // el grupo 2 es el cuerpo del parrafo (hasta el cierre).
  return xml.replace(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g, (parrafoCompleto) => {
    const coincidencia = /^<w:p(?:\s[^>]*)?>/.exec(parrafoCompleto);
    if (!coincidencia) return parrafoCompleto;
    const apertura = coincidencia[0];
    const cuerpo = parrafoCompleto.slice(apertura.length, -'</w:p>'.length);

    // Extrae los textos en orden, con la posicion del inicio de cada <w:t ...>.
    const textos: string[] = [];
    const cuerpoSinTexto = cuerpo.replace(/(<w:t(?:\s[^>]*)?>)([\s\S]*?)(<\/w:t>)/g, (_m, ini, texto, fin) => {
      textos.push(texto);
      return `${ini}${fin}`;
    });

    if (textos.length <= 1) return parrafoCompleto;

    let indice = 0;
    const cuerpoAplanado = cuerpoSinTexto.replace(
      /(<w:t(?:\s[^>]*)?>)(<\/w:t>)/g,
      (_m, ini, fin) => {
        const valor = indice === 0 ? textos.join('') : '';
        indice += 1;
        return `${ini}${valor}${fin}`;
      },
    );
    return `${apertura}${cuerpoAplanado}</w:p>`;
  });
}

/** Detecta que campos `{{campo}}` contiene el documento. */
export function detectarCampos(xml: string): CampoPlantilla[] {
  const encontrados = new Set<CampoPlantilla>();
  const patron = /\{\{\s*(\w+)\s*\}\}/g;
  let coincidencia: RegExpExecArray | null;
  while ((coincidencia = patron.exec(xml)) !== null) {
    const nombre = coincidencia[1]?.toLowerCase();
    if ((CAMPOS_PLANTILLA as readonly string[]).includes(nombre ?? '')) {
      encontrados.add(nombre as CampoPlantilla);
    }
  }
  return [...encontrados];
}

/**
 * Detecta que campos del modulo aparecen como controles de contenido (SDT) de
 * Word. El `tag` (o el `alias` si no hay tag) de cada control se normaliza y se
 * busca en el mapeo de alias. Es el formato que usan las plantillas
 * institucionales, que no escriben `{{campo}}`.
 */
export function detectarCamposControl(xml: string): CampoPlantilla[] {
  const encontrados = new Set<CampoPlantilla>();
  const patron = /<w:sdt(?:\s[^>]*)?>([\s\S]*?)<\/w:sdt>/g;
  let coincidencia: RegExpExecArray | null;
  while ((coincidencia = patron.exec(xml)) !== null) {
    const titulo = tituloDeControl(coincidencia[1] ?? '');
    if (!titulo) continue;
    const campo = ALIAS_CONTROL_PLANTILLA[normalizarTituloControl(titulo)];
    if (campo) encontrados.add(campo);
  }
  return [...encontrados];
}

/** Extrae el tag (o el alias) del bloque <w:sdtPr> de un control de contenido. */
function tituloDeControl(cuerpoSdt: string): string | null {
  const sdtPr = /<w:sdtPr(?:\s[^>]*)?>([\s\S]*?)<\/w:sdtPr>/.exec(cuerpoSdt);
  if (!sdtPr) return null;
  const tag = /<w:tag\s+w:val="([^"]*)"/.exec(sdtPr[1] ?? '');
  if (tag?.[1]) return tag[1];
  const alias = /<w:alias\s+w:val="([^"]*)"/.exec(sdtPr[1] ?? '');
  return alias?.[1] ?? null;
}

/**
 * Reemplaza el texto del `<w:sdtContent>` de cada control de contenido conocido.
 *
 * Se conserva la estructura del control (propiedades, estilos) y solo se sustituye
 * el texto: el primer `<w:t>` recibe el valor y los demas se vacian, de modo que
 * un valor con varias palabras no quede fragmentado. Si el campo no tiene valor,
 * el control queda vacio.
 */
function reemplazarControles(xml: string, valores: Record<CampoPlantilla, string>): string {
  const patron = /(<w:sdt(?:\s[^>]*)?>)([\s\S]*?)(<\/w:sdt>)/g;
  return xml.replace(patron, (bloque, apertura: string, cuerpo: string, cierre: string) => {
    const titulo = tituloDeControl(cuerpo);
    if (!titulo) return bloque;
    const campo = ALIAS_CONTROL_PLANTILLA[normalizarTituloControl(titulo)];
    if (!campo) return bloque;

    const valor = escaparXml(valores[campo] ?? '');
    const cuerpoNuevo = cuerpo.replace(
      /<w:sdtContent(?:\s[^>]*)?>([\s\S]*?)<\/w:sdtContent>/,
      (contenidoCompleto, interno: string) => {
        let primero = true;
        const internoNuevo = interno.replace(
          /(<w:t(?:\s[^>]*)?>)([\s\S]*?)(<\/w:t>)/g,
          (_m, ini: string, _texto: string, fin: string) => {
            const nuevo = primero ? valor : '';
            primero = false;
            return `${ini}${nuevo}${fin}`;
          },
        );
        // Si el control no tenia ningun <w:t>, se crea uno con el valor.
        if (primero) {
          return `<w:sdtContent>${interno}<w:r><w:t>${valor}</w:t></w:r></w:sdtContent>`;
        }
        return contenidoCompleto.replace(interno, internoNuevo);
      },
    );
    return `${apertura}${cuerpoNuevo}${cierre}`;
  });
}

/** Reemplaza los `{{campo}}` de un XML por los valores del titular. */
function reemplazarCampos(xml: string, datos: DatosTitularPlantilla): string {
  const valores: Record<CampoPlantilla, string> = {
    nombre: datos.nombre,
    cedula: datos.cedula,
    id: datos.id,
    rol: datos.rol,
    semestre: datos.semestre,
  };
  const conLlaves = xml.replace(/\{\{\s*(\w+)\s*\}\}/g, (original, campo: string) => {
    const clave = campo.toLowerCase() as CampoPlantilla;
    if (!(CAMPOS_PLANTILLA as readonly string[]).includes(clave)) return original;
    return escaparXml(valores[clave] ?? '');
  });
  // Ademas de `{{campo}}`, se reemplazan los controles de contenido de Word.
  return reemplazarControles(conLlaves, valores);
}

export interface PlantillaCargada {
  /** Documento ZIP abierto (para copiar los recursos binarios: imagenes, fuentes, etc.). */
  zip: JSZip;
  /** XML original de cada archivo de texto, ya aplanado una sola vez. */
  xml: Map<string, string>;
  /** Campos detectados en la plantilla. */
  campos: CampoPlantilla[];
}

/** Abre una plantilla .docx y valida que sea un documento de Word. */
export async function abrirPlantilla(contenido: Buffer | Uint8Array): Promise<PlantillaCargada> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(contenido);
  } catch {
    throw new Error('El archivo no es un documento .docx valido');
  }

  const documento = zip.file('word/document.xml');
  if (!documento) {
    throw new Error('El archivo .docx no contiene word/document.xml');
  }

  const campos = new Set<CampoPlantilla>();
  const xml = new Map<string, string>();
  const nombresArchivos = Object.keys(zip.files).filter((nombre) => ARCHIVOS_XML_DOCX.test(nombre));
  for (const nombre of nombresArchivos) {
    const contenidoXml = await zip.file(nombre)?.async('string');
    if (!contenidoXml) continue;
    // El aplanado se hace una sola vez al cargar la plantilla.
    const aplanado = aplanarRuns(contenidoXml);
    xml.set(nombre, aplanado);
    for (const campo of detectarCampos(aplanado)) campos.add(campo);
    for (const campo of detectarCamposControl(aplanado)) campos.add(campo);
  }

  return { zip, xml, campos: [...campos] };
}

/**
 * Genera un .docx con los datos del titular a partir de una plantilla abierta.
 *
 * Se reconstruye el ZIP: los recursos binarios (imagenes, fuentes, estilos) se
 * copian del original y solo se sustituyen los XML con los campos del titular.
 * Los XML ya vienen aplanados desde `abrirPlantilla`, asi que generar cientos
 * de certificados no vuelve a tocar el disco.
 */
export async function generarDocx(
  plantilla: PlantillaCargada,
  datos: DatosTitularPlantilla,
): Promise<Buffer> {
  const salida = new JSZip();
  for (const nombreArchivo of Object.keys(plantilla.zip.files)) {
    const entrada = plantilla.zip.file(nombreArchivo);
    if (!entrada) continue;

    const xmlOriginal = plantilla.xml.get(nombreArchivo);
    if (xmlOriginal !== undefined) {
      salida.file(nombreArchivo, reemplazarCampos(xmlOriginal, datos));
      continue;
    }

    if (entrada.dir) {
      salida.folder(nombreArchivo);
      continue;
    }

    const binario = await entrada.async('nodebuffer');
    salida.file(nombreArchivo, binario, { binary: true });
  }

  return salida.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
