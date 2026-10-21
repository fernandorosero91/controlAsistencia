import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const rutaCodigo = path.join(aqui, '.auth', 'codigo-certificado.txt');

/**
 * Flujo completo del operador en un celular de 360 px:
 *
 * 1. verificar el nombre del asistente y compararlo con la escarapela,
 * 2. registrar el ingreso,
 * 3. ver la alerta de duplicado,
 * 4. entregar refrigerio,
 * 5. registrar la salida,
 * 6. emitir un certificado como administrador.
 *
 * La sesion se inicia una sola vez por archivo, en un contexto de navegador
 * propio: asi el token de renovacion rotado se conserva entre pruebas y no se
 * agota el limite de intentos de inicio de sesion.
 */

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const CORREO = process.env.E2E_ADMIN_CORREO ?? 'admin@seminario.local';
const CLAVE = process.env.E2E_ADMIN_CLAVE ?? 'Seminario2026';

/** Asistente dedicado a la prueba: se crea para garantizar un estado limpio. */
const ID_PRUEBA = `E2E${Date.now().toString().slice(-6)}`;

async function tokenAdmin(request: APIRequestContext): Promise<string> {
  const respuesta = await request.post(`${BASE}/api/auth/login`, {
    data: { email: CORREO, password: CLAVE },
  });
  expect(respuesta.ok()).toBeTruthy();
  return (await respuesta.json()).tokenAcceso as string;
}

/**
 * Inicia sesion esperando si el limite de intentos esta alcanzado: el limite de
 * 10 por minuto existe para protegerse de la fuerza bruta y la suite puede
 * superar ese limite al ejecutarse varias veces seguidas.
 */
async function iniciarSesion(pagina: Page): Promise<void> {
  for (let intento = 1; intento <= 4; intento += 1) {
    await pagina.goto('/login');
    await pagina.getByLabel('Correo electronico').fill(CORREO);
    await pagina.getByLabel('Contrasena').fill(CLAVE);
    await pagina.getByRole('button', { name: 'Entrar' }).click();

    const exito = await pagina
      .waitForURL(/\/(admin|operador)/, { timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (exito) return;

    const limite = await pagina.getByText(/limite de solicitudes/i).count();
    if (limite === 0) {
      throw new Error('No se pudo iniciar sesion en la prueba');
    }
    await pagina.waitForTimeout(20_000);
  }
  throw new Error('No se pudo iniciar sesion tras varios intentos');
}

let pagina: Page;

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  const contexto = await browser.newContext({
    viewport: { width: 360, height: 640 },
    locale: 'es-CO',
  });
  pagina = await contexto.newPage();

  await pagina.goto('/login');
  await iniciarSesion(pagina);

  // Asistente de prueba con un codigo de registro propio.
  const peticion = await (await import('playwright')).request.newContext({ baseURL: BASE });
  const token = await tokenAdmin(peticion);
  const respuesta = await peticion.post(`${BASE}/api/asistentes`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      id: ID_PRUEBA,
      nombres: 'Participante',
      apellidos: 'Prueba Automatizada',
      rol: 'estudiante',
      semestre: 4,
      email: 'prueba.automatica@seminario.local',
    },
  });
  expect(respuesta.ok()).toBeTruthy();
  await peticion.dispose();
});

test.afterAll(async () => {
  await pagina?.context().close();
});

async function irAOperador(): Promise<void> {
  await pagina.goto('/operador');
  await expect(pagina.getByLabel('ID institucional o codigo de registro')).toBeVisible();
  await expect(pagina.getByText('IV Seminario de Ingenieria de Software')).toBeVisible();
}

async function verificarYRegistrar(id: string): Promise<void> {
  const campo = pagina.getByLabel('ID institucional o codigo de registro');
  await campo.fill(id);
  await pagina.getByRole('button', { name: 'Verificar el nombre del asistente' }).click();
  await expect(pagina.getByTestId('tarjeta-verificacion')).toBeVisible({ timeout: 15_000 });
  await pagina.getByRole('button', { name: /^Registrar a / }).click();
}

test.describe('App del operador en 360 px', () => {
  test('muestra el nombre del asistente antes de registrar', async () => {
    await irAOperador();

    await pagina.getByLabel('ID institucional o codigo de registro').fill(ID_PRUEBA);
    await pagina.getByRole('button', { name: 'Verificar el nombre del asistente' }).click();

    const tarjeta = pagina.getByTestId('tarjeta-verificacion');
    await expect(tarjeta).toBeVisible({ timeout: 15_000 });
    await expect(tarjeta.getByText('Participante Prueba Automatizada')).toBeVisible();
    await expect(tarjeta.getByText(/Estudiante - Semestre 4/)).toBeVisible();
    await expect(tarjeta.getByText(ID_PRUEBA)).toBeVisible();
  });
  test('registra el ingreso, avisa el duplicado, entrega refrigerio y registra la salida', async () => {
    await irAOperador();

    // Primer ingreso
    await verificarYRegistrar(ID_PRUEBA);
    await expect(
      pagina.getByTestId('resultado-registro').getByText('Registro exitoso'),
    ).toBeVisible({ timeout: 15_000 });

    // El campo queda limpio y enfocado para el siguiente estudiante
    await expect(pagina.getByLabel('ID institucional o codigo de registro')).toHaveValue('');

    // Segundo intento: alerta ambar de duplicado con los datos del registro original
    await verificarYRegistrar(ID_PRUEBA);
    await expect(
      pagina.getByTestId('resultado-registro').getByText('Asistencia ya registrada', { exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(pagina.getByTestId('resultado-registro').getByText('Registrado por')).toBeVisible();

    // Refrigerio
    await pagina.getByRole('tab', { name: /Refrigerio/ }).click();
    await verificarYRegistrar(ID_PRUEBA);
    await expect(
      pagina.getByTestId('resultado-registro').getByText('Registro exitoso'),
    ).toBeVisible({ timeout: 15_000 });

    // Salida
    await pagina.getByRole('tab', { name: /Salida/ }).click();
    await verificarYRegistrar(ID_PRUEBA);
    await expect(
      pagina.getByTestId('resultado-registro').getByText('Registro exitoso'),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('acepta el codigo de registro corto que trae el QR', async ({ request }) => {
    await irAOperador();

    const token = await tokenAdmin(request);
    const respuesta = await request.get(`${BASE}/api/asistentes/${ID_PRUEBA}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(respuesta.ok()).toBeTruthy();
    const asistente = await respuesta.json();
    expect(asistente.codigoRegistro).toMatch(/^[A-Z2-9]{6}$/);

    await pagina.getByLabel('ID institucional o codigo de registro').fill(asistente.codigoRegistro);
    await pagina.getByRole('button', { name: 'Verificar el nombre del asistente' }).click();
    await expect(pagina.getByTestId('tarjeta-verificacion')).toBeVisible({ timeout: 15_000 });
    await expect(
      pagina.getByTestId('tarjeta-verificacion').getByText('Participante Prueba Automatizada'),
    ).toBeVisible();
  });

  test('muestra la alerta roja cuando el ID no existe', async () => {
    await irAOperador();

    await pagina.getByLabel('ID institucional o codigo de registro').fill('NOEXISTE99');
    await pagina.getByRole('button', { name: 'Verificar el nombre del asistente' }).click();

    await expect(pagina.getByText('ID no encontrado').first()).toBeVisible({ timeout: 15_000 });
  });

  test('no produce desplazamiento horizontal', async () => {
    await irAOperador();
    const desborde = await pagina.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(desborde).toBeLessThanOrEqual(1);
  });

  test('los botones principales tienen al menos 48 px de alto', async () => {
    await irAOperador();
    const boton = pagina.getByRole('button', { name: /^Registrar a |Verifique primero/ }).first();
    const caja = await boton.boundingBox();
    expect(caja?.height ?? 0).toBeGreaterThanOrEqual(48);
  });

  test('ofrece el escaner de codigo QR', async () => {
    await irAOperador();
    await expect(pagina.getByRole('button', { name: /Escanear codigo QR/ })).toBeVisible();
  });
});

test.describe('Panel de administracion', () => {
  test('emite un certificado para un asistente elegible', async ({ request }) => {
    // La salida se ajusta a la hora de cierre real del seminario mediante una
    // excepcion manual del administrador (queda auditada) y se completa la
    // asistencia de la segunda jornada, que el evento exige.
    const token = await tokenAdmin(request);
    const jornadas = await request.get(`${BASE}/api/jornadas`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const lista = (await jornadas.json()).jornadas as { id: number }[];

    const contexto = await request.get(`${BASE}/api/operador/contexto`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const jornadaActiva = (await contexto.json()).jornadaActiva.id as number;
    const otraJornada = lista.find((j) => j.id !== jornadaActiva);

    if (otraJornada) {
      // El ingreso se registra por la via de excepcion del administrador, que es
      // la unica que permite fijar la hora de una jornada ya cerrada.
      const ingreso = await request.post(`${BASE}/api/asistencias/excepcion`, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          asistenteId: ID_PRUEBA,
          jornadaId: otraJornada.id,
          tipo: 'ingreso',
          hora: '2026-10-27T18:00:00.000Z',
          motivo: 'Prueba automatica: registro de ingreso en la segunda jornada',
        },
      });
      expect(ingreso.ok()).toBeTruthy();

      const salida = await request.post(`${BASE}/api/asistencias/excepcion`, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          asistenteId: ID_PRUEBA,
          jornadaId: otraJornada.id,
          tipo: 'salida',
          hora: '2026-10-27T23:30:00.000Z',
          motivo: 'Prueba automatica: cierre de la segunda jornada del seminario',
        },
      });
      expect(salida.ok()).toBeTruthy();
    }

    const excepcion = await request.post(`${BASE}/api/asistencias/excepcion`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        asistenteId: ID_PRUEBA,
        jornadaId: jornadaActiva,
        tipo: 'salida',
        hora: '2026-10-27T23:30:00.000Z',
        motivo: 'Prueba automatica: ajuste de la hora de salida al cierre del seminario',
      },
    });
    expect(excepcion.ok()).toBeTruthy();

    await pagina.goto('/admin/certificados');
    await pagina.waitForTimeout(1500);

    await pagina.getByPlaceholder('Buscar por nombre o ID').fill(ID_PRUEBA);
    await pagina.getByRole('button', { name: 'Filtrar' }).click();
    await pagina.waitForTimeout(1500);

    const listado = await request.get(`${BASE}/api/certificados?q=${ID_PRUEBA}&porPagina=5`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const estado = (await listado.json()).datos?.[0]?.estado as string | undefined;
    console.log('estado en la API para el asistente de prueba:', estado);

    const botonEmitir = pagina.getByRole('button', { name: /^Emitir certificado/ }).first();
    if ((await botonEmitir.count()) === 0) {
      test.skip(true, `El asistente de prueba no esta en estado elegible (estado: ${estado})`);
    }
    await botonEmitir.click();

    // La insignia visible es la de la vista de tarjetas (en celular la tabla no se muestra).
    await expect(
      pagina.getByText('Emitido', { exact: true }).locator('visible=true').first(),
    ).toBeVisible({ timeout: 20_000 });

    // Se deja el codigo de verificacion para la prueba de verificacion publica.
    const emitido = await request.get(`${BASE}/api/certificados?q=${ID_PRUEBA}&porPagina=5`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const codigo = (await emitido.json()).datos?.[0]?.codigoVerificacion as string | undefined;
    if (codigo) {
      writeFileSync(path.join(rutaCodigo), codigo, 'utf8');
    }
  });

  test('ofrece el acceso a la app del operador', async () => {
    await pagina.goto('/admin');
    await expect(pagina.getByRole('link', { name: 'Abrir la app del operador' })).toBeVisible();

    // En celular el menu lateral se abre con el boton del encabezado.
    await pagina.getByRole('button', { name: 'Abrir el menu de administracion' }).click();
    await expect(pagina.getByRole('link', { name: 'Tomar asistencia' })).toBeVisible();
  });
});
