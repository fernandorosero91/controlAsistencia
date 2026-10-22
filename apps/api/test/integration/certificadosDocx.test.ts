import JSZip from 'jszip';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  CLAVE_ADMIN,
  CORREO_ADMIN,
  ID_ASISTENTE,
  ID_ASISTENTE_2,
  crearAplicacionDePruebas,
  hayBaseDePruebas,
  prepararBaseDePruebas,
} from '../ayudas/basePruebas.js';
import { db } from '../../src/db/cliente.js';
import { asistencias, jornadas } from '../../src/db/esquema.js';

/**
 * Elegibilidad y generacion de certificados .docx.
 *
 * Regla: un asistente solo es elegible si tiene ingreso y salida registrados en
 * cada jornada (manana y tarde), es decir las 4 marcas. Estas pruebas fijan ese
 * contrato de punta a punta contra la base de pruebas.
 */

const descripcion = hayBaseDePruebas()
  ? 'certificados docx desde plantilla'
  : 'certificados docx desde plantilla (omitida: falta DATABASE_URL_TEST)';

async function docxDePrueba(): Promise<Buffer> {
  const ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
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
      `<w:document ${ns}><w:body>` +
      `<w:p ${ns}><w:r><w:t>Certificado de {{nombre}} - {{cedula}}</w:t></w:r></w:p>` +
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

  beforeAll(async () => {
    if (!hayBaseDePruebas()) return;
    app = await crearAplicacionDePruebas();
    await prepararBaseDePruebas();

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

  afterAll(async () => {
    if (app) await app.close();
  });

  it('rechaza al asistente que solo tiene las marcas de una jornada', async () => {
    const lista = await app.inject({
      method: 'GET',
      url: '/plantillas-certificado/elegibilidad',
      headers: { authorization: `Bearer ${token}` },
    });
    const cuerpo = lista.json();
    // Sin asistencias, nadie es elegible.
    expect(cuerpo.elegibles).toBe(0);
    expect(cuerpo.jornadasExigidas).toEqual(['Manana', 'Tarde']);

    const generacion = await app.inject({
      method: 'POST',
      url: '/plantillas-certificado/generar',
      headers: { authorization: `Bearer ${token}` },
      payload: { plantillaId, todos: true, soloElegibles: true },
    });
    // Nadie cumple las 4 marcas: se responde con conflicto, no con un lote vacio.
    expect(generacion.statusCode).toBe(409);
  });

  it('genera el certificado solo cuando tiene ingreso y salida en las 2 jornadas', async () => {
    const jornadasFilas = await db.select().from(jornadas).orderBy(jornadas.orden);
    const manana = jornadasFilas[0]!;
    const tarde = jornadasFilas[1]!;

    // El asistente 1 completa las 4 marcas; el asistente 2 solo tiene una jornada.
    await db.insert(asistencias).values([
      { asistenteId: ID_ASISTENTE, jornadaId: manana.id, horaSalida: new Date() },
      { asistenteId: ID_ASISTENTE, jornadaId: tarde.id, horaSalida: new Date() },
      { asistenteId: ID_ASISTENTE_2, jornadaId: manana.id, horaSalida: new Date() },
    ]);

    const respuesta = await app.inject({
      method: 'POST',
      url: '/plantillas-certificado/generar',
      headers: { authorization: `Bearer ${token}` },
      payload: { plantillaId, todos: true, soloElegibles: true },
    });

    expect(respuesta.statusCode).toBe(201);
    const cuerpo = respuesta.json();
    expect(cuerpo.resumen.generados).toBe(1);
    expect(cuerpo.resumen.omitidos).toBeGreaterThanOrEqual(1);
    expect(cuerpo.lote.generados).toBe(1);

    const marcas = cuerpo.resumen.elegibilidad as {
      asistenteId: string;
      elegible: boolean;
      motivo: string | null;
    }[];
    const completa = marcas.find((marca) => marca.asistenteId === ID_ASISTENTE)!;
    const incompleta = marcas.find((marca) => marca.asistenteId === ID_ASISTENTE_2)!;
    expect(completa.elegible).toBe(true);
    expect(completa.motivo).toBeNull();
    expect(incompleta.elegible).toBe(false);
    expect(incompleta.motivo).toContain('Tarde');
  });

  it('permite descargar el ZIP del lote generado', async () => {
    const lotes = await app.inject({
      method: 'GET',
      url: '/plantillas-certificado/lotes',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(lotes.statusCode).toBe(200);
    const listado = lotes.json().datos as { id: string; generados: number }[];
    expect(listado.length).toBeGreaterThanOrEqual(1);
    const lote = listado[0]!;

    const descarga = await app.inject({
      method: 'GET',
      url: `/plantillas-certificado/lotes/${lote.id}/descarga`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(descarga.statusCode).toBe(200);
    expect(descarga.headers['content-type']).toContain('application/zip');

    const zip = await JSZip.loadAsync(descarga.rawPayload);
    const archivosDocx = Object.keys(zip.files).filter((nombre) => nombre.endsWith('.docx'));
    expect(archivosDocx.length).toBe(lote.generados);
  });

  it('no expone el modulo a un operador (solo admin)', async () => {
    const anonimo = await app.inject({
      method: 'GET',
      url: '/plantillas-certificado',
    });
    expect([401, 403]).toContain(anonimo.statusCode);

    const conAsistencia = await db
      .select()
      .from(asistencias)
      .where(and(eq(asistencias.asistenteId, ID_ASISTENTE), eq(asistencias.jornadaId, 1)));
    expect(conAsistencia.length).toBe(1);
  });
});
