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
  ? 'envio de credenciales por correo'
  : 'envio de credenciales por correo (omitida: falta DATABASE_URL_TEST)';

/**
 * En las pruebas no hay SMTP ni Redis, asi que el envio cae en el camino
 * directo: la respuesta debe ser explicita y no romper. La cola (BullMQ) se
 * activa sola cuando el servidor tiene SMTP y Redis configurados.
 */
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

  it('sin SMTP responde con el camino directo y lo informa', async () => {
    // El padron de pruebas no trae correos: se asigna uno para el escenario.
    const actualizado = await app.inject({
      method: 'PATCH',
      url: '/asistentes/PRUEBA0001',
      headers: cabeceras(),
      payload: { email: 'ana.prueba@ucc.edu.co' },
    });
    expect([200, 204]).toContain(actualizado.statusCode);

    const respuesta = await app.inject({
      method: 'POST',
      url: '/asistentes/enviar-qr',
      headers: cabeceras(),
      payload: { todos: true },
    });

    expect(respuesta.statusCode).toBe(200);
    const datos = respuesta.json();
    expect(datos.enCola).toBe(false);
    expect(datos.correoConfigurado).toBe(false);
    expect(datos.total).toBeGreaterThan(0);
    // Sin SMTP el envio falla, pero la respuesta es ordenada y con detalle.
    expect(datos.fallidos).toBe(datos.total);
    expect(datos.resultados[0].mensaje).toContain('correo');
  });

  it('el estado de un lote inexistente responde 404', async () => {    const respuesta = await app.inject({
      method: 'GET',
      url: '/asistentes/enviar-qr/lote/7d1f2f9e-0000-4000-8000-000000000000',
      headers: cabeceras(),
    });

    expect(respuesta.statusCode).toBe(404);
  });

  it('valida el identificador del lote', async () => {
    const respuesta = await app.inject({
      method: 'GET',
      url: '/asistentes/enviar-qr/lote/no-es-un-uuid',
      headers: cabeceras(),
    });

    expect(respuesta.statusCode).toBe(422);
  });

  it('sin cola disponible el estado y la pausa responden 503', async () => {
    const estado = await app.inject({
      method: 'GET',
      url: '/asistentes/enviar-qr/cola',
      headers: cabeceras(),
    });
    expect(estado.statusCode).toBe(503);
    expect(estado.json().codigo).toBe('NO_DISPONIBLE');

    const pausar = await app.inject({
      method: 'POST',
      url: '/asistentes/enviar-qr/cola/pausar',
      headers: cabeceras(),
    });
    expect(pausar.statusCode).toBe(503);

    const reanudar = await app.inject({
      method: 'POST',
      url: '/asistentes/enviar-qr/cola/reanudar',
      headers: cabeceras(),
    });
    expect(reanudar.statusCode).toBe(503);
  });
});
