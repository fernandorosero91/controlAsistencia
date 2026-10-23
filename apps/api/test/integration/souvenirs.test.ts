import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { db } from '../../src/db/cliente.js';
import { tiposSouvenir } from '../../src/db/esquema.js';
import {
  CLAVE_ADMIN,
  CORREO_ADMIN,
  crearAplicacionDePruebas,
  hayBaseDePruebas,
  ID_ASISTENTE,
  ID_ASISTENTE_2,
  prepararBaseDePruebas,
} from '../ayudas/basePruebas.js';

const descripcion = hayBaseDePruebas()
  ? 'control de entrega de souvenirs'
  : 'control de entrega de souvenirs (omitida: falta DATABASE_URL_TEST)';

/**
 * El souvenir es del evento, no de una jornada: una entrega por asistente y
 * tipo, solo para quien tenga asistencia, y con el modulo que el administrador
 * activa desde Configuracion.
 */
describe(descripcion, () => {
  let app: FastifyInstance;
  let token: string;
  let tipoId: number;
  let jornadaId: number;

  beforeAll(async () => {
    if (!hayBaseDePruebas()) return;
    app = await crearAplicacionDePruebas();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(async () => {
    if (!hayBaseDePruebas()) return;
    await prepararBaseDePruebas();

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: CORREO_ADMIN, password: CLAVE_ADMIN },
    });
    token = login.json().tokenAcceso as string;

    const [tipo] = await db.select().from(tiposSouvenir).limit(1);
    tipoId = tipo!.id;

    const contexto = await app.inject({
      method: 'GET',
      url: '/operador/contexto',
      headers: { authorization: `Bearer ${token}` },
    });
    jornadaId = contexto.json().jornadaActiva.id as number;
  });

  const cabeceras = () => ({ authorization: `Bearer ${token}` });

  const habilitar = (datos: Record<string, unknown>) =>
    app.inject({
      method: 'PATCH',
      url: '/config/operador',
      headers: cabeceras(),
      payload: datos,
    });

  const entregar = (asistenteId: string, tipo = tipoId) =>
    app.inject({
      method: 'POST',
      url: '/souvenirs/entregar',
      headers: cabeceras(),
      payload: { asistenteId, tipoSouvenirId: tipo },
    });

  async function registrarIngreso(asistenteId: string) {
    await app.inject({
      method: 'POST',
      url: '/asistencias/ingreso',
      headers: cabeceras(),
      payload: { asistenteId, jornadaId },
    });
  }

  it('viene apagado hasta que el administrador lo active', async () => {
    await registrarIngreso(ID_ASISTENTE);

    const respuesta = await entregar(ID_ASISTENTE);
    expect(respuesta.statusCode).toBe(403);
    expect(respuesta.json().mensaje).toContain('souvenir');
  });

  it('al activarlo aparece en el contexto del operador con su tipo', async () => {
    await habilitar({ operadorSouvenirHabilitado: true });

    const contexto = await app.inject({
      method: 'GET',
      url: '/operador/contexto',
      headers: cabeceras(),
    });
    const datos = contexto.json();

    expect(datos.modulos.souvenir).toBe(true);
    expect(datos.souvenirs.length).toBeGreaterThan(0);
    expect(datos.souvenirActivo.id).toBe(tipoId);
  });

  it('no entrega el souvenir a quien no tiene asistencia', async () => {
    await habilitar({ operadorSouvenirHabilitado: true });

    const respuesta = await entregar(ID_ASISTENTE_2);
    expect(respuesta.json().resultado).toBe('no_permitido');
    expect(respuesta.json().mensaje).toContain('asistencia');
  });

  it('entrega el souvenir y no permite una segunda entrega, aunque sea otro operador', async () => {
    await habilitar({ operadorSouvenirHabilitado: true });
    await registrarIngreso(ID_ASISTENTE);

    const primera = await entregar(ID_ASISTENTE);
    expect(primera.json().resultado).toBe('exito');
    expect(primera.json().existente.tipoSouvenirNombre).toBe('Souvenir de pruebas');

    const segunda = await entregar(ID_ASISTENTE);
    expect(segunda.statusCode).toBe(200);
    expect(segunda.json().resultado).toBe('duplicado');
    expect(segunda.json().existente.entregadoPor).toBe('Administrador de pruebas');
  });

  it('el estado del asistente muestra si ya recibio el souvenir', async () => {
    await habilitar({ operadorSouvenirHabilitado: true });
    await registrarIngreso(ID_ASISTENTE);
    await entregar(ID_ASISTENTE);

    const estado = await app.inject({
      method: 'GET',
      url: `/souvenirs/estado/${ID_ASISTENTE}`,
      headers: cabeceras(),
    });

    expect(estado.json().entregas).toHaveLength(1);
    expect(estado.json().tiposDisponibles[0].entregado).toBe(true);
  });

  it('el administrador gestiona los tipos de souvenir', async () => {
    const creado = await app.inject({
      method: 'POST',
      url: '/souvenirs/tipos',
      headers: cabeceras(),
      payload: { nombre: 'Camiseta del seminario', activo: true, orden: 2 },
    });
    expect(creado.statusCode).toBe(201);

    const editado = await app.inject({
      method: 'PATCH',
      url: `/souvenirs/tipos/${creado.json().id}`,
      headers: cabeceras(),
      payload: { activo: false },
    });
    expect(editado.json().activo).toBe(false);

    const listado = await app.inject({
      method: 'GET',
      url: '/souvenirs/tipos',
      headers: cabeceras(),
    });
    const nombres = (listado.json().tipos as { nombre: string }[]).map((tipo) => tipo.nombre);
    expect(nombres).toContain('Camiseta del seminario');
  });

  it('reporta los entregados y los pendientes', async () => {
    await habilitar({ operadorSouvenirHabilitado: true });
    await registrarIngreso(ID_ASISTENTE);
    await registrarIngreso(ID_ASISTENTE_2);
    await entregar(ID_ASISTENTE);

    const entregados = await app.inject({
      method: 'GET',
      url: '/reportes/souvenirs-entregados?formato=csv',
      headers: cabeceras(),
    });
    expect(entregados.statusCode).toBe(200);
    expect(entregados.body).toContain('Souvenir de pruebas');
    expect(entregados.body).toContain(ID_ASISTENTE);

    const pendientes = await app.inject({
      method: 'GET',
      url: '/reportes/souvenirs-pendientes?formato=csv',
      headers: cabeceras(),
    });
    expect(pendientes.statusCode).toBe(200);
    expect(pendientes.body).toContain(ID_ASISTENTE_2);
    expect(pendientes.body).not.toContain(`\n${ID_ASISTENTE},`);
  });
});
