import { eq, sql } from 'drizzle-orm';
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
  ? 'importacion de asistentes'
  : 'importacion de asistentes (omitida: falta DATABASE_URL_TEST)';

/** Arma un cuerpo multipart/form-data sin dependencias externas. */
function cuerpoMultipart(
  contenido: string,
  nombreArchivo = 'asistentes.csv',
  tipo = 'text/csv',
): { payload: Buffer; contentType: string } {
  const limite = '----SeminarioPruebasImportacion';
  const cabecera = Buffer.from(
    `--${limite}\r\n` +
      `Content-Disposition: form-data; name="archivo"; filename="${nombreArchivo}"\r\n` +
      `Content-Type: ${tipo}\r\n\r\n`,
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

  it('devuelve la vista previa de un CSV con semestre opcional', async () => {
    const csv = [
      'id,nombres,apellidos,rol,semestre,email',
      'IMP00001,Ana,Prueba Importacion,estudiante,3,ana@pruebas.local',
      'IMP00002,Luis,Prueba Importacion,docente,,luis@pruebas.local',
      'IMP00003,Maria,Sin Semestre,estudiante,,maria@pruebas.local',
    ].join('\n');
    const { payload, contentType } = cuerpoMultipart(csv);

    const respuesta = await app.inject({
      method: 'POST',
      url: '/asistentes/importar/previa',
      headers: { authorization: `Bearer ${token}`, 'content-type': contentType },
      payload,
    });

    expect(respuesta.statusCode).toBe(200);
    const cuerpo = respuesta.json();
    expect(cuerpo.totalFilas).toBe(3);
    expect(cuerpo.filasValidas).toBe(3);
    expect(cuerpo.filasConError).toBe(0);
    expect(cuerpo.nuevos).toBe(3);
    // La vista previa devuelve TODAS las filas: el panel necesita el archivo
    // completo para confirmar la importacion.
    expect(cuerpo.filas).toHaveLength(3);
    expect(cuerpo.filas[2].errores).toHaveLength(0);
  });

  it('importa las 600 filas de un padron completo, no solo una muestra', async () => {
    const total = 600;
    const encabezados = 'id,nombres,apellidos,rol,semestre,email';
    const lineas: string[] = [];
    const filas: {
      fila: number;
      id: string;
      nombres: string;
      apellidos: string;
      rol: string;
      semestre: number | null;
      email: string;
    }[] = [];
    for (let indice = 1; indice <= total; indice += 1) {
      const id = `LOTE${String(indice).padStart(4, '0')}`;
      const esDocente = indice % 20 === 0;
      lineas.push(
        `${id},Persona ${indice},Apellido Prueba,${esDocente ? 'docente' : 'estudiante'},${
          esDocente ? '' : (indice % 9) + 1
        },persona${indice}@pruebas.local`,
      );
      filas.push({
        fila: indice + 1,
        id,
        nombres: `Persona ${indice}`,
        apellidos: 'Apellido Prueba',
        rol: esDocente ? 'docente' : 'estudiante',
        semestre: esDocente ? null : (indice % 9) + 1,
        email: `persona${indice}@pruebas.local`,
      });
    }
    const csv = [encabezados, ...lineas].join('\n');
    const { payload, contentType } = cuerpoMultipart(csv);

    const previa = await app.inject({
      method: 'POST',
      url: '/asistentes/importar/previa',
      headers: { authorization: `Bearer ${token}`, 'content-type': contentType },
      payload,
    });
    expect(previa.statusCode).toBe(200);
    expect(previa.json().filas).toHaveLength(total);
    expect(previa.json().filasValidas).toBe(total);

    const confirmar = await app.inject({
      method: 'POST',
      url: '/asistentes/importar/confirmar',
      headers: { authorization: `Bearer ${token}` },
      payload: { filas, modo: 'crear_actualizar' },
    });
    expect(confirmar.statusCode).toBe(200);
    expect(confirmar.json().creados).toBe(total);

    const guardados = await db
      .select({ id: asistentes.id })
      .from(asistentes)
      .where(sql`${asistentes.id} LIKE 'LOTE%'`);
    expect(guardados).toHaveLength(total);
  });

  it('importa las filas validas y las guarda en la base de datos', async () => {
    const filas = [
      {
        fila: 2,
        id: 'IMP00001',
        nombres: 'Ana',
        apellidos: 'Prueba Importacion',
        rol: 'estudiante',
        semestre: 3,
        email: 'ana@pruebas.local',
      },
      {
        fila: 3,
        id: 'IMP00002',
        nombres: 'Luis',
        apellidos: 'Prueba Importacion',
        rol: 'docente',
        semestre: null,
        email: 'luis@pruebas.local',
      },
    ];

    const respuesta = await app.inject({
      method: 'POST',
      url: '/asistentes/importar/confirmar',
      headers: { authorization: `Bearer ${token}` },
      payload: { filas, modo: 'crear_actualizar' },
    });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json().creados).toBe(2);

    const guardados = await db
      .select({ id: asistentes.id })
      .from(asistentes)
      .where(eq(asistentes.id, 'IMP00001'));
    expect(guardados).toHaveLength(1);
  });

  it('rechaza una fila invalida al confirmar la importacion', async () => {
    const respuesta = await app.inject({
      method: 'POST',
      url: '/asistentes/importar/confirmar',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        filas: [
          {
            fila: 2,
            id: 'x',
            nombres: 'Pedro',
            apellidos: 'Prueba Importacion',
            rol: 'estudiante',
            semestre: null,
          },
        ],
      },
    });

    expect(respuesta.statusCode).toBe(422);
  });

  it('genera el reporte de asistencia parcial sin errores', async () => {
    const respuesta = await app.inject({
      method: 'GET',
      url: '/reportes/asistencia-parcial?formato=csv',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.body).toContain('ID institucional');
  });

  it('actualiza una jornada y un tipo de refrigerio', async () => {
    const jornadas = await app.inject({
      method: 'GET',
      url: '/jornadas',
      headers: { authorization: `Bearer ${token}` },
    });
    const jornada = jornadas.json().jornadas[0];

    const editarJornada = await app.inject({
      method: 'PATCH',
      url: `/jornadas/${jornada.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { nombre: 'Manana editada', orden: 1 },
    });
    expect(editarJornada.statusCode).toBe(200);
    expect(editarJornada.json().nombre).toBe('Manana editada');

    const tipos = await app.inject({
      method: 'GET',
      url: '/refrigerios/tipos',
      headers: { authorization: `Bearer ${token}` },
    });
    const tipo = tipos.json().tipos[0];

    const editarRefrigerio = await app.inject({
      method: 'PATCH',
      url: `/refrigerios/tipos/${tipo.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { activo: false },
    });
    expect(editarRefrigerio.statusCode).toBe(200);
    expect(editarRefrigerio.json().activo).toBe(false);
  });
});
