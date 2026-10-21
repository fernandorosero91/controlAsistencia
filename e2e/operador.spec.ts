import { expect, test, type Page } from '@playwright/test';

/**
 * Flujo completo del operador en un celular de 360 px:
 * iniciar sesion, registrar ingreso por ID, ver la alerta de duplicado,
 * entregar refrigerio, registrar salida y emitir un certificado como admin.
 */

const CORREO = process.env.E2E_ADMIN_CORREO ?? 'admin@seminario.local';
const CLAVE = process.env.E2E_ADMIN_CLAVE ?? 'Seminario2026';

async function iniciarSesion(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Correo electronico').fill(CORREO);
  await page.getByLabel('Contrasena').fill(CLAVE);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(/\/(admin|operador)/, { timeout: 20_000 });
}

async function irAOperador(page: Page): Promise<void> {
  await iniciarSesion(page);
  await page.goto('/operador');
  await expect(page.getByLabel('ID institucional del asistente')).toBeVisible();
}

test.describe('App del operador en 360 px', () => {
  test('registra el ingreso, avisa el duplicado, entrega refrigerio y registra la salida', async ({
    page,
  }) => {
    await irAOperador(page);

    const campoId = page.getByLabel('ID institucional del asistente');
    const idAsistente = process.env.E2E_ASISTENTE_ID ?? 'EST00001';

    // Primer ingreso
    await campoId.fill(idAsistente);
    await page.getByRole('button', { name: 'Registrar', exact: true }).click();
    await expect(page.getByText('Registro exitoso')).toBeVisible({ timeout: 15_000 });

    // El campo queda limpio y enfocado para el siguiente estudiante
    await expect(campoId).toHaveValue('');

    // Segundo intento: alerta ambar de duplicado con los datos del registro original
    await campoId.fill(idAsistente);
    await page.getByRole('button', { name: 'Registrar', exact: true }).click();
    await expect(page.getByText('Asistencia ya registrada')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/ya registraron|Registrado por/)).toBeVisible();

    // Refrigerio
    await page.getByRole('tab', { name: /Refrigerio/ }).click();
    await campoId.fill(idAsistente);
    await page.getByRole('button', { name: 'Registrar', exact: true }).click();
    await expect(page.getByText('Registro exitoso')).toBeVisible({ timeout: 15_000 });

    // Salida
    await page.getByRole('tab', { name: /Salida/ }).click();
    await campoId.fill(idAsistente);
    await page.getByRole('button', { name: 'Registrar', exact: true }).click();
    await expect(page.getByText('Registro exitoso')).toBeVisible({ timeout: 15_000 });
  });

  test('muestra la alerta roja cuando el ID no existe', async ({ page }) => {
    await irAOperador(page);

    await page.getByLabel('ID institucional del asistente').fill('NOEXISTE99');
    await page.getByRole('button', { name: 'Registrar', exact: true }).click();

    await expect(page.getByText('ID no encontrado')).toBeVisible({ timeout: 15_000 });
  });

  test('no produce desplazamiento horizontal', async ({ page }) => {
    await irAOperador(page);
    const desborde = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(desborde).toBeLessThanOrEqual(1);
  });

  test('los botones principales tienen al menos 48 px de alto', async ({ page }) => {
    await irAOperador(page);
    const boton = page.getByRole('button', { name: 'Registrar', exact: true });
    const caja = await boton.boundingBox();
    expect(caja?.height ?? 0).toBeGreaterThanOrEqual(48);
  });
});

test.describe('Panel de administracion', () => {
  test('emite un certificado para un asistente elegible', async ({ page }) => {
    await iniciarSesion(page);
    await page.goto('/admin/certificados');

    await page.getByPlaceholder('Buscar por nombre o ID').fill(process.env.E2E_ASISTENTE_ID ?? 'EST00001');
    await page.getByRole('button', { name: 'Filtrar' }).click();

    const botonEmitir = page.getByRole('button', { name: /^Emitir/ }).first();
    if ((await botonEmitir.count()) === 0) {
      test.skip(true, 'El asistente de prueba no esta en estado elegible');
    }
    await botonEmitir.click();

    // Tras emitir, la fila del asistente pasa a estado "Emitido"
    await expect(page.getByText('Emitido').first()).toBeVisible({ timeout: 20_000 });
  });
});
