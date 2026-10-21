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
  ? 'renovacion de la sesion'
  : 'renovacion de la sesion (omitida: falta DATABASE_URL_TEST)';

/** Extrae el valor de la cookie de refresco de la respuesta del inicio de sesion. */
function cookieDeRespuesta(respuesta: { headers: Record<string, unknown> }): string {
  const cabeceras = respuesta.headers['set-cookie'];
  const lista = Array.isArray(cabeceras) ? cabeceras : [String(cabeceras ?? '')];
  const cookie = lista.find((valor) => valor.includes('seminario_refresh='));
  return (cookie ?? '').split(';')[0] ?? '';
}

/** Detecta si la respuesta intenta borrar la cookie de refresco. */
function borraCookie(respuesta: { headers: Record<string, unknown> }): boolean {
  const cabeceras = respuesta.headers['set-cookie'];
  const lista = Array.isArray(cabeceras) ? cabeceras : [String(cabeceras ?? '')];
  return lista.some(
    (valor) => valor.includes('seminario_refresh=;') || valor.includes('Max-Age=0'),
  );
}

describe(descripcion, () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    if (!hayBaseDePruebas()) return;
    app = await crearAplicacionDePruebas();
    await prepararBaseDePruebas();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  async function iniciarSesion(): Promise<string> {
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: CORREO_ADMIN, password: CLAVE_ADMIN },
    });
    return cookieDeRespuesta(login);
  }

  it('renueva la sesion y entrega un token de acceso nuevo', async () => {
    const cookie = await iniciarSesion();
    const respuesta = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: { cookie },
    });

    expect(respuesta.statusCode).toBe(200);
    const cuerpo = respuesta.json();
    expect(cuerpo.tokenAcceso).toBeTruthy();
    expect(cuerpo.expiraEn).toBeGreaterThan(0);
    // La cookie se renueva: el token anterior queda sin uso.
    expect(cookieDeRespuesta(respuesta)).not.toBe(cookie);
  });

  it('el refresh token es de un solo uso', async () => {
    const cookie = await iniciarSesion();
    const primera = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: { cookie },
    });
    expect(primera.statusCode).toBe(200);

    const segunda = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: { cookie },
    });
    expect(segunda.statusCode).toBe(401);
  });

  it('dos renovaciones simultaneas no invalidan la cookie de la otra pestana', async () => {
    const cookie = await iniciarSesion();

    const [uno, otro] = await Promise.all([
      app.inject({ method: 'POST', url: '/auth/refresh', headers: { cookie } }),
      app.inject({ method: 'POST', url: '/auth/refresh', headers: { cookie } }),
    ]);

    const estados = [uno.statusCode, otro.statusCode].sort();
    expect(estados).toEqual([200, 401]);

    // La peticion que pierde no debe borrar la cookie: la otra pestana sigue
    // con su sesion valida.
    const perdedor = uno.statusCode === 401 ? uno : otro;
    expect(borraCookie(perdedor)).toBe(false);
  });

  it('un token desconocido no borra la cookie del navegador', async () => {
    const respuesta = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      headers: { cookie: 'seminario_refresh=token-que-no-existe' },
    });

    expect(respuesta.statusCode).toBe(401);
    expect(borraCookie(respuesta)).toBe(false);
  });
});
