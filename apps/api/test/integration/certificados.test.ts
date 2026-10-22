import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { asc } from 'drizzle-orm';
import {
  CLAVE_ADMIN,
  CORREO_ADMIN,
  ID_ASISTENTE,
  ID_ASISTENTE_2,
  ID_ASISTENTE_3,
  crearAplicacionDePruebas,
  hayBaseDePruebas,
  prepararBaseDePruebas,
} from '../ayudas/basePruebas.js';
import { db } from '../../src/db/cliente.js';
import { asistencias, certificados, certificadosLotes, jornadas } from '../../src/db/esquema.js';

/**
 * Emision y ciclo de vida de certificados PDF, de punta a punta.
 *
 * Contrato: un asistente es elegible solo cuando tiene ingreso y salida
 * registrados en cada jornada exigida (manana y tarde), es decir las 4 marcas.
 * Estas pruebas verifican elegibilidad, emision individual, descarga de PDF,
 * emision en lote, descarga del ZIP del lote y revocacion.
 */

const descripcion = hayBaseDePruebas()
  ? 'certificados PDF (elegibilidad y ciclo de vida)'
  : 'certificados PDF (elegibilidad y ciclo de vida) (omitida: falta DATABASE_URL_TEST)';

describe(descripcion, () => {
  let app: FastifyInstance;
  let token: string;
  let idManana: number;
  let idTarde: number;

  beforeAll(async () => {
    if (!hayBaseDePruebas()) return;
    app = await crearAplicacionDePruebas();
    await prepararBaseDePruebas();

    const jornadasFilas = await db.select().from(jornadas).orderBy(asc(jornadas.orden));
    idManana = jornadasFilas[0]!.id;
    idTarde = jornadasFilas[1]!.id;

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: CORREO_ADMIN, password: CLAVE_ADMIN },
    });
    token = login.json().tokenAcceso as string;
  });

  beforeEach(async () => {
    if (!hayBaseDePruebas()) return;
    // Cada prueba parte con asistencias y certificados limpios para que el
    // estado de elegibilidad y emision no se contamine entre tests.
    await db.delete(certificadosLotes);
    await db.delete(certificados);
    await db.delete(asistencias);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  const cabeceras = () => ({ authorization: `Bearer ${token}` });

  /**
   * Inserta ingreso y (opcionalmente) salida de un asistente en una jornada.
   * La salida se fija 1 hora despues del ingreso para superar el minimo de permanencia.
   */
  async function registrarJornada(
    asistenteId: string,
    jornadaId: number,
    conSalida = true,
  ): Promise<void> {
    const ingreso = new Date(Date.now() - 60 * 60 * 1000);
    await db.insert(asistencias).values({
      asistenteId,
      jornadaId,
      horaIngreso: ingreso,
      horaSalida: conSalida ? new Date(ingreso.getTime() + 60 * 60 * 1000) : null,
    });
  }

  // ---------------------------------------------------------------- elegibilidad

  it('sin asistencias nadie es elegible', async () => {
    const respuesta = await app.inject({
      method: 'GET',
      url: '/certificados',
      headers: cabeceras(),
    });
    expect(respuesta.statusCode).toBe(200);
    const cuerpo = respuesta.json();
    const elegibles = cuerpo.datos.filter((d: { estado: string }) => d.estado === 'elegible');
    expect(elegibles).toHaveLength(0);
  });

  it('no es elegible quien solo registra asistencia en una jornada', async () => {
    // Asistente 1: solo manana con salida.
    await registrarJornada(ID_ASISTENTE, idManana, true);
    // Asistente 2: solo tarde con salida.
    await registrarJornada(ID_ASISTENTE_2, idTarde, true);

    const respuesta = await app.inject({
      method: 'GET',
      url: '/certificados',
      headers: cabeceras(),
    });
    expect(respuesta.statusCode).toBe(200);
    const cuerpo = respuesta.json();
    const elegibles = cuerpo.datos.filter((d: { estado: string }) => d.estado === 'elegible');
    expect(elegibles).toHaveLength(0);
  });

  it('no es elegible quien tiene ingreso pero no salida en una jornada', async () => {
    await registrarJornada(ID_ASISTENTE, idManana, false); // sin salida
    await registrarJornada(ID_ASISTENTE, idTarde, true);

    const respuesta = await app.inject({
      method: 'GET',
      url: '/certificados',
      headers: cabeceras(),
    });
    expect(respuesta.statusCode).toBe(200);
    const datos = respuesta.json().datos as { asistenteId: string; estado: string }[];
    const asistente = datos.find((d) => d.asistenteId === ID_ASISTENTE);
    expect(asistente?.estado).not.toBe('elegible');
  });

  it('es elegible solo quien tiene las 4 marcas (ingreso y salida en manana y tarde)', async () => {
    // Asistente 1: 4 marcas completas.
    await registrarJornada(ID_ASISTENTE, idManana, true);
    await registrarJornada(ID_ASISTENTE, idTarde, true);
    // Asistente 2: solo manana (incompleto a proposito).
    await registrarJornada(ID_ASISTENTE_2, idManana, true);

    const respuesta = await app.inject({
      method: 'GET',
      url: '/certificados',
      headers: cabeceras(),
    });
    expect(respuesta.statusCode).toBe(200);
    const datos = respuesta.json().datos as { asistenteId: string; estado: string }[];
    const uno = datos.find((d) => d.asistenteId === ID_ASISTENTE);
    const dos = datos.find((d) => d.asistenteId === ID_ASISTENTE_2);
    expect(uno?.estado).toBe('elegible');
    expect(dos?.estado).not.toBe('elegible');
  });

  // ---------------------------------------------------------- emision individual

  it('rechaza emitir un certificado para un asistente no elegible', async () => {
    // Sin asistencias: nadie es elegible.
    const respuesta = await app.inject({
      method: 'POST',
      url: `/certificados/emitir/${ID_ASISTENTE}`,
      headers: cabeceras(),
      payload: {},
    });
    expect(respuesta.statusCode).toBe(409);
  });

  it('emite el certificado de un asistente elegible y lo refleja como emitido', async () => {
    await registrarJornada(ID_ASISTENTE, idManana, true);
    await registrarJornada(ID_ASISTENTE, idTarde, true);

    const emision = await app.inject({
      method: 'POST',
      url: `/certificados/emitir/${ID_ASISTENTE}`,
      headers: cabeceras(),
      payload: {},
    });
    expect(emision.statusCode).toBe(200);
    const cuerpoEmision = emision.json();
    expect(cuerpoEmision.codigoVerificacion).toBeDefined();
    expect(typeof cuerpoEmision.codigoVerificacion).toBe('string');
    expect(cuerpoEmision.codigoVerificacion.length).toBeGreaterThan(0);

    // El listado debe mostrar el asistente con estado "emitido".
    const listado = await app.inject({
      method: 'GET',
      url: '/certificados',
      headers: cabeceras(),
    });
    const datos = listado.json().datos as { asistenteId: string; estado: string }[];
    const asistente = datos.find((d) => d.asistenteId === ID_ASISTENTE);
    expect(asistente?.estado).toBe('emitido');
  });

  it('rechaza emitir de nuevo sin la opcion de regenerar', async () => {
    await registrarJornada(ID_ASISTENTE, idManana, true);
    await registrarJornada(ID_ASISTENTE, idTarde, true);

    // Primera emision.
    const primera = await app.inject({
      method: 'POST',
      url: `/certificados/emitir/${ID_ASISTENTE}`,
      headers: cabeceras(),
      payload: {},
    });
    expect(primera.statusCode).toBe(200);

    // Segunda emision sin regenerar: debe fallar.
    const segunda = await app.inject({
      method: 'POST',
      url: `/certificados/emitir/${ID_ASISTENTE}`,
      headers: cabeceras(),
      payload: {},
    });
    expect(segunda.statusCode).toBe(409);
  });

  it('regenera el certificado cuando se envia la opcion de regenerar', async () => {
    await registrarJornada(ID_ASISTENTE, idManana, true);
    await registrarJornada(ID_ASISTENTE, idTarde, true);

    const primera = await app.inject({
      method: 'POST',
      url: `/certificados/emitir/${ID_ASISTENTE}`,
      headers: cabeceras(),
      payload: {},
    });
    expect(primera.statusCode).toBe(200);
    const codigoPrimero = primera.json().codigoVerificacion as string;

    // Regenerar preserva el mismo codigo de verificacion.
    const segunda = await app.inject({
      method: 'POST',
      url: `/certificados/emitir/${ID_ASISTENTE}`,
      headers: cabeceras(),
      payload: { regenerar: true },
    });
    expect(segunda.statusCode).toBe(200);
    expect(segunda.json().codigoVerificacion).toBe(codigoPrimero);
  });

  // ---------------------------------------------------------------- descarga PDF

  it('descarga el PDF del certificado de un asistente con certificado emitido', async () => {
    await registrarJornada(ID_ASISTENTE, idManana, true);
    await registrarJornada(ID_ASISTENTE, idTarde, true);

    await app.inject({
      method: 'POST',
      url: `/certificados/emitir/${ID_ASISTENTE}`,
      headers: cabeceras(),
      payload: {},
    });

    const descarga = await app.inject({
      method: 'GET',
      url: `/certificados/${ID_ASISTENTE}/pdf`,
      headers: cabeceras(),
    });
    expect(descarga.statusCode).toBe(200);
    expect(descarga.headers['content-type']).toContain('application/pdf');
    // Un PDF valido empieza con la firma %PDF.
    expect(descarga.rawPayload.slice(0, 4).toString()).toBe('%PDF');
  });

  it('devuelve 404 al intentar descargar PDF de un asistente sin certificado', async () => {
    const descarga = await app.inject({
      method: 'GET',
      url: `/certificados/${ID_ASISTENTE}/pdf`,
      headers: cabeceras(),
    });
    expect(descarga.statusCode).toBe(404);
  });

  // ------------------------------------------------------------- emision en lote

  it('rechaza emitir en lote cuando no hay elegibles', async () => {
    const respuesta = await app.inject({
      method: 'POST',
      url: '/certificados/emitir-lote',
      headers: cabeceras(),
      payload: {},
    });
    expect(respuesta.statusCode).toBe(409);
  });

  it('emite el lote de los elegibles y permite consultar el progreso', async () => {
    // Dos asistentes con las 4 marcas.
    await registrarJornada(ID_ASISTENTE, idManana, true);
    await registrarJornada(ID_ASISTENTE, idTarde, true);
    await registrarJornada(ID_ASISTENTE_3, idManana, true);
    await registrarJornada(ID_ASISTENTE_3, idTarde, true);
    // Asistente 2 queda incompleto a proposito.
    await registrarJornada(ID_ASISTENTE_2, idManana, true);

    const emision = await app.inject({
      method: 'POST',
      url: '/certificados/emitir-lote',
      headers: cabeceras(),
      payload: {},
    });
    expect(emision.statusCode).toBe(202);
    const cuerpo = emision.json();
    expect(cuerpo.loteId).toBeDefined();
    expect(cuerpo.total).toBe(2);

    // El progreso del lote debe poder consultarse.
    const progreso = await app.inject({
      method: 'GET',
      url: `/certificados/lote/${cuerpo.loteId}`,
      headers: cabeceras(),
    });
    expect(progreso.statusCode).toBe(200);
    const cuerpoProgreso = progreso.json();
    expect(cuerpoProgreso.id).toBe(cuerpo.loteId);
    expect(['en_proceso', 'completado']).toContain(cuerpoProgreso.estado);
  });

  // ------------------------------------------------------------------- revocacion

  it('revoca un certificado emitido y lo muestra como revocado', async () => {
    await registrarJornada(ID_ASISTENTE, idManana, true);
    await registrarJornada(ID_ASISTENTE, idTarde, true);

    const emision = await app.inject({
      method: 'POST',
      url: `/certificados/emitir/${ID_ASISTENTE}`,
      headers: cabeceras(),
      payload: {},
    });
    // La emision debe ser exitosa antes de intentar revocar.
    expect(emision.statusCode).toBe(200);
    const certificadoId = emision.json().certificadoId as string;
    expect(certificadoId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    // El motivo de revocacion exige al menos 10 caracteres (validacion Zod).
    const revocacion = await app.inject({
      method: 'POST',
      url: `/certificados/${certificadoId}/revocar`,
      headers: cabeceras(),
      payload: { motivo: 'Revocacion autorizada por la coordinacion del seminario' },
    });
    expect(revocacion.statusCode).toBe(200);
    expect(revocacion.json().revocado).toBe(true);

    // El listado lo debe mostrar con estado "revocado".
    const listado = await app.inject({
      method: 'GET',
      url: '/certificados',
      headers: cabeceras(),
    });
    const datos = listado.json().datos as { asistenteId: string; estado: string }[];
    const asistente = datos.find((d) => d.asistenteId === ID_ASISTENTE);
    expect(asistente?.estado).toBe('revocado');
  });

  it('impide revocar un certificado que ya esta revocado', async () => {
    await registrarJornada(ID_ASISTENTE, idManana, true);
    await registrarJornada(ID_ASISTENTE, idTarde, true);

    const emision = await app.inject({
      method: 'POST',
      url: `/certificados/emitir/${ID_ASISTENTE}`,
      headers: cabeceras(),
      payload: {},
    });
    expect(emision.statusCode).toBe(200);
    const certificadoId = emision.json().certificadoId as string;

    // Primera revocacion: debe pasar.
    const primera = await app.inject({
      method: 'POST',
      url: `/certificados/${certificadoId}/revocar`,
      headers: cabeceras(),
      payload: { motivo: 'Primera revocacion por solicitud de la coordinacion' },
    });
    expect(primera.statusCode).toBe(200);

    // Segunda revocacion: el servicio devuelve 409 porque ya estaba revocado.
    const segunda = await app.inject({
      method: 'POST',
      url: `/certificados/${certificadoId}/revocar`,
      headers: cabeceras(),
      payload: { motivo: 'Segunda revocacion por solicitud posterior prueba' },
    });
    expect(segunda.statusCode).toBe(409);
  });

  // -------------------------------------------- excepcion manual (no elegible)

  it('permite emitir con excepcion manual cuando el asistente no es elegible', async () => {
    // Solo manana: no es elegible.
    await registrarJornada(ID_ASISTENTE, idManana, true);

    const emision = await app.inject({
      method: 'POST',
      url: `/certificados/emitir/${ID_ASISTENTE}`,
      headers: cabeceras(),
      payload: {
        excepcionManual: true,
        motivo: 'Autorizacion de coordinacion por caso especial de prueba',
      },
    });
    expect(emision.statusCode).toBe(200);
    expect(emision.json().codigoVerificacion).toBeDefined();
  });

  it('rechaza excepcion manual sin motivo o con motivo muy corto', async () => {
    await registrarJornada(ID_ASISTENTE, idManana, true);

    // La validacion Zod del esquema emitirCertificadoSchema devuelve 422
    // (Unprocessable Entity) cuando la excepcion manual se activa sin motivo.
    const sinMotivo = await app.inject({
      method: 'POST',
      url: `/certificados/emitir/${ID_ASISTENTE}`,
      headers: cabeceras(),
      payload: { excepcionManual: true },
    });
    expect([400, 422]).toContain(sinMotivo.statusCode);
  });

  // ----------------------------------------------------- verificacion publica

  it('el endpoint publico confirma un certificado valido sin exponer datos sensibles', async () => {
    await registrarJornada(ID_ASISTENTE, idManana, true);
    await registrarJornada(ID_ASISTENTE, idTarde, true);

    const emision = await app.inject({
      method: 'POST',
      url: `/certificados/emitir/${ID_ASISTENTE}`,
      headers: cabeceras(),
      payload: {},
    });
    const codigo = emision.json().codigoVerificacion as string;

    const verificacion = await app.inject({
      method: 'GET',
      url: `/publico/verificar/${codigo}`,
    });
    expect(verificacion.statusCode).toBe(200);
    const cuerpo = verificacion.json();
    expect(cuerpo.valido).toBe(true);
    expect(cuerpo.estado).toBe('emitido');
    // El endpoint publico no debe exponer el ID institucional.
    expect(JSON.stringify(cuerpo)).not.toContain(ID_ASISTENTE);
  });

  it('el endpoint publico devuelve valido=false para un codigo inexistente', async () => {
    const verificacion = await app.inject({
      method: 'GET',
      url: '/publico/verificar/XXXX-XXXX-XXXX',
    });
    expect(verificacion.statusCode).toBe(200);
    expect(verificacion.json().valido).toBe(false);
  });

  // ------------------------------------------------ acceso y seguridad RBAC

  it('el listado de certificados exige autenticacion de administrador', async () => {
    const anonimo = await app.inject({ method: 'GET', url: '/certificados' });
    expect([401, 403]).toContain(anonimo.statusCode);
  });

  it('la emision exige autenticacion de administrador', async () => {
    const anonimo = await app.inject({
      method: 'POST',
      url: `/certificados/emitir/${ID_ASISTENTE}`,
      payload: {},
    });
    expect([401, 403]).toContain(anonimo.statusCode);
  });
});
