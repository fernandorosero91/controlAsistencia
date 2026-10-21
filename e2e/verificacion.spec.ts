import { expect, test, type Browser, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Verificacion publica de certificados y navegacion del panel de administracion.
 * La sesion se inicia una sola vez por archivo, en un contexto propio.
 */

const CORREO = process.env.E2E_ADMIN_CORREO ?? 'admin@seminario.local';
const CLAVE = process.env.E2E_ADMIN_CLAVE ?? 'Seminario2026';

let pagina: Page;

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  const contexto = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: 'es-CO',
  });
  pagina = await contexto.newPage();

  await pagina.goto('/login');
  for (let intento = 1; intento <= 4; intento += 1) {
    await pagina.getByLabel('Correo electronico').fill(CORREO);
    await pagina.getByLabel('Contrasena').fill(CLAVE);
    await pagina.getByRole('button', { name: 'Entrar' }).click();
    const exito = await pagina
      .waitForURL(/\/(admin|operador)/, { timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (exito) break;
    const limite = await pagina.getByText(/limite de solicitudes/i).count();
    if (limite === 0) throw new Error('No se pudo iniciar sesion en la prueba');
    await pagina.waitForTimeout(20_000);
  }
});

test.afterAll(async () => {
  await pagina?.context().close();
});

test.describe('Verificacion publica de certificados', () => {
  test('rechaza un codigo que no existe', async () => {
    await pagina.goto('/verificar/ABCD-EFGH-IJKL');
    await expect(pagina.getByText('Certificado no valido')).toBeVisible({ timeout: 15_000 });
  });

  test('confirma un certificado emitido', async () => {
    const ruta = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '.auth',
      'codigo-certificado.txt',
    );
    const codigo =
      process.env.E2E_CODIGO_CERTIFICADO ??
      (existsSync(ruta) ? readFileSync(ruta, 'utf8').trim() : '');
    test.skip(!codigo, 'No hay un certificado emitido de la prueba anterior');
    await pagina.goto(`/verificar/${codigo}`);
    await expect(pagina.getByText('Certificado autentico')).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('Panel de administracion en escritorio', () => {
  test('navega entre las secciones', async () => {
    await pagina.goto('/admin');
    await expect(pagina.getByText('Asistentes registrados')).toBeVisible({ timeout: 15_000 });
    await expect(pagina.getByText('Asistencia por jornada')).toBeVisible();

    await pagina.getByRole('link', { name: 'Asistentes' }).click();
    await expect(pagina.getByText('Padron de asistentes')).toBeVisible();

    await pagina.getByRole('link', { name: 'Importar' }).click();
    await expect(pagina.getByText('Importacion masiva de asistentes')).toBeVisible();

    await pagina.getByRole('link', { name: 'Carnets y QR' }).click();
    await expect(pagina.getByText('Carnets y escarapelas con QR')).toBeVisible();

    await pagina.getByRole('link', { name: 'Reportes' }).click();
    await expect(pagina.getByText('Reportes del seminario')).toBeVisible();

    await pagina.getByRole('link', { name: 'Configuracion' }).click();
    await expect(pagina.getByText('Datos del seminario')).toBeVisible();

    await pagina.getByRole('link', { name: 'Usuarios' }).click();
    await expect(pagina.getByText('Usuarios del sistema')).toBeVisible();
  });

  test('el panel no produce desplazamiento horizontal', async () => {
    await pagina.goto('/admin');
    const desborde = await pagina.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(desborde).toBeLessThanOrEqual(1);
  });
});
