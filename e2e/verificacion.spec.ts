import { expect, test } from '@playwright/test';

/**
 * Verificacion de la superficie publica de certificados y del panel en
 * pantallas de escritorio.
 */

const CORREO = process.env.E2E_ADMIN_CORREO ?? 'admin@seminario.local';
const CLAVE = process.env.E2E_ADMIN_CLAVE ?? 'Seminario2026';

test.describe('Verificacion publica de certificados', () => {
  test('confirma un certificado valido y rechaza un codigo inexistente', async ({ page }) => {
    await page.goto('/verificar/ABCD-EFGH-IJKL');
    await expect(page.getByText('Certificado no valido')).toBeVisible({ timeout: 15_000 });

    const codigo = process.env.E2E_CODIGO_CERTIFICADO;
    if (codigo) {
      await page.goto(`/verificar/${codigo}`);
      await expect(page.getByText('Certificado autentico')).toBeVisible({ timeout: 15_000 });
    }
  });
});

test.describe('Panel de administracion en escritorio', () => {
  test('navega entre las secciones y muestra el dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Correo electronico').fill(CORREO);
    await page.getByLabel('Contrasena').fill(CLAVE);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.waitForURL(/\/admin/, { timeout: 20_000 });

    await expect(page.getByText('Asistentes registrados')).toBeVisible();
    await expect(page.getByText('Asistencia por jornada')).toBeVisible();

    await page.getByRole('link', { name: 'Asistentes' }).click();
    await expect(page.getByText('Padron de asistentes')).toBeVisible();

    await page.getByRole('link', { name: 'Reportes' }).click();
    await expect(page.getByText('Reportes del seminario')).toBeVisible();

    await page.getByRole('link', { name: 'Configuracion' }).click();
    await expect(page.getByText('Datos del seminario')).toBeVisible();
  });

  test('el panel no produce desplazamiento horizontal', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Correo electronico').fill(CORREO);
    await page.getByLabel('Contrasena').fill(CLAVE);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.waitForURL(/\/admin/, { timeout: 20_000 });

    const desborde = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(desborde).toBeLessThanOrEqual(1);
  });
});
