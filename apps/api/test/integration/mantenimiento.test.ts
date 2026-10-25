import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { db } from '../../src/db/cliente.js';
import { asistentes, jornadas, seminarioConfig } from '../../src/db/esquema.js';
import {
  CLAVE_ADMIN,
  CORREO_ADMIN,
  crearAplicacionDePruebas,
  hayBaseDePruebas,
  ID_ASISTENTE,
  prepararBaseDePruebas,
} from '../ayudas/basePruebas.js';

const descripcion = hayBaseDePruebas()
  ? 'limpieza de los datos operativos'
  : 'limpieza de los datos operativos (omitida: falta DATABASE_URL_TEST)';

/**
 * La limpieza es la unica operacion destructiva del panel. Estas pruebas fijan
 * sus tres candados: solo administrador, frase exacta y contrasena correcta; y
 * verifican que la configuracion del seminario sobreviva.
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

  async function resumen() {
    const respuesta = await app.inject({
      method: 'GET',
      url: '/mantenimiento/resumen',
      headers: cabeceras(),
    });
    return respuesta.json();
  }

  async function limpiar(datos: Record<string, unknown>, conToken = token) {
    return app.inject({
      method: 'POST',
      url: '/mantenimiento/limpiar',
      headers: { authorization: `Bearer ${conToken}` },
      payload: datos,
    });
  }

  it('informa cuantos registros hay y la frase de confirmacion', async () => {
    const datos = await resumen();

    expect(datos.asistentes).toBeGreaterThan(0);
    expect(datos.fraseConfirmacion).toBe('BORRAR TODOS LOS DATOS');
    expect(datos.habilitado).toBe(true);
  });

  it('exige la frase exacta de confirmacion', async () => {
    const respuesta = await limpiar({ password: CLAVE_ADMIN, confirmacion: 'borrar' });

    expect(respuesta.statusCode).toBe(422);
    expect(respuesta.json().codigo).toBe('VALIDACION');
  });

  it('exige la contrasena correcta del administrador', async () => {
    const respuesta = await limpiar({
      password: 'contrasena-equivocada',
      confirmacion: 'BORRAR TODOS LOS DATOS',
    });

    expect(respuesta.statusCode).toBe(403);
    expect(respuesta.json().mensaje).toContain('contrasena');

    // Y no borra nada.
    expect((await resumen()).asistentes).toBeGreaterThan(0);
  });

  it('un operador no puede limpiar la base de datos', async () => {
    await app.inject({
      method: 'POST',
      url: '/usuarios',
      headers: cabeceras(),
      payload: {
        nombre: 'Operador de limpieza',
        email: 'operador.limpieza@pruebas.local',
        password: 'Operador2026',
        rol: 'operador',
      },
    });
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'operador.limpieza@pruebas.local', password: 'Operador2026' },
    });

    const respuesta = await limpiar(
      { password: CLAVE_ADMIN, confirmacion: 'BORRAR TODOS LOS DATOS' },
      login.json().tokenAcceso as string,
    );

    expect(respuesta.statusCode).toBe(403);
  });

  it('borra los datos operativos y conserva la configuracion y las cuentas', async () => {
    const antes = await resumen();

    const respuesta = await limpiar({
      password: CLAVE_ADMIN,
      confirmacion: 'BORRAR TODOS LOS DATOS',
    });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json().limpiado).toBe(true);
    expect(respuesta.json().filasBorradas.asistentes).toBe(antes.asistentes);

    const despues = await resumen();
    expect(despues.asistentes).toBe(0);
    expect(despues.asistencias).toBe(0);
    expect(despues.entregas).toBe(0);
    expect(despues.certificados).toBe(0);

    // La estructura del sistema sigue en pie.
    expect(await db.select().from(asistentes)).toHaveLength(0);
    expect(await db.select().from(jornadas)).toHaveLength(2);
    expect(await db.select().from(seminarioConfig)).toHaveLength(1);
  });

  it('limpia con dos administradores activos usando la contrasena de la cuenta conectada', async () => {
    await app.inject({
      method: 'POST',
      url: '/usuarios',
      headers: cabeceras(),
      payload: {
        nombre: 'Segundo administrador',
        email: 'segundo.admin@pruebas.local',
        password: 'Segundo2026',
        rol: 'admin',
      },
    });

    const respuesta = await limpiar({
      password: CLAVE_ADMIN,
      confirmacion: 'BORRAR TODOS LOS DATOS',
    });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json().limpiado).toBe(true);
  });

  it('aclara cual cuenta debe confirmar cuando hay varios administradores', async () => {
    await app.inject({
      method: 'POST',
      url: '/usuarios',
      headers: cabeceras(),
      payload: {
        nombre: 'Segundo administrador',
        email: 'segundo.admin@pruebas.local',
        password: 'Segundo2026',
        rol: 'admin',
      },
    });

    // La contrasena es valida, pero pertenece a la otra cuenta.
    const respuesta = await limpiar({
      password: 'Segundo2026',
      confirmacion: 'BORRAR TODOS LOS DATOS',
    });

    expect(respuesta.statusCode).toBe(403);
    expect(respuesta.json().mensaje).toContain(CORREO_ADMIN);
    expect(respuesta.json().mensaje).toContain('su propia contrasena');
  });

  it('despues de limpiar se puede volver a cargar el padron', async () => {
    await limpiar({ password: CLAVE_ADMIN, confirmacion: 'BORRAR TODOS LOS DATOS' });

    const creado = await app.inject({
      method: 'POST',
      url: '/asistentes',
      headers: cabeceras(),
      payload: {
        id: ID_ASISTENTE,
        nombres: 'Ana',
        apellidos: 'Despues De La Limpieza',
        rol: 'estudiante',
        semestre: 4,
      },
    });

    expect([200, 201]).toContain(creado.statusCode);
    expect((await resumen()).asistentes).toBe(1);
  });
});
