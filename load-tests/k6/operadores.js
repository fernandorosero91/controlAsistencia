import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';
import { Counter, Rate, Trend } from 'k6/metrics';

/**
 * Prueba de carga del escenario real del evento: **quince celulares usando la
 * misma cuenta de operador** al mismo tiempo.
 *
 * Es el caso que antes fallaba: el limite de escaneo se contaba por cuenta, de
 * modo que los quince dispositivos compartian un unico cupo de 150 peticiones
 * por minuto. Con 600 registros en tres minutos (3,3 por segundo, 200 por
 * minuto) ese cupo se agotaba y los operadores recibian 429 en mitad de la
 * fila.
 *
 * El escenario reproduce ademas la peor combinacion para el inicio de sesion:
 * los quince dispositivos entran a la vez, con el mismo correo y desde la
 * misma direccion de red (como si compartieran la red wifi de la sede).
 *
 * Criterios de aceptacion:
 *   - los 15 inicios de sesion responden 200
 *   - p95 de las escrituras por debajo de 300 ms
 *   - tasa de error por debajo del 1 %
 *   - cero respuestas 429 y cero 5xx
 *
 * Antes de ejecutarla debe existir el padron de prueba (ids PREFIJO00000 en
 * adelante) y una jornada vigente: `npm run load-test` lo prepara solo.
 */

const BASE = __ENV.BASE_URL || 'http://localhost:3000';
const CORREO = __ENV.OPERADOR_CORREO || 'operador1@seminario.local';
const CLAVE = __ENV.OPERADOR_CLAVE || 'Seminario2026';
const DISPOSITIVOS = Number(__ENV.DISPOSITIVOS || 15);
const TOTAL_CHECKINS = Number(__ENV.TOTAL_CHECKINS || 600);
const PREFIJO = __ENV.PREFIJO_CARGA || 'CARGA';

export const tiempoIngreso = new Trend('tiempo_ingreso_dispositivo', true);
export const tasaError = new Rate('tasa_error_dispositivo');
export const exitos = new Counter('ingresos_ok');
export const respuestas5xx = new Counter('respuestas_5xx');
export const respuestas429 = new Counter('respuestas_429');
export const loginsOk = new Counter('logins_ok');
export const loginsFallidos = new Counter('logins_fallidos');

export const options = {
  scenarios: {
    dispositivos: {
      // Misma llegada que la prueba de check-in: unas 600 entradas en 3
      // minutos, con la punta de la apertura de puerta.
      executor: 'ramping-arrival-rate',
      startRate: 2,
      timeUnit: '1s',
      preAllocatedVUs: 30,
      maxVUs: 60,
      exec: 'ingresos',
      tags: { escenario: 'dispositivos' },
      stages: [
        { target: 5, duration: '60s' },
        { target: 3, duration: '60s' },
        { target: 1, duration: '60s' },
      ],
    },
  },
  thresholds: {
    'http_req_duration{escenario:dispositivos}': ['p(95)<300'],
    'http_req_failed{escenario:dispositivos}': ['rate<0.01'],
    'checks{escenario:dispositivos}': ['rate>0.99'],
    respuestas_5xx: ['count==0'],
    respuestas_429: ['count==0'],
    logins_fallidos: ['count==0'],
  },
};

export function setup() {
  // Quince inicios de sesion simultaneos con la MISMA cuenta. `http.batch`
  // los envia en paralelo: si el limite de inicio de sesion fuera por IP sin
  // considerar la cuenta, aqui se veria el primer 429.
  const peticiones = Array.from({ length: DISPOSITIVOS }, () => ({
    method: 'POST',
    url: `${BASE}/auth/login`,
    body: JSON.stringify({ email: CORREO, password: CLAVE }),
    params: {
      headers: { 'Content-Type': 'application/json' },
      tags: { escenario: 'login' },
    },
  }));

  const tokens = [];
  let pendientes = DISPOSITIVOS;

  // Dos rondas: si otra prueba se ejecuto hace menos de un minuto, el cupo de
  // inicio de sesion puede estar a medio consumir. Se espera la ventana y se
  // reintentan solo los dispositivos que faltan.
  for (let ronda = 0; ronda < 2 && pendientes > 0; ronda += 1) {
    if (ronda > 0) sleep(65);
    const respuestas = http.batch(peticiones.slice(0, pendientes));
    let conseguidos = 0;
    for (const respuesta of respuestas) {
      if (respuesta.status === 200) {
        tokens.push(respuesta.json('tokenAcceso'));
        conseguidos += 1;
      } else {
        console.error(`Inicio de sesion fallido: ${respuesta.status} ${respuesta.body}`);
      }
    }
    pendientes -= conseguidos;
  }

  loginsOk.add(tokens.length);
  loginsFallidos.add(DISPOSITIVOS - tokens.length);

  if (tokens.length < DISPOSITIVOS) {
    throw new Error(
      `Solo ${tokens.length} de ${DISPOSITIVOS} dispositivos pudieron iniciar sesion con la misma cuenta`,
    );
  }

  const contexto = http.get(`${BASE}/operador/contexto`, {
    headers: { Authorization: `Bearer ${tokens[0]}` },
  });
  const jornadaId = contexto.json('jornadaActiva.id');
  if (!jornadaId) {
    throw new Error('No hay jornada activa. Ajuste el horario de las jornadas antes de la prueba.');
  }

  return { tokens, jornadaId };
}

export function ingresos(datos) {
  const indiceDispositivo = exec.vu.idInTest % datos.tokens.length;
  const dispositivo = `k6-celular-${indiceDispositivo + 1}`;
  const indice = exec.scenario.iterationInTest;
  const id = `${PREFIJO}${String(indice % TOTAL_CHECKINS).padStart(5, '0')}`;

  const respuesta = http.post(
    `${BASE}/asistencias/ingreso`,
    JSON.stringify({ asistenteId: id, jornadaId: datos.jornadaId, dispositivo }),
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${datos.tokens[indiceDispositivo]}`,
        'X-Dispositivo': dispositivo,
      },
      tags: { escenario: 'dispositivos' },
    },
  );

  const cuerpo = respuesta.json();
  const ok = check(respuesta, {
    'el registro responde 200': (r) => r.status === 200,
    'sin limite de tasa (429)': (r) => r.status !== 429,
    'el resultado es valido': () =>
      cuerpo.resultado === 'exito' ||
      cuerpo.resultado === 'duplicado' ||
      cuerpo.resultado === 'no_encontrado',
  });

  tiempoIngreso.add(respuesta.timings.duration);
  if (respuesta.status === 429) {
    respuestas429.add(1);
    tasaError.add(true);
  } else if (respuesta.status >= 500) {
    respuestas5xx.add(1);
    tasaError.add(true);
  } else {
    tasaError.add(!ok);
  }

  if (cuerpo.resultado === 'exito') exitos.add(1);

  sleep(0.2);
}
