/**
 * Captura de pantallas para la revision visual (operador en 360 px y panel).
 * Uso: node scripts/capturas.mjs [directorio]
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const base = process.env.BASE ?? 'http://localhost:5173';
const destino = process.argv[2] ?? path.join(process.cwd(), 'capturas');
mkdirSync(destino, { recursive: true });

const navegador = await chromium.launch();
const contexto = await navegador.newContext({
  viewport: { width: 360, height: 640 },
  locale: 'es-CO',
});
const pagina = await contexto.newPage();

await pagina.goto(`${base}/login`);
await pagina.getByLabel('Correo electronico').fill('admin@seminario.local');
await pagina.getByLabel('Contrasena').fill('Seminario2026');
await pagina.getByRole('button', { name: 'Entrar' }).click();
await pagina.waitForURL(/admin/, { timeout: 20_000 });

// Asistente de demostracion con un codigo de registro propio.
const id = 'DEMO0001';
const codigo = await pagina.evaluate(async (nuevoId) => {
  const login = await fetch('http://localhost:3000/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@seminario.local', password: 'Seminario2026' }),
  });
  const { tokenAcceso } = await login.json();
  const alta = await fetch('http://localhost:3000/asistentes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAcceso}` },
    body: JSON.stringify({
      id: nuevoId,
      nombres: 'Mariana',
      apellidos: 'Rodriguez Salazar',
      rol: 'estudiante',
      semestre: 7,
      email: 'mariana.rodriguez@seminario.local',
    }),
  });
  if (alta.ok) return (await alta.json()).codigoRegistro;
  const consulta = await fetch(`http://localhost:3000/asistentes/${nuevoId}`, {
    headers: { Authorization: `Bearer ${tokenAcceso}` },
  });
  return (await consulta.json()).codigoRegistro;
}, id);
console.log('codigo de registro de demostracion:', codigo);

await pagina.goto(`${base}/operador`);
await pagina.waitForTimeout(1200);
await pagina.screenshot({ path: path.join(destino, '01-operador-inicial.png') });

// Verificacion previa con el nombre.
await pagina.getByLabel('ID institucional o codigo de registro').fill(codigo);
await pagina.getByRole('button', { name: 'Verificar el nombre del asistente' }).click();
await pagina.waitForTimeout(1200);
await pagina.screenshot({ path: path.join(destino, '02-operador-verificacion.png') });

// Registro.
await pagina.getByRole('button', { name: /^Registrar a / }).click();
await pagina.waitForTimeout(1500);
await pagina.screenshot({ path: path.join(destino, '03-operador-registro.png') });

// Panel de administracion.
const escritorio = await navegador.newContext({ viewport: { width: 1280, height: 900 } });
const panel = await escritorio.newPage();
await panel.goto(`${base}/login`);
await panel.getByLabel('Correo electronico').fill('admin@seminario.local');
await panel.getByLabel('Contrasena').fill('Seminario2026');
await panel.getByRole('button', { name: 'Entrar' }).click();
await panel.waitForURL(/admin/, { timeout: 20_000 });
await panel.waitForTimeout(1500);
await panel.screenshot({ path: path.join(destino, '04-panel-dashboard.png') });
await panel.goto(`${base}/admin/carnets`);
await panel.waitForTimeout(1200);
await panel.screenshot({ path: path.join(destino, '05-panel-carnets.png') });
await panel.goto(`${base}/admin/certificados`);
await panel.waitForTimeout(1500);
await panel.screenshot({ path: path.join(destino, '06-panel-certificados.png') });

await navegador.close();
console.log('Capturas guardadas en', destino);
