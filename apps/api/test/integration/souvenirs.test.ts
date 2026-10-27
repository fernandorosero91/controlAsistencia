import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { db } from '../../src/db/cliente.js';
import {
  asistencias,
  entregasSouvenir,
  jornadas,
  tiposSouvenir,
} from '../../src/db/esquema.js';
import {
  CLAVE_ADMIN,
  CORREO_ADMIN,
  crearAplicacionDePruebas,
  hayBaseDePruebas,
  ID_ASISTENTE,
  ID_ASISTENTE_2,
  ID_ASISTENTE_3,
  prepararBaseDePruebas,
} from '../ayudas/basePruebas.js';

const descripcion = hayBaseDePruebas()
  ? 'control de entrega de souvenirs'
  : 'control de entrega de souvenirs (omitida: falta DATABASE_URL_TEST)';

/**
 * El souvenir es del evento, no de una jornada: una entrega por asistente y
 * tipo. Solo se entrega a quien registro su ingreso en la PRIMERA jornada, y
 * depende del modulo que el administrador activa desde Configuracion.
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

  /** Inserta la asistencia directamente en la jornada indicada. */
  async function asistirEnJornada(asistenteId: string, idJornada: number) {
    await db.insert(asistencias).values({ asistenteId, jornadaId: idJornada });
  }

  async function jornadasPorOrden() {
    return db.select().from(jornadas).orderBy(asc(jornadas.orden));
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

  it('no entrega el souvenir a quien no tiene el ingreso de la primera jornada', async () => {
    await habilitar({ operadorSouvenirHabilitado: true });

    const respuesta = await entregar(ID_ASISTENTE_2);
    expect(respuesta.json().resultado).toBe('no_permitido');
    expect(respuesta.json().mensaje).toContain('primera jornada');
    // Al administrador se le ofrece la excepcion manual.
    expect(respuesta.json().puedeForzar).toBe(true);
  });

  it('el administrador entrega como excepcion con motivo y queda reportado', async () => {
    await habilitar({ operadorSouvenirHabilitado: true });
    const motivo = 'No registro el ingreso de la manana por falta de red en el celular.';

    const respuesta = await app.inject({
      method: 'POST',
      url: '/souvenirs/entregar',
      headers: cabeceras(),
      payload: { asistenteId: ID_ASISTENTE_2, tipoSouvenirId: tipoId, forzar: true, motivo },
    });

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json().resultado).toBe('exito');

    const [entrega] = await db
      .select()
      .from(entregasSouvenir)
      .where(eq(entregasSouvenir.asistenteId, ID_ASISTENTE_2));
    expect(entrega!.excepcionManual).toBe(true);
    expect(entrega!.motivoExcepcion).toBe(motivo);

    const reporte = await app.inject({
      method: 'GET',
      url: '/reportes/souvenirs-entregados?formato=csv',
      headers: cabeceras(),
    });
    expect(reporte.body).toContain('Si');
    expect(reporte.body).toContain('falta de red');
  });

  it('la excepcion exige un motivo de al menos 10 caracteres', async () => {
    await habilitar({ operadorSouvenirHabilitado: true });

    const respuesta = await app.inject({
      method: 'POST',
      url: '/souvenirs/entregar',
      headers: cabeceras(),
      payload: {
        asistenteId: ID_ASISTENTE_2,
        tipoSouvenirId: tipoId,
        forzar: true,
        motivo: 'corto',
      },
    });

    // El esquema de la peticion valida el motivo antes de llegar al servicio.
    expect(respuesta.statusCode).toBe(422);
    expect(
      respuesta.json().detalles.some((detalle: { campo: string }) => detalle.campo === 'motivo'),
    ).toBe(true);
  });

  it('un operador no puede forzar la entrega', async () => {
    await habilitar({ operadorSouvenirHabilitado: true });
    await app.inject({
      method: 'POST',
      url: '/usuarios',
      headers: cabeceras(),
      payload: {
        nombre: 'Operador Souvenir',
        email: 'operador.souvenir@pruebas.local',
        password: 'Operador2026',
        rol: 'operador',
      },
    });
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'operador.souvenir@pruebas.local', password: 'Operador2026' },
    });
    const tokenOperador = login.json().tokenAcceso as string;

    const respuesta = await app.inject({
      method: 'POST',
      url: '/souvenirs/entregar',
      headers: { authorization: `Bearer ${tokenOperador}` },
      payload: {
        asistenteId: ID_ASISTENTE_2,
        tipoSouvenirId: tipoId,
        forzar: true,
        motivo: 'Intento de excepcion sin ser administrador.',
      },
    });

    expect(respuesta.json().resultado).toBe('no_permitido');
    expect(respuesta.json().puedeForzar).not.toBe(true);
  });

  it('no entrega el souvenir a quien solo ingreso en la segunda jornada', async () => {
    await habilitar({ operadorSouvenirHabilitado: true });
    const [, segunda] = await jornadasPorOrden();
    await asistirEnJornada(ID_ASISTENTE_2, segunda!.id);

    const respuesta = await entregar(ID_ASISTENTE_2);

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json().resultado).toBe('no_permitido');
    expect(respuesta.json().mensaje).toContain('primera jornada');
  });

  it('entrega el souvenir a quien ingreso en la primera jornada', async () => {
    await habilitar({ operadorSouvenirHabilitado: true });
    const [primera] = await jornadasPorOrden();
    await asistirEnJornada(ID_ASISTENTE_2, primera!.id);

    const respuesta = await entregar(ID_ASISTENTE_2);

    expect(respuesta.statusCode).toBe(200);
    expect(respuesta.json().resultado).toBe('exito');
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

  it('reporta los entregados y pendientes con la regla de la primera jornada', async () => {
    await habilitar({ operadorSouvenirHabilitado: true });
    await registrarIngreso(ID_ASISTENTE);
    await registrarIngreso(ID_ASISTENTE_2);
    // ID_ASISTENTE_3 solo llego en la tarde: no debe aparecer entre los pendientes.
    const [, segunda] = await jornadasPorOrden();
    await asistirEnJornada(ID_ASISTENTE_3, segunda!.id);
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
    expect(pendientes.body).not.toContain(ID_ASISTENTE_3);
  });
});
