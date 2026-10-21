import { defineConfig, devices } from '@playwright/test';

/**
 * Pruebas de extremo a extremo. Incluyen un viewport movil de 360x640, que es
 * el ancho minimo soportado por la app del operador.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    locale: 'es-CO',
    timezoneId: 'America/Bogota',
  },
  projects: [
    {
      name: 'movil-360',
      use: { ...devices['Pixel 5'], viewport: { width: 360, height: 640 } },
      testIgnore: /.*\.desktop\.spec\.ts/,
    },
    {
      name: 'escritorio',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } },
      testMatch: /.*\.desktop\.spec\.ts/,
    },
  ],
});
