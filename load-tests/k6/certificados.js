import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

/**
 * Prueba de carga de la emision masiva de certificados: el administrador lanza
 * el lote y consulta el progreso mientras el proceso genera los PDF.
 */

const BASE = __ENV.BASE_URL || 'http://localhost:3000';
const CORREO = __ENV.ADMIN_CORREO || 'admin@seminario.local';
const CLAVE = __ENV.ADMIN_CLAVE || 'Seminario2026';

export const tiempoProgreso = new Trend('tiempo_consulta_progreso', true);

export const options = {
  scenarios: {
    emision: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 1,
      maxDuration: '10m',
    },
  },
  thresholds: {
    'http_req_duration{endpoint:progreso}': ['p(95)<300'],
    http_req_failed: ['rate<0.01'],
    'checks{endpoint:progreso}': ['rate>0.99'],
  },
};

export function setup() {
  const login = http.post(
    `${BASE}/auth/login`,
    JSON.stringify({ email: CORREO, password: CLAVE }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  const token = login.json('tokenAcceso');
  const cabeceras = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  const lote = http.post(
    `${BASE}/certificados/emitir-lote`,
    JSON.stringify({ soloElegibles: true }),
    {
      headers: cabeceras,
      tags: { endpoint: 'lote' },
    },
  );

  check(lote, {
    'el lote se crea': (r) => r.status === 202,
    'el lote devuelve identificador': (r) => r.json('loteId') !== undefined,
  });

  return { token, loteId: lote.json('loteId') };
}

export default function (datos) {
  const respuesta = http.get(`${BASE}/certificados/lote/${datos.loteId}`, {
    headers: { Authorization: `Bearer ${datos.token}` },
    tags: { endpoint: 'progreso' },
  });

  tiempoProgreso.add(respuesta.timings.duration);

  check(respuesta, {
    'el progreso responde 200': (r) => r.status === 200,
    'el progreso trae porcentaje': (r) => typeof r.json('porcentaje') === 'number',
  });

  const estado = respuesta.json('estado');
  if (estado === 'completado') {
    const descarga = http.get(`${BASE}/certificados/lote/${datos.loteId}/descarga`, {
      headers: { Authorization: `Bearer ${datos.token}` },
      tags: { endpoint: 'descarga' },
    });
    check(descarga, {
      'el ZIP se descarga': (r) => r.status === 200,
    });
    return;
  }

  sleep(2);
}
