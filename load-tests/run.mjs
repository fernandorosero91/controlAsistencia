/**
 * Ejecutor de las pruebas de carga.
 *
 * Usa k6 si esta disponible en el sistema; si no, ejecuta un planificador
 * equivalente en Node con el mismo informe de resultados (p95, tasa de error,
 * 429 y duplicados), de modo que la verificacion de carga se pueda hacer en
 * cualquier equipo de la coordinacion.
 *
 * Uso: npm run load-test -- [checkin|operadores|dashboard|certificados|todos]
 *
 * `operadores` es el escenario del evento real: quince celulares usando la
 * MISMA cuenta de operador a la vez.
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
const OPERADOR_CORREO = process.env.OPERADOR_CORREO ?? 'operador1@seminario.local';
const OPERADOR_CLAVE = process.env.OPERADOR_CLAVE ?? 'Seminario2026';
const PREFIJO = process.env.PREFIJO_CARGA ?? 'CARGA';

const ESCENARIOS = ['checkin', 'operadores', 'dashboard', 'certificados'];

function encontrarK6() {
  const candidatos = [
    process.env.K6_BIN,
    'k6',
    'C:/Program Files/k6/k6.exe',
    path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WinGet', 'Packages', 'k6'),
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
      env: {
        ...process.env,
        BASE_URL: BASE,
        ADMIN_CORREO: CORREO,
        ADMIN_CLAVE: CLAVE,
        OPERADOR_CORREO,
        OPERADOR_CLAVE,
        PREFIJO_CARGA: PREFIJO,
      },
    },
  );
  return resultado.status ?? 1;
}

async function iniciarSesion(correo, clave) {
  const respuesta = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: correo, password: clave }),
  });
  if (!respuesta.ok) throw new Error(`No se pudo iniciar sesion: ${respuesta.status}`);
  return (await respuesta.json()).tokenAcceso;
}

/** Espera lo que indique el servidor cuando responde 429. */
async function esperarLimite(respuesta) {
  const segundos = Number(respuesta.headers.get('retry-after') ?? 5);
  await new Promise((resolver) => setTimeout(resolver, Math.max(segundos, 1) * 1000));
}

/** Crea en el padron los asistentes ficticios que usa la carga (id PREFIJO#####). */
async function prepararAsistentesDeCarga(token, total) {
  const existentes = await fetch(`${BASE}/asistentes?porPagina=1&q=${PREFIJO}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const datos = await existentes.json();
  if ((datos.total ?? 0) >= total) {
    console.log(`Los asistentes de prueba ya existen (${datos.total}).`);
    return;
  }

  console.log(`Creando ${total} asistentes de prueba para la carga...`);
  let creados = 0;
  let indice = 0;
  while (indice < total) {
    const id = `${PREFIJO}${String(indice).padStart(5, '0')}`;
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
    if (respuesta.status === 429) {
      // El limite del panel es de 600 por minuto: si la creacion del padron se
      // pasa del cupo, se espera la ventana y se continua donde iba.
      await esperarLimite(respuesta);
      continue;
    }
    if (respuesta.ok) creados += 1;
    indice += 1;
  }
  console.log(`Asistentes de prueba creados: ${creados}`);
}

function percentilDe(tiempos, p) {
  return tiempos[Math.min(tiempos.length - 1, Math.floor(tiempos.length * p))] ?? 0;
}

async function enviarIngreso(token, jornadaId, indice, dispositivo = 'carga-node') {
  const id = `${PREFIJO}${String(indice).padStart(5, '0')}`;
  const inicio = Date.now();
  try {
    const respuesta = await fetch(`${BASE}/asistencias/ingreso`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Dispositivo': dispositivo,
      },
      body: JSON.stringify({ asistenteId: id, jornadaId, dispositivo }),
    });
    const cuerpo = await respuesta.json().catch(() => null);
    return { duracion: Date.now() - inicio, estado: respuesta.status, cuerpo };
  } catch (error) {
    return { duracion: Date.now() - inicio, estado: 0, cuerpo: null, error: String(error) };
  }
}

/** Planificador en Node con el mismo objetivo: 600 ingresos en 3 minutos. */
async function planificadorNode(opciones) {
  const duracion = opciones.duracionMs;
  const total = opciones.total;
  const inicio = Date.now();
  const latencias = [];
  let exitos = 0;
  let duplicados = 0;
  let errores = 0;
  let noEncontrados = 0;

  const tokenAcceso = await iniciarSesion(CORREO, CLAVE);

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
  const p95 = percentilDe(tiempos, 0.95);
  const tasaError = latencias.length > 0 ? errores / latencias.length : 0;

  const informe = {
    escenario: 'checkin (planificador Node)',
    totalSolicitudes: latencias.length,
    exitos,
    duplicados,
    noEncontrados,
    errores,
    p50Ms: percentilDe(tiempos, 0.5),
    p95Ms: p95,
    p99Ms: percentilDe(tiempos, 0.99),
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

/**
 * Planificador equivalente al escenario `operadores`: quince celulares con la
 * misma cuenta. Comprueba que los quince inicios de sesion simultaneos pasan y
 * que ningun registro recibe 429.
 */
async function planificadorOperadores(opciones) {
  const dispositivos = Number(process.env.DISPOSITIVOS ?? 15);
  const duracion = opciones.duracionMs;
  const total = opciones.total;

  const logins = await Promise.all(
    Array.from({ length: dispositivos }, () =>
      fetch(`${BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: OPERADOR_CORREO, password: OPERADOR_CLAVE }),
      }),
    ),
  );
  const tokens = [];
  const estadosLogin = [];
  for (const respuesta of logins) {
    estadosLogin.push(respuesta.status);
    if (respuesta.ok) tokens.push((await respuesta.json()).tokenAcceso);
  }
  const loginsCompletos = estadosLogin.every((estado) => estado === 200);

  if (tokens.length === 0) throw new Error('Ningun dispositivo pudo iniciar sesion');

  if (process.env.PREPARAR_CARGA !== '0') {
    const tokenAdmin = await iniciarSesion(CORREO, CLAVE);
    await prepararAsistentesDeCarga(tokenAdmin, total);
  }

  const contexto = await fetch(`${BASE}/operador/contexto`, {
    headers: { Authorization: `Bearer ${tokens[0]}` },
  });
  const datos = await contexto.json();
  const jornadaId = datos.jornadaActiva?.id ?? datos.jornadas?.[0]?.id;

  const inicio = Date.now();
  const latencias = [];
  let exitos = 0;
  let errores = 0;
  let limite = 0;
  const cola = [];
  let enviados = 0;

  while (Date.now() - inicio < duracion || cola.length > 0) {
    const objetivo = Math.min(total, Math.floor(((Date.now() - inicio) / duracion) * total));
    while (enviados < objetivo) {
      const indiceDispositivo = enviados % tokens.length;
      cola.push(
        enviarIngreso(
          tokens[indiceDispositivo],
          jornadaId,
          enviados,
          `node-celular-${indiceDispositivo + 1}`,
        ),
      );
      enviados += 1;
    }
    if (cola.length > 0) {
      const lote = cola.splice(0, cola.length);
      for (const resultado of await Promise.all(lote)) {
        latencias.push(resultado.duracion);
        if (resultado.estado === 429) limite += 1;
        else if (resultado.estado >= 500 || resultado.error) errores += 1;
        else if (resultado.cuerpo?.resultado === 'exito') exitos += 1;
      }
    }
    await new Promise((resolver) => setTimeout(resolver, 250));
  }

  const tiempos = latencias.sort((a, b) => a - b);
  const p95 = percentilDe(tiempos, 0.95);
  const tasaError = latencias.length > 0 ? errores / latencias.length : 0;

  const informe = {
    escenario: 'operadores con cuenta compartida (planificador Node)',
    dispositivos,
    loginsCompletos,
    estadosLogin,
    totalSolicitudes: latencias.length,
    exitos,
    respuestas429: limite,
    errores,
    p50Ms: percentilDe(tiempos, 0.5),
    p95Ms: p95,
    p99Ms: percentilDe(tiempos, 0.99),
    tasaError: Number((tasaError * 100).toFixed(3)),
    criterios: {
      losQuinceIniciaronSesion: loginsCompletos,
      p95Menor300ms: p95 < 300,
      tasaErrorMenor1PorCiento: tasaError < 0.01,
      ceroRespuestas429: limite === 0,
    },
  };
  console.log(JSON.stringify(informe, null, 2));
  const cumple = Object.values(informe.criterios).every(Boolean);
  return cumple ? 0 : 1;
}

const escenarioPedido = (process.argv[2] ?? 'todos').toLowerCase();
const binario = encontrarK6();

if (!ESCENARIOS.includes(escenarioPedido) && escenarioPedido !== 'todos') {
  console.error(`Escenario desconocido: ${escenarioPedido}`);
  process.exit(1);
}

if (binario) {
  console.log(`k6 encontrado en: ${binario}`);

  // Las pruebas que registran asistencia necesitan el padron y una jornada
  // vigente. Se prepara aqui para que `npm run load-test` funcione solo.
  if (['checkin', 'operadores', 'todos'].includes(escenarioPedido)) {
    if (process.env.PREPARAR_CARGA !== '0') {
      const tokenAdmin = await iniciarSesion(CORREO, CLAVE);
      await prepararAsistentesDeCarga(tokenAdmin, Number(process.env.TOTAL_CHECKINS ?? 600));
    }
  }

  let estado = 0;
  for (const escenario of escenarioPedido === 'todos' ? ESCENARIOS : [escenarioPedido]) {
    estado = ejecutarK6(binario, escenario) || estado;
  }
  process.exit(estado);
}

console.log('k6 no esta instalado: se usa el planificador equivalente en Node.');
console.log('Para usar k6: https://grafana.com/docs/k6/latest/set-up/install-k6/');

const total = Number(process.env.TOTAL_CHECKINS ?? 600);
const minutos = Number(process.env.PREMISA_MINUTOS ?? 3);

let estado = 0;
if (escenarioPedido === 'operadores') {
  estado = await planificadorOperadores({ duracionMs: minutos * 60 * 1000, total });
} else if (escenarioPedido === 'checkin' || escenarioPedido === 'todos') {
  estado = await planificadorNode({ duracionMs: minutos * 60 * 1000, total });
}
process.exit(estado);
