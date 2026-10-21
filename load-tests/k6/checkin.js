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
const OPERADORES = Number(__ENV.NUM_OPERADORES || 6);
const TOTAL_CHECKINS = Number(__ENV.TOTAL_CHECKINS || 600);
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
      // Llegada realista: unas 600 entradas en 3 minutos (unos 3,3 por segundo),
      // con una punta al inicio cuando se abre la puerta.
      executor: 'ramping-arrival-rate',
      startRate: 2,
      timeUnit: '1s',
      preAllocatedVUs: 30,
      maxVUs: 120,
      exec: 'ingresos',
      tags: { escenario: 'ingresos' },
      stages: [
        { target: 5, duration: '60s' },
        { target: 3, duration: '60s' },
        { target: 1, duration: '60s' },
      ],
    },
    duplicados: {
      // Varios operadores repiten el mismo ID a la vez: comprueba la alerta de
      // duplicado y que nunca se crea un segundo registro. El ritmo se modera
      // para no disparar el limite de 600 solicitudes por minuto y por operador.
      executor: 'constant-vus',
      vus: 8,
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
    respuestas_5xx: ['count==0'],
    respuesta_duplicado_correcta: ['rate>0.98'],
    'checks{escenario:ingresos}': ['rate>0.99'],
  },
};

export function setup() {
  // Se simulan varios operadores, como en el evento: cada uno tiene su propio
  // limite de solicitudes.
  const tokens = [];
  const cuentas = [CORREO];
  for (let indice = 1; indice <= OPERADORES; indice += 1) {
    cuentas.push(`operador${indice}@seminario.local`);
  }

  for (const cuenta of cuentas) {
    let token = null;
    for (let intento = 0; intento < 4 && token === null; intento += 1) {
      const respuesta = http.post(
        `${BASE}/auth/login`,
        JSON.stringify({ email: cuenta, password: CLAVE }),
        { headers: { 'Content-Type': 'application/json' } },
      );
      if (respuesta.status === 200) {
        token = respuesta.json('tokenAcceso');
        break;
      }
      if (respuesta.status !== 429) {
        throw new Error(`No se pudo iniciar sesion de ${cuenta}: ${respuesta.status}`);
      }
      // El limite de inicio de sesion esta activo: se espera y se reintenta.
      http.sleep(20);
    }
    if (token === null) {
      throw new Error(`No se pudo iniciar sesion de ${cuenta}: limite de intentos alcanzado`);
    }
    tokens.push(token);
  }

  const contexto = http.get(`${BASE}/operador/contexto`, {
    headers: { Authorization: `Bearer ${tokens[0]}` },
  });
  const jornadaId = contexto.json('jornadaActiva.id');
  return { tokens, jornadaId };
}

function tokenDe(datos) {
  return datos.tokens[exec.vu.idInTest % datos.tokens.length];
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
        Authorization: `Bearer ${tokenDe(datos)}`,
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
        Authorization: `Bearer ${tokenDe(datos)}`,
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

  sleep(0.25);
}
