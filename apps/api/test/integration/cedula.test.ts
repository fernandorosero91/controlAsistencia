import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  CLAVE_ADMIN,
  CORREO_ADMIN,
  crearAplicacionDePruebas,
  hayBaseDePruebas,
  prepararBaseDePruebas,
} from '../ayudas/basePruebas.js';
import { db } from '../../src/db/cliente.js';
import { asistentes } from '../../src/db/esquema.js';

const descripcion = hayBaseDePruebas()
  ? 'cedula de ciudadania del asistente'
  : 'cedula de ciudadania del asistente (omitida: falta DATABASE_URL_TEST)';

function cuerpoMultipart(contenido: string): { payload: Buffer; contentType: string } {
  const limite = '----SeminarioPruebasCedula';
  const cabecera = Buffer.from(
    `--${limite}\r\n` +
      'Content-Disposition: form-data; name="archivo"; filename="asistentes.csv"\r\n' +
      'Content-Type: text/csv\r\n\r\n',
    'utf8',
  );
  const cierre = Buffer.from(`\r\n--${limite}--\r\n`, 'utf8');
  return {
    payload: Buffer.concat([cabecera, Buffer.from(contenido, 'utf8'), cierre]),
    contentType: `multipart/form-data; boundary=${limite}`,
  };
}

describe(descripcion, () => {
  let app: FastifyInstance;
  let token: string;

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
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  const cabeceras = () => ({ authorization: `Bearer ${token}` });

  it('crea un asistente con cedula de ciudadania', async () => {
    const respuesta = await app.inject({
      method: 'POST',
      url: '/asistentes',
      headers: cabeceras(),
      payload: {
        id: 'CED00001',
        nombres: 'Ana',
        apellidos: 'Prueba Cedula',
        rol: 'estudiante',
        semestre: 3,
        cedulaCiudadania: '1094867245',
        email: 'ana@pruebas.local',
        activo: true,
      },
    });

    expect(respuesta.statusCode).toBe(201);
    expect(respuesta.json().cedulaCiudadania).toBe('1094867245');

    const guardados = await db
      .select({ cedula: asistentes.cedulaCiudadania })
      .from(asistentes)
      .where(eq(asistentes.id, 'CED00001'));
    expect(guardados[0]?.cedula).toBe('1094867245');
  });

  it('no permite dos asistentes con la misma cedula', async () => {
    const respuesta = await app.inject({
      method: 'POST',
      url: '/asistentes',
      headers: cabeceras(),
      payload: {
        id: 'CED00002',
        nombres: 'Luis',
        apellidos: 'Prueba Cedula',
        rol: 'estudiante',
        semestre: 3,
        cedulaCiudadania: '1094867245',
        activo: true,
      },
    });

    expect(respuesta.statusCode).toBe(409);
    expect(respuesta.json().mensaje).toContain('cedula');
  });

  it('rechaza una cedula con formato invalido', async () => {
    const respuesta = await app.inject({
      method: 'POST',
      url: '/asistentes',
      headers: cabeceras(),
      payload: {
        id: 'CED00003',
        nombres: 'Maria',
        apellidos: 'Prueba Cedula',
        rol: 'estudiante',
        semestre: 3,
        cedulaCiudadania: '12',
        activo: true,
      },
    });

    expect(respuesta.statusCode).toBe(422);
  });

  it('el operador puede verificar a un asistente por su cedula', async () => {
    const respuesta = await app.inject({
      method: 'GET',
      url: '/asistentes/verificar?codigo=1094867245',
      headers: cabeceras(),
    });

    expect(respuesta.statusCode).toBe(200);
    const cuerpo = respuesta.json();
    expect(cuerpo.encontrado).toBe(true);
    expect(cuerpo.asistente.id).toBe('CED00001');
    expect(cuerpo.asistente.cedulaCiudadania).toBe('1094867245');
  });

  it('importa un archivo con la columna cedula', async () => {
    const csv = [
      'id,nombres,apellidos,rol,semestre,cedula,email',
      'CED10001,Ana,Importada,estudiante,3,80123456,ana@importada.local',
      'CED10002,Luis,Importado,estudiante,4,80999999,luis@importada.local',
    ].join('\n');
    const { payload, contentType } = cuerpoMultipart(csv);

    const previa = await app.inject({
      method: 'POST',
      url: '/asistentes/importar/previa',
      headers: { ...cabeceras(), 'content-type': contentType },
      payload,
    });
    expect(previa.statusCode).toBe(200);
    expect(previa.json().filasValidas).toBe(2);
    expect(previa.json().filas[0].datos.cedulaCiudadania).toBe('80123456');

    const filas = previa
      .json()
      .filas.map((fila: { fila: number; datos: Record<string, unknown> }) => ({
        fila: fila.fila,
        id: fila.datos.id,
        nombres: fila.datos.nombres,
        apellidos: fila.datos.apellidos,
        rol: fila.datos.rol,
        semestre: fila.datos.semestre,
        cedulaCiudadania: fila.datos.cedulaCiudadania,
        email: fila.datos.email,
      }));

    const confirmar = await app.inject({
      method: 'POST',
      url: '/asistentes/importar/confirmar',
      headers: cabeceras(),
      payload: { filas, modo: 'crear_actualizar' },
    });
    expect(confirmar.statusCode).toBe(200);
    expect(confirmar.json().creados).toBe(2);

    const guardado = await db
      .select({ cedula: asistentes.cedulaCiudadania })
      .from(asistentes)
      .where(eq(asistentes.id, 'CED10001'));
    expect(guardado[0]?.cedula).toBe('80123456');
  });

  it('marca como error la fila con una cedula repetida en el archivo', async () => {
    const csv = [
      'id,nombres,apellidos,rol,semestre,cedula',
      'CED20001,Ana,Repetida,estudiante,3,70707070',
      'CED20002,Luis,Repetida,estudiante,4,70707070',
    ].join('\n');
    const { payload, contentType } = cuerpoMultipart(csv);

    const previa = await app.inject({
      method: 'POST',
      url: '/asistentes/importar/previa',
      headers: { ...cabeceras(), 'content-type': contentType },
      payload,
    });

    const cuerpo = previa.json();
    expect(cuerpo.filasValidas).toBe(0);
    expect(cuerpo.filasConError).toBe(2);
    expect(cuerpo.filas[0].errores[0].campo).toBe('cedula');
  });

  it('marca como error la fila con una cedula que ya esta en el padron', async () => {
    const csv = [
      'id,nombres,apellidos,rol,semestre,cedula',
      'CED30001,Ana,Ya existe,estudiante,3,1094867245',
    ].join('\n');
    const { payload, contentType } = cuerpoMultipart(csv);

    const previa = await app.inject({
      method: 'POST',
      url: '/asistentes/importar/previa',
      headers: { ...cabeceras(), 'content-type': contentType },
      payload,
    });

    const cuerpo = previa.json();
    expect(cuerpo.filasValidas).toBe(0);
    expect(cuerpo.filas[0].errores[0].mensaje).toContain('padron');
  });
});
