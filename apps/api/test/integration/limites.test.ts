import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

/**
 * Limite de tasa por operador.
 *
 * El tope se baja a 5 peticiones por minuto para no tener que enviar cientos
 * de peticiones en la prueba. El valor se fija antes de cargar la aplicacion
 * porque el limite se determina al registrar las rutas.
 */
process.env.RATE_LIMIT_ESCANEO_MAX = '5';

const {
  CLAVE_ADMIN,
  CORREO_ADMIN,
  crearAplicacionDePruebas,
  hayBaseDePruebas,
  prepararBaseDePruebas,
} = await import('../ayudas/basePruebas.js');

const descripcion = hayBaseDePruebas()
  ? 'limite de tasa por operador'
  : 'limite de tasa por operador (omitida: falta DATABASE_URL_TEST)';

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

  it('bloquea al operador cuando supera su presupuesto de peticiones', async () => {
    const estados: number[] = [];

    for (let intento = 0; intento < 7; intento += 1) {
      const respuesta = await app.inject({
        method: 'POST',
        url: '/asistencias/ingreso',
        headers: { authorization: `Bearer ${token}` },
        payload: { asistenteId: 'LIMITE0001', jornadaId: 1 },
      });
      estados.push(respuesta.statusCode);
    }

    // Las primeras 5 pasan (aunque repitan el registro) y la sexta recibe 429.
    expect(estados.slice(0, 5).every((estado) => estado === 200)).toBe(true);
    expect(estados[5]).toBe(429);
    expect(estados[6]).toBe(429);
  });

  it('responde 429 con el codigo de error y el tiempo de espera', async () => {
    const respuesta = await app.inject({
      method: 'POST',
      url: '/asistencias/ingreso',
      headers: { authorization: `Bearer ${token}` },
      payload: { asistenteId: 'LIMITE0001', jornadaId: 1 },
    });

    expect(respuesta.statusCode).toBe(429);
    expect(respuesta.json().codigo).toBe('LIMITE_TASA');
    expect(Number(respuesta.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('da a cada dispositivo su propio cupo aunque compartan la misma cuenta', async () => {
    const enviar = (dispositivo: string) =>
      app.inject({
        method: 'POST',
        url: '/asistencias/ingreso',
        headers: { authorization: `Bearer ${token}`, 'x-dispositivo': dispositivo },
        payload: { asistenteId: 'LIMITE0001', jornadaId: 1 },
      });

    // El celular A agota su cupo de 5.
    const celularA: number[] = [];
    for (let intento = 0; intento < 7; intento += 1) {
      celularA.push((await enviar('celular-a')).statusCode);
    }
    expect(celularA.slice(0, 5).every((estado) => estado === 200)).toBe(true);
    expect(celularA[5]).toBe(429);

    // El celular B usa la misma cuenta, pero conserva su propio cupo.
    const celularB: number[] = [];
    for (let intento = 0; intento < 5; intento += 1) {
      celularB.push((await enviar('celular-b')).statusCode);
    }
    expect(celularB.every((estado) => estado === 200)).toBe(true);
  });

  it('no aplica el limite de escaneo a las rutas del panel', async () => {
    const respuestas = await Promise.all(
      Array.from({ length: 7 }, () =>
        app.inject({
          method: 'GET',
          url: '/jornadas',
          headers: { authorization: `Bearer ${token}` },
        }),
      ),
    );

    expect(respuestas.every((respuesta) => respuesta.statusCode === 200)).toBe(true);
  });
});
