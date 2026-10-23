import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  CLAVE_ADMIN,
  CORREO_ADMIN,
  ID_ASISTENTE,
  crearAplicacionDePruebas,
  hayBaseDePruebas,
  prepararBaseDePruebas,
} from '../ayudas/basePruebas.js';
import { db } from '../../src/db/cliente.js';
import { asistencias, tiposRefrigerio } from '../../src/db/esquema.js';

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

  it('elimina una jornada sin datos ligados', async () => {
    const lista = await jornadas();
    const base = lista[0]!;
    const creada = await app.inject({
      method: 'POST',
      url: '/jornadas',
      headers: cabeceras(),
      payload: {
        nombre: 'Jornada temporal',
        inicio: base.inicio,
        fin: base.fin,
        ventanaCheckinInicio: base.ventanaCheckinInicio,
        ventanaCheckinFin: base.ventanaCheckinFin,
        orden: 9,
      },
    });
    expect(creada.statusCode).toBe(201);
    const id = creada.json().id as number;

    const borrada = await app.inject({
      method: 'DELETE',
      url: `/jornadas/${id}`,
      headers: cabeceras(),
    });
    expect(borrada.statusCode).toBe(200);
    expect(borrada.json().eliminada).toBe(true);

    const restantes = await jornadas();
    expect(restantes.some((j) => j.id === id)).toBe(false);
  });

  it('rechaza eliminar una jornada con asistencias salvo que se fuerce', async () => {
    const lista = await jornadas();
    const base = lista[0]!;

    // Se liga una asistencia a la ultima jornada creada para el escenario.
    const creada = await app.inject({
      method: 'POST',
      url: '/jornadas',
      headers: cabeceras(),
      payload: {
        nombre: 'Jornada con asistencias',
        inicio: base.inicio,
        fin: base.fin,
        ventanaCheckinInicio: base.ventanaCheckinInicio,
        ventanaCheckinFin: base.ventanaCheckinFin,
        orden: 8,
      },
    });
    const id = creada.json().id as number;

    await db.insert(asistencias).values({
      asistenteId: ID_ASISTENTE,
      jornadaId: id,
      horaIngreso: new Date(Date.now() - 60 * 60 * 1000),
    });

    const sinForzar = await app.inject({
      method: 'DELETE',
      url: `/jornadas/${id}`,
      headers: cabeceras(),
    });
    expect(sinForzar.statusCode).toBe(409);

    const forzada = await app.inject({
      method: 'DELETE',
      url: `/jornadas/${id}?forzar=true`,
      headers: cabeceras(),
    });
    expect(forzada.statusCode).toBe(200);
    expect(forzada.json().asistenciasEliminadas).toBe(1);

    const restantes = await jornadas();
    expect(restantes.some((j) => j.id === id)).toBe(false);
  });

  it('responde 404 al eliminar una jornada inexistente', async () => {
    const respuesta = await app.inject({
      method: 'DELETE',
      url: '/jornadas/999999',
      headers: cabeceras(),
    });
    expect(respuesta.statusCode).toBe(404);
  });

  it('cascada forzada elimina tambien los tipos de refrigerio ligados', async () => {
    const lista = await jornadas();
    const base = lista[0]!;
    const creada = await app.inject({
      method: 'POST',
      url: '/jornadas',
      headers: cabeceras(),
      payload: {
        nombre: 'Jornada con refrigerios',
        inicio: base.inicio,
        fin: base.fin,
        ventanaCheckinInicio: base.ventanaCheckinInicio,
        ventanaCheckinFin: base.ventanaCheckinFin,
        orden: 7,
      },
    });
    const id = creada.json().id as number;

    await db.insert(tiposRefrigerio).values({
      nombre: 'Refrigerio ligado',
      jornadaId: id,
      activo: true,
      orden: 1,
    });

    const forzada = await app.inject({
      method: 'DELETE',
      url: `/jornadas/${id}?forzar=true`,
      headers: cabeceras(),
    });
    expect(forzada.statusCode).toBe(200);

    const refrigeriosRestantes = await db
      .select()
      .from(tiposRefrigerio)
      .where(eq(tiposRefrigerio.jornadaId, id));
    expect(refrigeriosRestantes).toHaveLength(0);
  });
});
