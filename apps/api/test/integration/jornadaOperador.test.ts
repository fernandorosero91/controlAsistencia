import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  CLAVE_ADMIN,
  CORREO_ADMIN,
  crearAplicacionDePruebas,
  hayBaseDePruebas,
  ID_ASISTENTE,
  prepararBaseDePruebas,
} from '../ayudas/basePruebas.js';

const descripcion = hayBaseDePruebas()
  ? 'jornada automatica y accesos controlados por el administrador'
  : 'jornada automatica y accesos controlados por el administrador (omitida: falta DATABASE_URL_TEST)';

/**
 * La jornada la decide el servidor y el administrador decide que modulos ve el
 * operador. Estas pruebas fijan ese contrato, que es la garantia de que un
 * ingreso no termine en la jornada equivocada.
 */
describe(descripcion, () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    if (!hayBaseDePruebas()) return;
    app = await crearAplicacionDePruebas();
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

  beforeEach(async () => {
    if (!hayBaseDePruebas()) return;
    await prepararBaseDePruebas();
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: CORREO_ADMIN, password: CLAVE_ADMIN },
    });
    if (login.statusCode !== 200) {
      throw new Error(`login de preparacion fallo: ${login.statusCode} ${login.body}`);
    }
    token = login.json().tokenAcceso as string;
  });

  const cabeceras = () => ({ authorization: `Bearer ${token}` });

  async function contexto() {
    const respuesta = await app.inject({
      method: 'GET',
      url: '/operador/contexto',
      headers: cabeceras(),
    });
    return respuesta.json();
  }

  async function jornadas() {
    const respuesta = await app.inject({
      method: 'GET',
      url: '/jornadas',
      headers: cabeceras(),
    });
    return respuesta.json().jornadas as { id: number; nombre: string }[];
  }

  async function fijarAccesos(datos: Record<string, unknown>) {
    return app.inject({
      method: 'PATCH',
      url: '/config/operador',
      headers: cabeceras(),
      payload: datos,
    });
  }

  it('el contexto entrega la jornada vigente y los modulos habilitados', async () => {
    const datos = await contexto();

    expect(datos.jornadaActiva).not.toBeNull();
    expect(datos.motivoJornada).toBe('activa');
    expect(datos.modulos).toEqual({ ingreso: true, refrigerio: true, salida: true });
    // El refrigerio sale de la jornada vigente, sin que el operador elija.
    expect(datos.refrigerioActivo?.jornadaId).toBe(datos.jornadaActiva.id);
  });

  it('rechaza un ingreso en una jornada que no es la vigente', async () => {
    const lista = await jornadas();
    const otra = lista[1]!;

    const respuesta = await app.inject({
      method: 'POST',
      url: '/asistencias/ingreso',
      headers: cabeceras(),
      payload: { asistenteId: ID_ASISTENTE, jornadaId: otra.id },
    });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json().resultado).toBe('no_permitido');
    expect(respuesta.json().mensaje).toContain('jornada activa');
  });

  it('registra el ingreso en la jornada vigente', async () => {
    const datos = await contexto();

    const respuesta = await app.inject({
      method: 'POST',
      url: '/asistencias/ingreso',
      headers: cabeceras(),
      payload: { asistenteId: ID_ASISTENTE, jornadaId: datos.jornadaActiva.id },
    });

    expect(respuesta.json().resultado).toBe('exito');
  });

  it('la jornada que fija el administrador es la vigente', async () => {
    const lista = await jornadas();
    const tarde = lista[1]!;

    const guardado = await fijarAccesos({ jornadaForzadaId: tarde.id });
    expect(guardado.statusCode).toBe(200);

    const datos = await contexto();
    expect(datos.jornadaActiva.id).toBe(tarde.id);
    expect(datos.motivoJornada).toBe('forzada');
  });

  it('un modulo deshabilitado por el administrador se rechaza con 403', async () => {
    await fijarAccesos({ operadorRefrigerioHabilitado: false });

    const tipos = await app.inject({
      method: 'GET',
      url: '/refrigerios/tipos',
      headers: cabeceras(),
    });
    const tipo = tipos.json().tipos[0] as { id: number };

    const respuesta = await app.inject({
      method: 'POST',
      url: '/refrigerios/entregar',
      headers: cabeceras(),
      payload: { asistenteId: ID_ASISTENTE, tipoRefrigerioId: tipo.id },
    });

    expect(respuesta.statusCode).toBe(403);
    expect(respuesta.json().codigo).toBe('NO_AUTORIZADO');
    expect(respuesta.json().mensaje).toContain('refrigerio');

    // Y el modulo tampoco aparece en el contexto del operador.
    const datos = await contexto();
    expect(datos.modulos.refrigerio).toBe(false);
  });

  it('un registro capturado sin conexion se acepta aunque la jornada ya no sea la vigente', async () => {
    const lista = await jornadas();
    const otra = lista[1]!;
    await fijarAccesos({ jornadaForzadaId: otra.id });

    const captura = new Date(Date.now() - 10 * 60_000).toISOString();

    const respuesta = await app.inject({
      method: 'POST',
      url: '/asistencias/ingreso',
      headers: cabeceras(),
      payload: {
        asistenteId: ID_ASISTENTE,
        jornadaId: lista[0]!.id,
        registradoEn: captura,
      },
    });

    expect(respuesta.json().resultado).toBe('exito');
    // El registro conserva la hora en que se capturo, no la de la sincronizacion.
    expect(respuesta.json().existente.horaIngreso).toBe(captura);
  });

  it('rechaza una hora de captura invalida', async () => {
    const datos = await contexto();

    const respuesta = await app.inject({
      method: 'POST',
      url: '/asistencias/ingreso',
      headers: cabeceras(),
      payload: {
        asistenteId: ID_ASISTENTE,
        jornadaId: datos.jornadaActiva.id,
        registradoEn: new Date(Date.now() + 5 * 60 * 60_000).toISOString(),
      },
    });

    expect(respuesta.statusCode).toBe(422);
  });

  it('un operador no puede cambiar los accesos del operador', async () => {
    const creado = await app.inject({
      method: 'POST',
      url: '/usuarios',
      headers: cabeceras(),
      payload: {
        nombre: 'Operador de pruebas',
        email: 'operador@pruebas.local',
        password: 'Operador2026',
        rol: 'operador',
      },
    });
    expect(creado.statusCode).toBe(201);

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'operador@pruebas.local', password: 'Operador2026' },
    });
    const tokenOperador = login.json().tokenAcceso as string;

    const respuesta = await app.inject({
      method: 'PATCH',
      url: '/config/operador',
      headers: { authorization: `Bearer ${tokenOperador}` },
      payload: { operadorIngresoHabilitado: false },
    });

    expect(respuesta.statusCode).toBe(403);
  });

  it('no permite registrar dos veces al mismo asistente, aunque sea otro operador', async () => {
    const datos = await contexto();
    if (!datos.jornadaActiva) {
      throw new Error(`contexto inesperado: ${JSON.stringify(datos).slice(0, 400)}`);
    }
    const jornadaId = datos.jornadaActiva.id as number;

    async function crearOperador(indice: number) {
      const correo = `operador${indice}@pruebas.local`;
      await app.inject({
        method: 'POST',
        url: '/usuarios',
        headers: cabeceras(),
        payload: {
          nombre: `Operador ${indice}`,
          email: correo,
          password: 'Operador2026',
          rol: 'operador',
        },
      });
      const login = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: correo, password: 'Operador2026' },
      });
      return login.json().tokenAcceso as string;
    }

    const tokenUno = await crearOperador(1);
    const tokenDos = await crearOperador(2);

    const primero = await app.inject({
      method: 'POST',
      url: '/asistencias/ingreso',
      headers: { authorization: `Bearer ${tokenUno}` },
      payload: { asistenteId: ID_ASISTENTE, jornadaId },
    });
    expect(primero.json().resultado).toBe('exito');

    const segundo = await app.inject({
      method: 'POST',
      url: '/asistencias/ingreso',
      headers: { authorization: `Bearer ${tokenDos}` },
      payload: { asistenteId: ID_ASISTENTE, jornadaId },
    });

    // El segundo intento no crea otro registro: devuelve la alerta con el
    // nombre de quien lo registro primero.
    expect(segundo.statusCode).toBe(200);
    expect(segundo.json().resultado).toBe('duplicado');
    expect(segundo.json().existente.registradoPor).toBe('Operador 1');

    const asistencias = await app.inject({
      method: 'GET',
      url: `/asistencias/asistente/${ID_ASISTENTE}`,
      headers: cabeceras(),
    });
    expect(asistencias.json()).toHaveLength(1);
  });
});
