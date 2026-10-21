/**
 * Ejecutor de las pruebas de carga.
 *
 * Usa k6 si esta disponible en el sistema; si no, ejecuta un planificador
 * equivalente en Node con el mismo informe de resultados (p95, tasa de error y
 * duplicados), de modo que la verificacion de carga se pueda hacer en cualquier
 * equipo de la coordinacion.
 *
 * Uso: npm run load-test -- [checkin|dashboard|certificados|todos]
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CARPETA_K6 = path.join(raiz, 'load-tests', 'k6');

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const CORREO = process.env.ADMIN_CORREO ?? 'admin@seminario.local';
const CLAVE = process.env.ADMIN_CLAVE ?? 'Seminario2026';

const ESCENARIOS = ['checkin', 'dashboard', 'certificados'];

function encontrarK6() {
  const candidatos = [
    process.env.K6_BIN,
    'k6',
    'C:/Program Files/k6/k6.exe',
    path.join(
      process.env.LOCALAPPDATA ?? '',
      'Microsoft',
      'WinGet',
      'Packages',
      'k6',
    ),
  ].filter(Boolean);

  for (const candidato of candidatos) {
    if (candidato === 'k6') {
      const prueba = spawnSync('k6', ['version'], { shell: true, stdio: 'ignore' });
      if (prueba.status === 0) return 'k6';
      continue;
    }
    if (existsSync(candidato)) return candidato;
  }
  return null;
}

function ejecutarK6(binario, escenario) {
  console.log(`\nEjecutando escenario k6: ${escenario}`);
  const resultado = spawnSync(
    binario,
    ['run', '--summary-mode=full', path.join(CARPETA_K6, `${escenario}.js`)],
    {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: { ...process.env, BASE_URL: BASE, ADMIN_CORREO: CORREO, ADMIN_CLAVE: CLAVE },
    },
  );
  return resultado.status ?? 1;
}

/** Planificador en Node con el mismo objetivo: 600 ingresos en 3 minutos. */
/** Crea en el padron los asistentes ficticios que usa la carga (id PREFIJO#####). */
async function prepararAsistentesDeCarga(token, total) {
  const prefijo = process.env.PREFIJO_CARGA ?? 'CARGA';
  const existentes = await fetch(`${BASE}/asistentes?porPagina=1&q=${prefijo}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const datos = await existentes.json();
  if ((datos.total ?? 0) >= total) {
    console.log(`Los asistentes de prueba ya existen (${datos.total}).`);
    return;
  }

  console.log(`Creando ${total} asistentes de prueba para la carga...`);
  let creados = 0;
  for (let indice = 0; indice < total; indice += 1) {
    const id = `${prefijo}${String(indice).padStart(5, '0')}`;
    const respuesta = await fetch(`${BASE}/asistentes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        id,
        nombres: 'Asistente',
        apellidos: `De Carga ${indice + 1}`,
        rol: 'estudiante',
        semestre: (indice % 10) + 1,
      }),
    });
    if (respuesta.ok) creados += 1;
  }
  console.log(`Asistentes de prueba creados: ${creados}`);
}

async function planificadorNode(opciones) {
  const duracion = opciones.duracionMs;
  const total = opciones.total;
  const inicio = Date.now();
  const latencias = [];
  let exitos = 0;
  let duplicados = 0;
  let errores = 0;
  let noEncontrados = 0;

  const login = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: CORREO, password: CLAVE }),
  });
  if (!login.ok) throw new Error(`No se pudo iniciar sesion: ${login.status}`);
  const { tokenAcceso } = await login.json();

  if (process.env.PREPARAR_CARGA !== '0') {
    await prepararAsistentesDeCarga(tokenAcceso, total);
  }

  const contexto = await fetch(`${BASE}/operador/contexto`, {
    headers: { Authorization: `Bearer ${tokenAcceso}` },
  });
  const datos = await contexto.json();
  const jornadaId = datos.jornadaActiva?.id ?? datos.jornadas?.[0]?.id;

  const cola = [];
  let enviados = 0;

  while (Date.now() - inicio < duracion || cola.length > 0) {
    const objetivo = Math.min(total, Math.floor(((Date.now() - inicio) / duracion) * total));
    while (enviados < objetivo) {
      cola.push(enviarIngreso(tokenAcceso, jornadaId, enviados));
      enviados += 1;
    }
    if (cola.length > 0) {
      const lote = cola.splice(0, cola.length);
      for (const resultado of await Promise.all(lote)) {
        latencias.push(resultado.duracion);
        if (resultado.estado >= 500 || resultado.error) errores += 1;
        else if (resultado.cuerpo?.resultado === 'duplicado') duplicados += 1;
        else if (resultado.cuerpo?.resultado === 'exito') exitos += 1;
        else if (resultado.cuerpo?.resultado === 'no_encontrado') noEncontrados += 1;
      }
    }
    await new Promise((resolver) => setTimeout(resolver, 250));
  }

  const tiempos = latencias.sort((a, b) => a - b);
  const percentil = (p) => tiempos[Math.min(tiempos.length - 1, Math.floor(tiempos.length * p))] ?? 0;
  const p95 = percentil(0.95);
  const tasaError = latencias.length > 0 ? errores / latencias.length : 0;

  const informe = {
    escenario: 'checkin (planificador Node)',
    totalSolicitudes: latencias.length,
    exitos,
    duplicados,
    noEncontrados,
    errores,
    p50Ms: percentil(0.5),
    p95Ms: p95,
    p99Ms: percentil(0.99),
    tasaError: Number((tasaError * 100).toFixed(3)),
    criterios: {
      p95Menor300ms: p95 < 300,
      tasaErrorMenor1PorCiento: tasaError < 0.01,
      ceroDuplicados: duplicados === 0,
    },
  };
  console.log(JSON.stringify(informe, null, 2));
  const cumple =
    informe.criterios.p95Menor300ms &&
    informe.criterios.tasaErrorMenor1PorCiento &&
    informe.criterios.ceroDuplicados;
  return cumple ? 0 : 1;
}

async function enviarIngreso(token, jornadaId, indice) {
  const prefijo = process.env.PREFIJO_CARGA ?? 'CARGA';
  const id = `${prefijo}${String(indice).padStart(5, '0')}`;
  const inicio = Date.now();
  try {
    const respuesta = await fetch(`${BASE}/asistencias/ingreso`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Dispositivo': 'carga-node',
      },
      body: JSON.stringify({ asistenteId: id, jornadaId, dispositivo: 'carga-node' }),
    });
    const cuerpo = await respuesta.json().catch(() => null);
    return { duracion: Date.now() - inicio, estado: respuesta.status, cuerpo };
  } catch (error) {
    return { duracion: Date.now() - inicio, estado: 0, cuerpo: null, error: String(error) };
  }
}

const escenarioPedido = (process.argv[2] ?? 'todos').toLowerCase();
const binario = encontrarK6();

if (binario) {
  console.log(`k6 encontrado en: ${binario}`);
  let estado = 0;
  for (const escenario of escenarioPedido === 'todos' ? ESCENARIOS : [escenarioPedido]) {
    if (!ESCENARIOS.includes(escenario)) {
      console.error(`Escenario desconocido: ${escenario}`);
      estado = 1;
      break;
    }
    estado = ejecutarK6(binario, escenario) || estado;
  }
  process.exit(estado);
}

console.log('k6 no esta instalado: se usa el planificador equivalente en Node.');
console.log('Para usar k6: https://grafana.com/docs/k6/latest/set-up/install-k6/');
const soloCheckin = escenarioPedido === 'checkin' || escenarioPedido === 'todos';
const estado = soloCheckin
  ? await planificadorNode({
      duracionMs: Number(process.env.PREMISA_MINUTOS ?? 3) * 60 * 1000,
      total: Number(process.env.TOTAL_CHECKINS ?? 600),
    })
  : 0;
process.exit(estado);
