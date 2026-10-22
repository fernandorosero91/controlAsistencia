import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  CLAVE_ADMIN,
  CORREO_ADMIN,
  crearAplicacionDePruebas,
  hayBaseDePruebas,
  prepararBaseDePruebas,
} from '../ayudas/basePruebas.js';

const descripcion = hayBaseDePruebas()
  ? 'coherencia de los horarios de una jornada'
  : 'coherencia de los horarios de una jornada (omitida: falta DATABASE_URL_TEST)';

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

  async function jornadas() {
    const respuesta = await app.inject({
      method: 'GET',
      url: '/jornadas',
      headers: cabeceras(),
    });
    return respuesta.json().jornadas as {
      id: number;
      nombre: string;
      inicio: string;
      fin: string;
      ventanaCheckinInicio: string;
      ventanaCheckinFin: string;
      orden: number;
    }[];
  }

  it('rechaza con un mensaje claro cuando el cierre no es posterior a la apertura', async () => {
    const lista = await jornadas();
    const jornada = lista[0]!;

    const respuesta = await app.inject({
      method: 'PATCH',
      url: `/jornadas/${jornada.id}`,
      headers: cabeceras(),
      payload: {
        nombre: jornada.nombre,
        inicio: jornada.inicio,
        fin: jornada.fin,
        ventanaCheckinInicio: jornada.ventanaCheckinInicio,
        ventanaCheckinFin: jornada.ventanaCheckinInicio,
        orden: jornada.orden,
      },
    });

    // Antes de este cambio la base de datos rechazaba la fila y la API
    // respondia 500 sin explicacion.
    expect(respuesta.statusCode).toBe(422);
    expect(respuesta.json().codigo).toBe('VALIDACION');
    expect(respuesta.json().mensaje).toContain('cierre del registro');
  });

  it('rechaza cuando la hora de fin no es posterior a la de inicio', async () => {
    const lista = await jornadas();
    const jornada = lista[0]!;

    const respuesta = await app.inject({
      method: 'PATCH',
      url: `/jornadas/${jornada.id}`,
      headers: cabeceras(),
      payload: {
        nombre: jornada.nombre,
        inicio: jornada.inicio,
        fin: jornada.inicio,
        ventanaCheckinInicio: jornada.ventanaCheckinInicio,
        ventanaCheckinFin: jornada.ventanaCheckinFin,
        orden: jornada.orden,
      },
    });

    expect(respuesta.statusCode).toBe(422);
    expect(respuesta.json().mensaje).toContain('fin de la jornada');
  });

  it('valida la coherencia tambien al crear una jornada', async () => {
    const lista = await jornadas();
    const jornada = lista[0]!;

    const respuesta = await app.inject({
      method: 'POST',
      url: '/jornadas',
      headers: cabeceras(),
      payload: {
        nombre: 'Jornada incoherente',
        inicio: jornada.inicio,
        fin: jornada.fin,
        ventanaCheckinInicio: jornada.ventanaCheckinFin,
        ventanaCheckinFin: jornada.ventanaCheckinFin,
        orden: 9,
      },
    });

    expect(respuesta.statusCode).toBe(422);
  });

  it('acepta una jornada coherente y la guarda', async () => {
    const lista = await jornadas();
    const jornada = lista[0]!;

    const respuesta = await app.inject({
      method: 'PATCH',
      url: `/jornadas/${jornada.id}`,
      headers: cabeceras(),
      payload: {
        nombre: `${jornada.nombre} editada`,
        inicio: jornada.inicio,
        fin: jornada.fin,
        ventanaCheckinInicio: jornada.ventanaCheckinInicio,
        ventanaCheckinFin: jornada.ventanaCheckinFin,
        orden: jornada.orden,
      },
    });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json().nombre).toBe(`${jornada.nombre} editada`);

    // Se devuelve el nombre original para no dejar el padron de pruebas alterado.
    await app.inject({
      method: 'PATCH',
      url: `/jornadas/${jornada.id}`,
      headers: cabeceras(),
      payload: { nombre: jornada.nombre },
    });
  });
});
