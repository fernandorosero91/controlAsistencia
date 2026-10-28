import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { db } from '../../src/db/cliente.js';
import { asistencias, jornadas } from '../../src/db/esquema.js';
import { invalidarResumen } from '../../src/servicios/dashboard.js';
import {
  CLAVE_ADMIN,
  CORREO_ADMIN,
  crearAplicacionDePruebas,
  hayBaseDePruebas,
  ID_ASISTENTE,
  ID_ASISTENTE_2,
  ID_ASISTENTE_3,
  prepararBaseDePruebas,
} from '../ayudas/basePruebas.js';

const descripcion = hayBaseDePruebas()
  ? 'reporte consolidado y estado del dashboard'
  : 'reporte consolidado y estado del dashboard (omitida: falta DATABASE_URL_TEST)';

/**
 * Datos de la prueba:
 *  - ID_ASISTENTE:   ingreso y salida en las dos jornadas (4 horas cada una).
 *  - ID_ASISTENTE_2: ingreso en las dos jornadas, sin salida.
 *  - ID_ASISTENTE_3: ingreso solo en la primera jornada.
 *
 * El consolidado debe incluir a los dos primeros y dejar fuera al tercero.
 * El dashboard debe contar personas distintas de la jornada en curso, no filas.
 */
describe(descripcion, () => {
  let app: FastifyInstance;
  let token: string;
  let idPrimera: number;
  let nombrePrimera: string;
  let idSegunda: number;

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

    const lista = await db.select().from(jornadas).orderBy(asc(jornadas.orden));
    const primera = lista[0]!;
    const segunda = lista[1]!;
    idPrimera = primera.id;
    nombrePrimera = primera.nombre;
    idSegunda = segunda.id;

    // Solo la primera jornada esta en curso, para que el dashboard no dependa
    // de cual de las dos se elige cuando se solapan.
    const ahora = new Date();
    await db
      .update(jornadas)
      .set({
        inicio: new Date(ahora.getTime() - 2 * 3_600_000),
        fin: new Date(ahora.getTime() + 2 * 3_600_000),
      })
      .where(eq(jornadas.id, idPrimera));
    await db
      .update(jornadas)
      .set({
        inicio: new Date(ahora.getTime() + 3 * 3_600_000),
        fin: new Date(ahora.getTime() + 5 * 3_600_000),
      })
      .where(eq(jornadas.id, idSegunda));

    const hace5h = new Date(ahora.getTime() - 5 * 3_600_000);
    const hace1h = new Date(ahora.getTime() - 3_600_000);
    await db.insert(asistencias).values([
      // Completa: cuatro marcas y 4 horas por jornada.
      { asistenteId: ID_ASISTENTE, jornadaId: idPrimera, horaIngreso: hace5h, horaSalida: hace1h },
      { asistenteId: ID_ASISTENTE, jornadaId: idSegunda, horaIngreso: hace5h, horaSalida: hace1h },
      // Ingreso en ambas, sin salida.
      { asistenteId: ID_ASISTENTE_2, jornadaId: idPrimera, horaIngreso: hace5h },
      { asistenteId: ID_ASISTENTE_2, jornadaId: idSegunda, horaIngreso: hace5h },
      // Solo primera jornada.
      { asistenteId: ID_ASISTENTE_3, jornadaId: idPrimera, horaIngreso: hace5h },
    ]);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  const cabeceras = () => ({ authorization: `Bearer ${token}` });

  function filaDe(csv: string, id: string): string[] | null {
    const linea = csv
      .split(/\r?\n/)
      .find((texto) => texto.trimStart().startsWith(`${id};`));
    return linea ? linea.split(';') : null;
  }

  it('lista solo a quienes ingresaron a las dos jornadas', async () => {
    const respuesta = await app.inject({
      method: 'GET',
      url: '/reportes/asistencia-consolidada?formato=csv',
      headers: cabeceras(),
    });

    expect(respuesta.statusCode).toBe(200);
    const csv = respuesta.body;
    expect(csv).toContain(`${nombrePrimera} ingreso`);
    expect(csv).toContain('Cuatro marcas');
    expect(csv).toContain('Elegible');

    expect(csv).toContain(ID_ASISTENTE);
    expect(csv).toContain(ID_ASISTENTE_2);
    expect(csv).not.toContain(ID_ASISTENTE_3);
  });

  it('muestra horas, cuatro marcas y elegibilidad de cada persona', async () => {
    const respuesta = await app.inject({
      method: 'GET',
      url: '/reportes/asistencia-consolidada?formato=csv',
      headers: cabeceras(),
    });

    const columnas = respuesta.body.split(/\r?\n/)[0]!.split(';');
    const indiceCuatroMarcas = columnas.indexOf('Cuatro marcas');
    const indiceElegible = columnas.indexOf('Elegible');
    const indiceHorasPrimera = columnas.indexOf(`Horas ${nombrePrimera}`);
    const indiceRefrigerios = columnas.indexOf('Refrigerios');
    const indiceSouvenir = columnas.indexOf('Souvenir');

    const completa = filaDe(respuesta.body, ID_ASISTENTE)!;
    expect(completa[indiceCuatroMarcas]).toBe('Si');
    expect(completa[indiceElegible]).toBe('Si');
    expect(completa[indiceHorasPrimera]).toBe('4.0');
    expect(completa[indiceRefrigerios]).toBe('0');
    expect(completa[indiceSouvenir]).toBe('No');

    const sinSalida = filaDe(respuesta.body, ID_ASISTENTE_2)!;
    expect(sinSalida[indiceCuatroMarcas]).toBe('No');
    expect(sinSalida[indiceElegible]).toBe('No');
  });

  it('exporta el consolidado en Excel y PDF', async () => {
    for (const formato of ['xlsx', 'pdf']) {
      const respuesta = await app.inject({
        method: 'GET',
        url: `/reportes/asistencia-consolidada?formato=${formato}`,
        headers: cabeceras(),
      });
      expect(respuesta.statusCode, formato).toBe(200);
      expect(respuesta.rawPayload.byteLength, formato).toBeGreaterThan(1000);
    }
  });

  it('el dashboard cuenta personas distintas de la jornada en curso', async () => {
    const respuesta = await app.inject({
      method: 'GET',
      url: '/dashboard/resumen',
      headers: cabeceras(),
    });

    expect(respuesta.statusCode).toBe(200);
    const datos = respuesta.json();
    expect(datos.jornadaActivaNombre).toBe(nombrePrimera);
    // En la primera jornada siguen abiertas ID_2 e ID_3: dos personas.
    expect(datos.dentroAhora).toBe(2);
    // Con al menos una salida: solo ID_1 (aunque tiene dos filas con salida).
    expect(datos.fueraAhora).toBe(1);
  });

  it('al cerrar el evento el dashboard deja de mostrar personas adentro', async () => {
    const ahora = new Date();
    await db
      .update(jornadas)
      .set({
        inicio: new Date(ahora.getTime() - 10 * 3_600_000),
        fin: new Date(ahora.getTime() - 8 * 3_600_000),
      })
      .where(eq(jornadas.id, idPrimera));
    await db
      .update(jornadas)
      .set({
        inicio: new Date(ahora.getTime() - 6 * 3_600_000),
        fin: new Date(ahora.getTime() - 4 * 3_600_000),
      })
      .where(eq(jornadas.id, idSegunda));
    await invalidarResumen();

    const respuesta = await app.inject({
      method: 'GET',
      url: '/dashboard/resumen',
      headers: cabeceras(),
    });

    const datos = respuesta.json();
    expect(datos.jornadaActivaNombre).toBeNull();
    expect(datos.dentroAhora).toBe(0);
    expect(datos.fueraAhora).toBe(1);
  });
});
