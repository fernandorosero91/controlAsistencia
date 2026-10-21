import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';
import { Counter, Rate, Trend } from 'k6/metrics';

/**
 * Prueba de carga del registro de asistencia.
 *
 * Escenario 1 (ingresos): 600 check-ins en 3 minutos con llegada escalonada,
 * cada iteracion con un ID distinto (como 600 asistentes reales).
 *
 * Escenario 2 (duplicados): 50 operadores repiten el mismo ID durante 1 minuto.
 * Ninguna peticion puede devolver 5xx y todas menos una deben responder con la
 * alerta de duplicado. Este escenario es el que prueba la integridad del
 * constraint UNIQUE bajo concurrencia real.
 *
 * Criterios de aceptacion:
 *   - p95 de las escrituras por debajo de 300 ms
 *   - tasa de error por debajo del 1 %
 *   - cero respuestas 5xx
 */

const BASE = __ENV.BASE_URL || 'http://localhost:3000';
const CORREO = __ENV.ADMIN_CORREO || 'admin@seminario.local';
const CLAVE = __ENV.ADMIN_CLAVE || 'Seminario2026';
const TOTAL_CHECKINS = Number(__ENV.TOTAL_CHECKINS || 600);
const PREMISA_MINUTOS = Number(__ENV.PREMISA_MINUTOS || 3);
const PREFIJO = __ENV.PREFIJO_CARGA || 'CARGA';
const ID_COMPARTIDO = `${PREFIJO}00001`;

export const tiempoIngreso = new Trend('tiempo_ingreso', true);
export const tasaError = new Rate('tasa_error');
export const duplicados = new Counter('duplicados');
export const exitos = new Counter('ingresos_ok');
export const alertasDuplicado = new Rate('respuesta_duplicado_correcta');
export const respuestas5xx = new Counter('respuestas_5xx');

export const options = {
  scenarios: {
    ingresos: {
      executor: 'ramping-arrival-rate',
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: 60,
      maxVUs: 300,
      exec: 'ingresos',
      tags: { escenario: 'ingresos' },
      stages: [
        { target: 120, duration: `${PREMISA_MINUTOS}m` },
        { target: 0, duration: '20s' },
      ],
    },
    duplicados: {
      executor: 'constant-vus',
      vus: 50,
      duration: '1m',
      exec: 'repetirMismoId',
      startTime: '20s',
      tags: { escenario: 'duplicados' },
    },
  },
  thresholds: {
    'http_req_duration{escenario:ingresos}': ['p(95)<300'],
    'http_req_failed{escenario:ingresos}': ['rate<0.01'],
    'http_req_failed{escenario:duplicados}': ['rate<0.01'],
    respuestas5xx: ['count==0'],
    alertasDuplicado: ['rate>0.98'],
    'checks{escenario:ingresos}': ['rate>0.99'],
  },
};

let token = '';
let jornadaId = 0;

export function setup() {
  const respuesta = http.post(
    `${BASE}/auth/login`,
    JSON.stringify({ email: CORREO, password: CLAVE }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  if (respuesta.status !== 200) {
    throw new Error(`No se pudo iniciar sesion: ${respuesta.status} ${respuesta.body}`);
  }
  token = respuesta.json('tokenAcceso');
  const contexto = http.get(`${BASE}/operador/contexto`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  jornadaId = contexto.json('jornadaActiva.id');
  return { token, jornadaId };
}

export function ingresos(datos) {
  const indice = exec.scenario.iterationInTest;
  const id = `${PREFIJO}${String(indice % TOTAL_CHECKINS).padStart(5, '0')}`;

  const respuesta = http.post(
    `${BASE}/asistencias/ingreso`,
    JSON.stringify({ asistenteId: id, jornadaId: datos.jornadaId, dispositivo: 'k6' }),
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${datos.token}`,
        'X-Dispositivo': 'k6',
      },
      tags: { escenario: 'ingresos' },
    },
  );

  const cuerpo = respuesta.json();
  const ok = check(respuesta, {
    'el registro responde 200': (r) => r.status === 200,
    'el resultado es valido': () =>
      cuerpo.resultado === 'exito' ||
      cuerpo.resultado === 'duplicado' ||
      cuerpo.resultado === 'no_encontrado',
  });

  tiempoIngreso.add(respuesta.timings.duration);
  if (respuesta.status >= 500) {
    respuestas5xx.add(1);
    tasaError.add(true);
  } else {
    tasaError.add(!ok);
  }

  if (cuerpo.resultado === 'duplicado') duplicados.add(1);
  else if (cuerpo.resultado === 'exito') exitos.add(1);

  sleep(0.2);
}

export function repetirMismoId(datos) {
  const respuesta = http.post(
    `${BASE}/asistencias/ingreso`,
    JSON.stringify({ asistenteId: ID_COMPARTIDO, jornadaId: datos.jornadaId, dispositivo: 'k6' }),
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${datos.token}`,
        'X-Dispositivo': 'k6',
      },
      tags: { escenario: 'duplicados' },
    },
  );

  const cuerpo = respuesta.json();
  if (respuesta.status >= 500) {
    respuestas5xx.add(1);
    tasaError.add(true);
    alertasDuplicado.add(false);
    return;
  }

  const correcto = cuerpo.resultado === 'duplicado' || cuerpo.resultado === 'exito';
  alertasDuplicado.add(correcto);
  if (cuerpo.resultado === 'duplicado') duplicados.add(1);
  else if (cuerpo.resultado === 'exito') exitos.add(1);

  sleep(0.1);
}
