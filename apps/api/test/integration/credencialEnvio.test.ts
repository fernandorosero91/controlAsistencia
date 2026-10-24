import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
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
  ? 'seguimiento del envio de la credencial'
  : 'seguimiento del envio de la credencial (omitida: falta DATABASE_URL_TEST)';

/**
 * El envio se reparte en varios dias, asi que el sistema debe recordar a quien
 * ya se le envio, a quien no y a quien le fallo, para no duplicar ni perder a
 * nadie. En las pruebas no hay SMTP: el envio falla y queda marcado como error,
 * que es justo el estado que necesita reintento.
 */
describe(descripcion, () => {
  let app: FastifyInstance;
  let token: string;

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
  });

  const cabeceras = () => ({ authorization: `Bearer ${token}` });

  async function asignarCorreo(asistenteId: string, email: string) {
    const respuesta = await app.inject({
      method: 'PATCH',
      url: `/asistentes/${asistenteId}`,
      headers: cabeceras(),
      payload: { email },
    });
    expect([200, 204]).toContain(respuesta.statusCode);
  }

  async function listar(filtro?: string) {
    const respuesta = await app.inject({
      method: 'GET',
      url: `/asistentes?porPagina=50${filtro ? `&credencial=${filtro}` : ''}`,
      headers: cabeceras(),
    });
    return respuesta.json().datos as {
      id: string;
      credencialEstado: 'en_cola' | 'enviada' | 'error' | null;
      credencialError: string | null;
      credencialEnviadaAt: string | null;
    }[];
  }

  it('un asistente sin envio aparece como pendiente', async () => {
    const datos = await listar();
    const asistente = datos.find((fila) => fila.id === ID_ASISTENTE);

    expect(asistente?.credencialEstado).toBeNull();
  });

  it('sin SMTP el envio queda marcado como error con su motivo', async () => {
    await asignarCorreo(ID_ASISTENTE, 'ana.prueba@ucc.edu.co');

    const envio = await app.inject({
      method: 'POST',
      url: '/asistentes/enviar-qr',
      headers: cabeceras(),
      payload: { asistenteId: ID_ASISTENTE },
    });

    expect(envio.statusCode).toBe(200);
    expect(envio.json().enCola).toBe(false);
    expect(envio.json().resultados[0].enviado).toBe(false);

    const datos = await listar();
    const asistente = datos.find((fila) => fila.id === ID_ASISTENTE);
    expect(asistente?.credencialEstado).toBe('error');
    expect(asistente?.credencialError).toContain('correo');
    expect(asistente?.credencialEnviadaAt).toBeNull();
  });

  it('el filtro de pendientes incluye a los que fallaron, para reintentar', async () => {
    await asignarCorreo(ID_ASISTENTE, 'ana.prueba@ucc.edu.co');
    await app.inject({
      method: 'POST',
      url: '/asistentes/enviar-qr',
      headers: cabeceras(),
      payload: { asistenteId: ID_ASISTENTE },
    });

    const pendientes = await listar('pendiente');
    expect(pendientes.map((fila) => fila.id)).toContain(ID_ASISTENTE);

    const conError = await listar('error');
    expect(conError.map((fila) => fila.id)).toContain(ID_ASISTENTE);

    const enviadas = await listar('enviada');
    expect(enviadas.map((fila) => fila.id)).not.toContain(ID_ASISTENTE);
  });

  it('al enviar a todos solo entran los pendientes', async () => {
    await asignarCorreo(ID_ASISTENTE, 'ana.prueba@ucc.edu.co');
    await asignarCorreo(ID_ASISTENTE_2, 'luis.prueba@ucc.edu.co');

    // Primer intento: falla por falta de SMTP y deja los dos en error.
    await app.inject({
      method: 'POST',
      url: '/asistentes/enviar-qr',
      headers: cabeceras(),
      payload: { todos: true },
    });

    // Segundo intento: como estan en error, se reintentan los dos.
    const segundo = await app.inject({
      method: 'POST',
      url: '/asistentes/enviar-qr',
      headers: cabeceras(),
      payload: { todos: true },
    });

    expect(segundo.json().total).toBe(2);
  });

  it('sin correos pendientes responde con un mensaje claro', async () => {
    // Sin correos asignados no hay destinatarios.
    const respuesta = await app.inject({
      method: 'POST',
      url: '/asistentes/enviar-qr',
      headers: cabeceras(),
      payload: { todos: true },
    });

    expect(respuesta.statusCode).toBe(422);
    expect(respuesta.json().mensaje).toContain('pendientes');
  });
});
