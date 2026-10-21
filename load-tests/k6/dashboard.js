import http from 'k6/http';
import { check, sleep } from 'k6';

/**
 * Prueba de carga del dashboard: 10 administradores consultando los indicadores
 * cada 5 segundos, como exige el polling del panel.
 */

const BASE = __ENV.BASE_URL || 'http://localhost:3000';
const CORREO = __ENV.ADMIN_CORREO || 'admin@seminario.local';
const CLAVE = __ENV.ADMIN_CLAVE || 'Seminario2026';

export const options = {
  scenarios: {
    administradores: {
      executor: 'constant-vus',
      vus: 10,
      duration: __ENV.DURACION || '2m',
    },
  },
  thresholds: {
    'http_req_duration{endpoint:dashboard}': ['p(95)<300'],
    'http_req_failed{endpoint:dashboard}': ['rate<0.01'],
    'checks{endpoint:dashboard}': ['rate>0.99'],
  },
};

let token = '';

export function setup() {
  const respuesta = http.post(
    `${BASE}/auth/login`,
    JSON.stringify({ email: CORREO, password: CLAVE }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  token = respuesta.json('tokenAcceso');
  return { token };
}

export default function (datos) {
  const respuesta = http.get(`${BASE}/dashboard/resumen`, {
    headers: { Authorization: `Bearer ${datos.token}` },
    tags: { endpoint: 'dashboard' },
  });

  check(respuesta, {
    'el dashboard responde 200': (r) => r.status === 200,
    'el dashboard trae el total de asistentes': (r) =>
      r.status !== 200 || typeof r.json('totalAsistentes') === 'number',
    'el dashboard entrega ETag': (r) => r.headers['Etag'] !== undefined,
  });

  sleep(5);
}
