import JSZip from 'jszip';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  CLAVE_ADMIN,
  CORREO_ADMIN,
  ID_ASISTENTE,
  ID_ASISTENTE_2,
  ID_ASISTENTE_3,
  crearAplicacionDePruebas,
  hayBaseDePruebas,
  prepararBaseDePruebas,
} from '../ayudas/basePruebas.js';
import { db } from '../../src/db/cliente.js';
import { asistencias, jornadas } from '../../src/db/esquema.js';

/**
 * Elegibilidad y generacion de certificados .docx, de punta a punta.
 *
 * Regla: un asistente solo es elegible si tiene ingreso y salida registrados en
 * cada jornada (manana y tarde), es decir las 4 marcas. Estas pruebas fijan ese
 * contrato contra la base de pruebas: elegibilidad, generacion del documento,
 * compresion del lote, descarga del ZIP y verificacion del contenido.
 */

const descripcion = hayBaseDePruebas()
  ? 'certificados docx desde plantilla'
  : 'certificados docx desde plantilla (omitida: falta DATABASE_URL_TEST)';

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

/** Plantilla .docx real (ZIP con XML) con los cinco campos del modulo. */
async function docxDePrueba(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="xml" ContentType="application/xml"/></Types>',
  );
  zip.file(
    'word/document.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      `<w:document ${NS}><w:body>` +
      `<w:p ${NS}><w:r><w:t>Certificado de {{nombre}} - {{cedula}} - {{id}} - {{rol}} - {{semestre}}</w:t></w:r></w:p>` +
      '</w:body></w:document>',
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

function multipart(
  contenido: Buffer,
  nombreArchivo: string,
  campo: string,
  valor: string,
): { payload: Buffer; contentType: string } {
  const limite = '----SeminarioPruebasCertificados';
  const partes: Buffer[] = [
    Buffer.from(
      `--${limite}\r\n` +
        `Content-Disposition: form-data; name="${campo}"\r\n\r\n${valor}\r\n`,
      'utf8',
    ),
    Buffer.from(
      `--${limite}\r\n` +
        `Content-Disposition: form-data; name="archivo"; filename="${nombreArchivo}"\r\n` +
        `Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n`,
      'utf8',
    ),
    contenido,
    Buffer.from(`\r\n--${limite}--\r\n`, 'utf8'),
  ];
  return {
    payload: Buffer.concat(partes),
    contentType: `multipart/form-data; boundary=${limite}`,
  };
}

describe(descripcion, () => {
  let app: FastifyInstance;
  let token: string;
  let plantillaId: string;
  let idManana: number;
  let idTarde: number;

  beforeAll(async () => {
    if (!hayBaseDePruebas()) return;
    app = await crearAplicacionDePruebas();
    await prepararBaseDePruebas();

    const jornadasFilas = await db.select().from(jornadas).orderBy(jornadas.orden);
    idManana = jornadasFilas[0]!.id;
    idTarde = jornadasFilas[1]!.id;

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: CORREO_ADMIN, password: CLAVE_ADMIN },
    });
    token = login.json().tokenAcceso as string;

    const { payload, contentType } = multipart(
      await docxDePrueba(),
      'plantilla.docx',
      'nombre',
      'Plantilla de pruebas',
    );
    const subida = await app.inject({
      method: 'POST',
      url: '/plantillas-certificado',
      headers: { authorization: `Bearer ${token}`, 'content-type': contentType },
      payload,
    });
    expect(subida.statusCode).toBe(201);
    plantillaId = subida.json().id as string;
  });

  beforeEach(async () => {
    if (!hayBaseDePruebas()) return;
    // Cada prueba parte sin asistencias: la elegibilidad es el objeto de estudio.
    await db.delete(asistencias);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  /** Marca ingreso y salida de un asistente en una jornada. */
  async function registrarJornada(
    asistenteId: string,
    jornadaId: number,
    conSalida = true,
  ): Promise<void> {
    const ingreso = new Date(Date.now() - 60 * 60 * 1000);
    await db.insert(asistencias).values({
      asistenteId,
      jornadaId,
      horaIngreso: ingreso,
      // La salida debe ser posterior al ingreso (check asistencias_salida_posterior).
      horaSalida: conSalida ? new Date(ingreso.getTime() + 60 * 60 * 1000) : null,
    });
  }

  async function elegibilidad(): Promise<{
    elegibles: number;
    total: number;
    jornadasExigidas: string[];
    datos: { asistenteId: string; nombre: string; elegible: boolean; motivo: string | null }[];
  }> {
    const respuesta = await app.inject({
      method: 'GET',
      url: '/plantillas-certificado/elegibilidad',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(respuesta.statusCode).toBe(200);
    return respuesta.json();
  }

  async function generar(payload: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: '/plantillas-certificado/generar',
      headers: { authorization: `Bearer ${token}` },
      payload: { plantillaId, todos: true, soloElegibles: true, ...payload },
    });
  }

  // ------------------------------------------------------------- elegibilidad

  it('sin asistencias nadie es elegible y la generacion responde 409', async () => {
    const lista = await elegibilidad();
    expect(lista.elegibles).toBe(0);
    expect(lista.jornadasExigidas).toEqual(['Manana', 'Tarde']);

    const generacion = await generar({});
    expect(generacion.statusCode).toBe(409);
  });

  it('no es elegible quien solo tiene marcas de una jornada', async () => {
    // Asistente 1: ingreso y salida solo en manana.
    await registrarJornada(ID_ASISTENTE, idManana);
    // Asistente 2: ingreso y salida solo en tarde.
    await registrarJornada(ID_ASISTENTE_2, idTarde);

    const lista = await elegibilidad();
    expect(lista.elegibles).toBe(0);

    const uno = lista.datos.find((d) => d.asistenteId === ID_ASISTENTE)!;
    const dos = lista.datos.find((d) => d.asistenteId === ID_ASISTENTE_2)!;
    expect(uno.elegible).toBe(false);
    expect(uno.motivo).toContain('Tarde');
    expect(dos.elegible).toBe(false);
    expect(dos.motivo).toContain('Manana');
  });

  it('no es elegible quien tiene ingreso pero no salida en una jornada', async () => {
    await registrarJornada(ID_ASISTENTE, idManana, false);
    await registrarJornada(ID_ASISTENTE, idTarde, true);

    const lista = await elegibilidad();
    expect(lista.elegibles).toBe(0);
    const uno = lista.datos.find((d) => d.asistenteId === ID_ASISTENTE)!;
    expect(uno.elegible).toBe(false);
  });

  it('es elegible solo quien tiene ingreso y salida en las dos jornadas (4 marcas)', async () => {
    await registrarJornada(ID_ASISTENTE, idManana);
    await registrarJornada(ID_ASISTENTE, idTarde);
    // El asistente 2 queda incompleto a proposito.
    await registrarJornada(ID_ASISTENTE_2, idManana);

    const lista = await elegibilidad();
    expect(lista.elegibles).toBe(1);
    const uno = lista.datos.find((d) => d.asistenteId === ID_ASISTENTE)!;
    const dos = lista.datos.find((d) => d.asistenteId === ID_ASISTENTE_2)!;
    expect(uno.elegible).toBe(true);
    expect(uno.motivo).toBeNull();
    expect(dos.elegible).toBe(false);
  });

  it('el filtro por rol acota la elegibilidad (docente con 4 marcas)', async () => {
    for (const jornada of [idManana, idTarde]) {
      await registrarJornada(ID_ASISTENTE, jornada);
      await registrarJornada(ID_ASISTENTE_3, jornada);
    }

    const todos = await elegibilidad();
    expect(todos.elegibles).toBe(2);

    const soloDocentes = await app.inject({
      method: 'GET',
      url: '/plantillas-certificado/elegibilidad?rol=docente',
      headers: { authorization: `Bearer ${token}` },
    });
    const cuerpo = soloDocentes.json();
    expect(cuerpo.elegibles).toBe(1);
    expect(cuerpo.datos[0].asistenteId).toBe(ID_ASISTENTE_3);
  });

  // ------------------------------------------------------ generacion documento

  it('genera solo los elegibles y omite al resto', async () => {
    await registrarJornada(ID_ASISTENTE, idManana);
    await registrarJornada(ID_ASISTENTE, idTarde);
    await registrarJornada(ID_ASISTENTE_2, idManana);

    const respuesta = await generar({});
    expect(respuesta.statusCode).toBe(201);
    const cuerpo = respuesta.json();
    expect(cuerpo.resumen.generados).toBe(1);
    expect(cuerpo.resumen.omitidos).toBeGreaterThanOrEqual(1);
    expect(cuerpo.lote.generados).toBe(1);
  });

  it('el .docx generado contiene los datos del titular, no los marcadores', async () => {
    await registrarJornada(ID_ASISTENTE, idManana);
    await registrarJornada(ID_ASISTENTE, idTarde);

    const respuesta = await generar({});
    expect(respuesta.statusCode).toBe(201);

    const loteId = respuesta.json().lote.id as string;
    const descarga = await app.inject({
      method: 'GET',
      url: `/plantillas-certificado/lotes/${loteId}/descarga`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(descarga.statusCode).toBe(200);

    const zip = await JSZip.loadAsync(descarga.rawPayload);
    const nombreDocx = Object.keys(zip.files).find((n) => n.endsWith('.docx'))!;
    expect(nombreDocx).toBeDefined();

    const docxBuffer = await zip.file(nombreDocx)!.async('nodebuffer');
    // El .docx es en si un ZIP: se abre y se inspecciona el XML del documento.
    const docxZip = await JSZip.loadAsync(docxBuffer);
    const xml = await docxZip.file('word/document.xml')!.async('string');

    expect(xml).toContain('ANA PRUEBA INTEGRACION');
    expect(xml).toContain(ID_ASISTENTE);
    expect(xml).not.toContain('{{');
  });

  // ------------------------------------------------------------- compresion

  it('al comprimirse y descargarse, el ZIP contiene todos los .docx del lote', async () => {
    for (const jornada of [idManana, idTarde]) {
      await registrarJornada(ID_ASISTENTE, jornada);
      await registrarJornada(ID_ASISTENTE_3, jornada);
    }

    const respuesta = await generar({});
    expect(respuesta.statusCode).toBe(201);
    const { lote, resumen } = respuesta.json();
    expect(resumen.generados).toBe(2);

    const descarga = await app.inject({
      method: 'GET',
      url: `/plantillas-certificado/lotes/${lote.id}/descarga`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(descarga.statusCode).toBe(200);
    expect(descarga.headers['content-type']).toContain('application/zip');
    expect(descarga.headers['content-disposition']).toContain('.zip');

    const zip = await JSZip.loadAsync(descarga.rawPayload);
    const archivosDocx = Object.keys(zip.files).filter((n) => n.endsWith('.docx'));
    expect(archivosDocx).toHaveLength(2);
  });

  it('cada .docx descomprimido corresponde a un titular distinto', async () => {
    for (const jornada of [idManana, idTarde]) {
      await registrarJornada(ID_ASISTENTE, jornada);
      await registrarJornada(ID_ASISTENTE_3, jornada);
    }

    const respuesta = await generar({});
    const loteId = respuesta.json().lote.id as string;

    const descarga = await app.inject({
      method: 'GET',
      url: `/plantillas-certificado/lotes/${loteId}/descarga`,
      headers: { authorization: `Bearer ${token}` },
    });
    const zip = await JSZip.loadAsync(descarga.rawPayload);

    const contenidoDeXmls: string[] = [];
    for (const nombre of Object.keys(zip.files).filter((n) => n.endsWith('.docx'))) {
      const buffer = await zip.file(nombre)!.async('nodebuffer');
      const docxZip = await JSZip.loadAsync(buffer);
      contenidoDeXmls.push(await docxZip.file('word/document.xml')!.async('string'));
    }

    // Cada titular solo aparece en su propio documento.
    const contieneAna = contenidoDeXmls.filter((xml) => xml.includes(ID_ASISTENTE));
    const contieneSofia = contenidoDeXmls.filter((xml) => xml.includes(ID_ASISTENTE_3));
    expect(contieneAna).toHaveLength(1);
    expect(contieneSofia).toHaveLength(1);
  });

  // ------------------------------------------------------------- persistencia

  it('persiste el lote y lo expone en el listado y en el detalle', async () => {
    await registrarJornada(ID_ASISTENTE, idManana);
    await registrarJornada(ID_ASISTENTE, idTarde);

    const respuesta = await generar({});
    const loteId = respuesta.json().lote.id as string;

    const listado = await app.inject({
      method: 'GET',
      url: '/plantillas-certificado/lotes',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(listado.statusCode).toBe(200);
    const ids = (listado.json().datos as { id: string }[]).map((l) => l.id);
    expect(ids).toContain(loteId);

    const detalle = await app.inject({
      method: 'GET',
      url: `/plantillas-certificado/lotes/${loteId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(detalle.statusCode).toBe(200);
    expect(detalle.json().id).toBe(loteId);
  });

  it('elimina el lote y sus archivos', async () => {
    await registrarJornada(ID_ASISTENTE, idManana);
    await registrarJornada(ID_ASISTENTE, idTarde);

    const respuesta = await generar({});
    const loteId = respuesta.json().lote.id as string;

    const borrado = await app.inject({
      method: 'DELETE',
      url: `/plantillas-certificado/lotes/${loteId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(borrado.statusCode).toBe(200);

    const descarga = await app.inject({
      method: 'GET',
      url: `/plantillas-certificado/lotes/${loteId}/descarga`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(descarga.statusCode).toBe(404);
  });

  // ---------------------------------------------------- generacion individual

  it('descarga individual solo para un asistente elegible', async () => {
    await registrarJornada(ID_ASISTENTE, idManana);
    await registrarJornada(ID_ASISTENTE, idTarde);

    const respuesta = await app.inject({
      method: 'POST',
      url: `/plantillas-certificado/${plantillaId}/descarga-individual`,
      headers: { authorization: `Bearer ${token}` },
      payload: { asistenteId: ID_ASISTENTE },
    });
    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.headers['content-type']).toContain('wordprocessingml.document');

    const docxZip = await JSZip.loadAsync(respuesta.rawPayload);
    const xml = await docxZip.file('word/document.xml')!.async('string');
    expect(xml).toContain(ID_ASISTENTE);
  });

  it('rechaza la descarga individual de un asistente no elegible', async () => {
    await registrarJornada(ID_ASISTENTE_2, idManana);

    const respuesta = await app.inject({
      method: 'POST',
      url: `/plantillas-certificado/${plantillaId}/descarga-individual`,
      headers: { authorization: `Bearer ${token}` },
      payload: { asistenteId: ID_ASISTENTE_2 },
    });
    expect(respuesta.statusCode).toBe(409);
  });

  // ------------------------------------------------------------------ seguridad

  it('no expone el modulo a un usuario anonimo', async () => {
    const anonimo = await app.inject({
      method: 'GET',
      url: '/plantillas-certificado',
    });
    expect([401, 403]).toContain(anonimo.statusCode);

    const anonimoGenerar = await app.inject({
      method: 'POST',
      url: '/plantillas-certificado/generar',
      payload: { plantillaId, todos: true },
    });
    expect([401, 403]).toContain(anonimoGenerar.statusCode);
  });

  it('la elegibilidad y la generacion exigen autenticacion', async () => {
    const sinToken = await app.inject({
      method: 'GET',
      url: '/plantillas-certificado/elegibilidad',
    });
    expect([401, 403]).toContain(sinToken.statusCode);
  });

  // --------------------------------------------------------- invariante de BD

  it('las asistencias registradas respetan el UNIQUE por (asistente, jornada)', async () => {
    await registrarJornada(ID_ASISTENTE, idManana);
    // Un segundo ingreso en la misma jornada debe fallar por el constraint.
    await expect(registrarJornada(ID_ASISTENTE, idManana)).rejects.toThrow();

    const filas = await db
      .select()
      .from(asistencias)
      .where(eq(asistencias.asistenteId, ID_ASISTENTE));
    expect(filas).toHaveLength(1);
  });
});
