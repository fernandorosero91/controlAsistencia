import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  CLAVE_ADMIN,
  CORREO_ADMIN,
  contarAsistencias,
  contarEntregas,
  crearAplicacionDePruebas,
  hayBaseDePruebas,
  ID_ASISTENTE,
  ID_ASISTENTE_2,
  ID_ASISTENTE_3,
  prepararBaseDePruebas,
} from '../ayudas/basePruebas.js';
import { db } from '../../src/db/cliente.js';
import { tiposRefrigerio } from '../../src/db/esquema.js';

const descripcion = hayBaseDePruebas()
  ? 'concurrencia de registros'
  : 'concurrencia de registros (omitida: falta DATABASE_URL_TEST)';

describe(descripcion, () => {
  let app: FastifyInstance;
  let token: string;
  let jornadaId: number;
  let tipoRefrigerioId: number;

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

    const contexto = await app.inject({
      method: 'GET',
      url: '/operador/contexto',
      headers: { authorization: `Bearer ${token}` },
    });
    jornadaId = contexto.json().jornadaActiva.id as number;

    const tipos = await db.select().from(tiposRefrigerio);
    tipoRefrigerioId = tipos[0]!.id;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('registra un solo ingreso cuando llegan 100 peticiones simultaneas', async () => {
    const peticiones = Array.from({ length: 100 }, () =>
      app.inject({
        method: 'POST',
        url: '/asistencias/ingreso',
        headers: { authorization: `Bearer ${token}` },
        payload: { asistenteId: ID_ASISTENTE, jornadaId },
      }),
    );

    const respuestas = await Promise.all(peticiones);
    const cuerpos = respuestas.map((respuesta) => respuesta.json());

    const exitosos = cuerpos.filter((cuerpo) => cuerpo.resultado === 'exito');
    const duplicados = cuerpos.filter((cuerpo) => cuerpo.resultado === 'duplicado');

    expect(respuestas.every((respuesta) => respuesta.statusCode === 200)).toBe(true);
    expect(exitosos).toHaveLength(1);
    expect(duplicados).toHaveLength(99);
    expect(respuestas.every((respuesta) => respuesta.statusCode !== 500)).toBe(true);

    expect(await contarAsistencias(ID_ASISTENTE)).toBe(1);
  });

  it('los duplicados muestran la hora y el responsable del registro original', async () => {
    const respuestas = await Promise.all(
      Array.from({ length: 5 }, () =>
        app.inject({
          method: 'POST',
          url: '/asistencias/ingreso',
          headers: { authorization: `Bearer ${token}` },
          payload: { asistenteId: ID_ASISTENTE, jornadaId },
        }),
      ),
    );

    for (const respuesta of respuestas) {
      const cuerpo = respuesta.json();
      expect(cuerpo.resultado).toBe('duplicado');
      expect(cuerpo.existente).not.toBeNull();
      expect(typeof cuerpo.existente.horaIngreso).toBe('string');
      expect(cuerpo.existente.registradoPor).toBe('Administrador de pruebas');
    }
  });

  it('entrega un solo refrigerio cuando llegan 100 peticiones simultaneas', async () => {
    const peticiones = Array.from({ length: 100 }, () =>
      app.inject({
        method: 'POST',
        url: '/refrigerios/entregar',
        headers: { authorization: `Bearer ${token}` },
        payload: { asistenteId: ID_ASISTENTE, tipoRefrigerioId },
      }),
    );

    const respuestas = await Promise.all(peticiones);
    const cuerpos = respuestas.map((respuesta) => respuesta.json());

    const exitosos = cuerpos.filter((cuerpo) => cuerpo.resultado === 'exito');
    const duplicados = cuerpos.filter((cuerpo) => cuerpo.resultado === 'duplicado');

    expect(respuestas.every((respuesta) => respuesta.statusCode === 200)).toBe(true);
    expect(exitosos).toHaveLength(1);
    expect(duplicados).toHaveLength(99);
    expect(await contarEntregas(ID_ASISTENTE)).toBe(1);
  });

  it('no entrega refrigerio a quien no tiene asistencia en la jornada', async () => {
    const respuesta = await app.inject({
      method: 'POST',
      url: '/refrigerios/entregar',
      headers: { authorization: `Bearer ${token}` },
      payload: { asistenteId: ID_ASISTENTE_2, tipoRefrigerioId },
    });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json().resultado).toBe('no_permitido');
    expect(await contarEntregas(ID_ASISTENTE_2)).toBe(0);
  });

  it('repite la misma respuesta cuando se reintenta con la misma clave de idempotencia', async () => {
    const clave = `idempotencia-${Date.now()}`;
    const primera = await app.inject({
      method: 'POST',
      url: '/asistencias/ingreso',
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': clave },
      payload: { asistenteId: ID_ASISTENTE_2, jornadaId },
    });
    const segunda = await app.inject({
      method: 'POST',
      url: '/asistencias/ingreso',
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': clave },
      payload: { asistenteId: ID_ASISTENTE_2, jornadaId },
    });

    expect(primera.statusCode).toBe(200);
    expect(segunda.statusCode).toBe(200);
    expect(segunda.json()).toEqual(primera.json());
    expect(await contarAsistencias(ID_ASISTENTE_2)).toBe(1);
  });

  it('registra la salida una sola vez y avisa en el segundo intento', async () => {
    const primera = await app.inject({
      method: 'POST',
      url: '/asistencias/salida',
      headers: { authorization: `Bearer ${token}` },
      payload: { asistenteId: ID_ASISTENTE, jornadaId },
    });
    const segunda = await app.inject({
      method: 'POST',
      url: '/asistencias/salida',
      headers: { authorization: `Bearer ${token}` },
      payload: { asistenteId: ID_ASISTENTE, jornadaId },
    });

    expect(primera.json().resultado).toBe('exito');
    expect(segunda.json().resultado).toBe('duplicado');
  });

  it('impide registrar la salida de quien no tiene ingreso', async () => {
    const respuesta = await app.inject({
      method: 'POST',
      url: '/asistencias/salida',
      headers: { authorization: `Bearer ${token}` },
      payload: { asistenteId: ID_ASISTENTE_3, jornadaId },
    });

    expect(respuesta.json().resultado).toBe('no_permitido');
  });

  it('responde 401 cuando no hay sesion activa', async () => {
    const respuesta = await app.inject({
      method: 'POST',
      url: '/asistencias/ingreso',
      payload: { asistenteId: ID_ASISTENTE, jornadaId },
    });

    expect(respuesta.statusCode).toBe(401);
  });
});
