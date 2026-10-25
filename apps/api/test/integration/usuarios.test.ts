import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/cliente.js';
import { usuariosSistema } from '../../src/db/esquema.js';
import {
  CLAVE_ADMIN,
  CORREO_ADMIN,
  crearAplicacionDePruebas,
  hayBaseDePruebas,
  prepararBaseDePruebas,
} from '../ayudas/basePruebas.js';

const descripcion = hayBaseDePruebas()
  ? 'gestion de usuarios del sistema'
  : 'gestion de usuarios del sistema (omitida: falta DATABASE_URL_TEST)';

/**
 * Fija el contrato del panel de usuarios: editar sin tocar la contrasena,
 * reemplazarla cuando se escribe, y eliminar cuentas sin quedarse sin ningun
 * administrador activo.
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

  async function idDelAdmin(): Promise<string> {
    const filas = await db
      .select({ id: usuariosSistema.id })
      .from(usuariosSistema)
      .where(eq(usuariosSistema.email, CORREO_ADMIN));
    return filas[0]!.id;
  }

  async function crearUsuario(datos: Record<string, unknown>) {
    const respuesta = await app.inject({
      method: 'POST',
      url: '/usuarios',
      headers: cabeceras(),
      payload: {
        nombre: 'Cuenta de pruebas',
        email: 'cuenta@pruebas.local',
        password: 'Cuenta2026',
        rol: 'operador',
        ...datos,
      },
    });
    return respuesta;
  }

  it('crea una cuenta nueva', async () => {
    const respuesta = await crearUsuario({});

    expect(respuesta.statusCode).toBe(201);
    expect(respuesta.json().email).toBe('cuenta@pruebas.local');
    expect(respuesta.json().rol).toBe('operador');
  });

  it('edita el nombre y el correo sin enviar contrasena', async () => {
    const creado = await crearUsuario({});
    const id = creado.json().id as string;

    const respuesta = await app.inject({
      method: 'PATCH',
      url: `/usuarios/${id}`,
      headers: cabeceras(),
      payload: { nombre: 'Nombre Corregido', email: 'cuenta@pruebas.local', rol: 'operador' },
    });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json().nombre).toBe('Nombre Corregido');

    // La contrasena anterior sigue sirviendo.
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'cuenta@pruebas.local', password: 'Cuenta2026' },
    });
    expect(login.statusCode).toBe(200);
  });

  it('cambia la contrasena cuando se envia una nueva', async () => {
    const creado = await crearUsuario({});
    const id = creado.json().id as string;

    const respuesta = await app.inject({
      method: 'PATCH',
      url: `/usuarios/${id}`,
      headers: cabeceras(),
      payload: { password: 'NuevaClave2026' },
    });
    expect(respuesta.statusCode).toBe(200);

    const anterior = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'cuenta@pruebas.local', password: 'Cuenta2026' },
    });
    expect(anterior.statusCode).toBe(401);

    const nueva = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'cuenta@pruebas.local', password: 'NuevaClave2026' },
    });
    expect(nueva.statusCode).toBe(200);
  });

  it('elimina una cuenta y esta deja de poder entrar', async () => {
    const creado = await crearUsuario({});
    const id = creado.json().id as string;

    const respuesta = await app.inject({
      method: 'DELETE',
      url: `/usuarios/${id}`,
      headers: cabeceras(),
    });

    expect(respuesta.statusCode).toBe(204);
    expect(await db.select().from(usuariosSistema).where(eq(usuariosSistema.id, id))).toHaveLength(
      0,
    );

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'cuenta@pruebas.local', password: 'Cuenta2026' },
    });
    expect(login.statusCode).toBe(401);
  });

  it('no permite eliminar la propia cuenta', async () => {
    const id = await idDelAdmin();

    const respuesta = await app.inject({
      method: 'DELETE',
      url: `/usuarios/${id}`,
      headers: cabeceras(),
    });

    expect(respuesta.statusCode).toBe(409);
    expect(respuesta.json().mensaje).toContain('propia cuenta');
  });

  it('no permite eliminar ni desactivar el ultimo administrador activo', async () => {
    const id = await idDelAdmin();

    const eliminacion = await app.inject({
      method: 'DELETE',
      url: `/usuarios/${id}`,
      headers: cabeceras(),
    });
    expect(eliminacion.statusCode).toBe(409);

    // Se crea otro administrador para poder intentar la degradacion desde una
    // cuenta distinta a la ultima: la propia no se puede desactivar.
    await crearUsuario({ email: 'otro.admin@pruebas.local', rol: 'admin' });
    const otro = await db
      .select({ id: usuariosSistema.id })
      .from(usuariosSistema)
      .where(eq(usuariosSistema.email, 'otro.admin@pruebas.local'));
    const idOtro = otro[0]!.id;

    // Al existir dos administradores activos, desactivar uno esta permitido.
    const desactivar = await app.inject({
      method: 'PATCH',
      url: `/usuarios/${idOtro}`,
      headers: cabeceras(),
      payload: { activo: false },
    });
    expect(desactivar.statusCode).toBe(200);
    expect(desactivar.json().activo).toBe(false);

    // Y con uno solo activo, ya no se puede degradar al que queda.
    const degradar = await app.inject({
      method: 'PATCH',
      url: `/usuarios/${id}`,
      headers: cabeceras(),
      payload: { rol: 'operador' },
    });
    expect(degradar.statusCode).toBe(409);
  });

  it('con dos administradores activos se puede eliminar uno', async () => {
    const creado = await crearUsuario({ email: 'segundo.admin@pruebas.local', rol: 'admin' });
    const idSegundo = creado.json().id as string;

    const respuesta = await app.inject({
      method: 'DELETE',
      url: `/usuarios/${idSegundo}`,
      headers: cabeceras(),
    });

    expect(respuesta.statusCode).toBe(204);
  });

  it('un operador no puede administrar usuarios', async () => {
    await crearUsuario({});
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'cuenta@pruebas.local', password: 'Cuenta2026' },
    });
    const tokenOperador = login.json().tokenAcceso as string;

    const listado = await app.inject({
      method: 'GET',
      url: '/usuarios',
      headers: { authorization: `Bearer ${tokenOperador}` },
    });
    expect(listado.statusCode).toBe(403);
  });
});
