/**
 * Prueba de humo de la API. No es parte del sistema: sirve para verificar
 * manualmente los flujos principales contra una instancia local.
 * Uso: node scripts/prueba-humo.mjs [http://localhost:3000]
 */
const base = process.argv[2] ?? 'http://localhost:3000';
const correo = process.env.ADMIN_EMAIL ?? 'admin@seminario.local';
const clave = process.env.ADMIN_PASSWORD ?? 'Seminario2026';

let fallos = 0;

function comprobar(condicion, descripcion, extra) {
  if (condicion) {
    console.log(`  OK   ${descripcion}`);
  } else {
    fallos += 1;
    console.log(`  FALLA ${descripcion}`, extra ?? '');
  }
}

async function peticion(ruta, opciones = {}) {
  const respuesta = await fetch(`${base}${ruta}`, {
    ...opciones,
    headers: {
      'Content-Type': 'application/json',
      ...(opciones.headers ?? {}),
    },
  });
  const texto = await respuesta.text();
  let cuerpo = null;
  try {
    cuerpo = texto ? JSON.parse(texto) : null;
  } catch {
    cuerpo = texto;
  }
  return { estado: respuesta.status, cuerpo, cabeceras: respuesta.headers };
}

console.log(`Probando la API en ${base}`);

const salud = await peticion('/health/ready');
comprobar(salud.estado === 200 && salud.cuerpo.baseDatos === true, 'health/ready responde 200');

const login = await peticion('/auth/login', {
  method: 'POST',
  body: JSON.stringify({ email: correo, password: clave }),
});
comprobar(login.estado === 200 && Boolean(login.cuerpo.tokenAcceso), 'login devuelve token', login.cuerpo);
const token = login.cuerpo?.tokenAcceso;
if (!token) {
  console.log('No se puede continuar sin token.');
  process.exit(1);
}
const cabeceras = { Authorization: `Bearer ${token}` };

const contexto = await peticion('/operador/contexto', { headers: cabeceras });
comprobar(contexto.estado === 200, 'contexto del operador disponible', contexto.cuerpo);
const jornadaId = contexto.cuerpo?.jornadaActiva?.id ?? contexto.cuerpo?.jornadas?.[0]?.id;
const tipoRefrigerioId = contexto.cuerpo?.refrigerios?.[0]?.id;
comprobar(Boolean(jornadaId), 'existe una jornada disponible');

const noEncontrado = await peticion('/asistencias/ingreso', {
  method: 'POST',
  headers: cabeceras,
  body: JSON.stringify({ asistenteId: 'NOEXISTE99', jornadaId }),
});
comprobar(
  noEncontrado.estado === 200 && noEncontrado.cuerpo.resultado === 'no_encontrado',
  'ID inexistente devuelve alerta roja sin error 500',
  noEncontrado.cuerpo,
);

const configActual = await peticion('/config', { headers: cabeceras });
comprobar(configActual.estado === 200, 'configuracion del seminario disponible');
const config = {
  ...configActual.cuerpo,
  permitirRegistroFueraDeVentana: true,
};
const configGuardada = await peticion('/config', {
  method: 'PUT',
  headers: cabeceras,
  body: JSON.stringify(config),
});
comprobar(
  configGuardada.estado === 200 && configGuardada.cuerpo.permitirRegistroFueraDeVentana === true,
  'el administrador puede abrir el registro fuera de la ventana',
  configGuardada.cuerpo,
);

const ingreso = await peticion('/asistencias/ingreso', {
  method: 'POST',
  headers: cabeceras,
  body: JSON.stringify({ asistenteId: 'EST00001', jornadaId }),
});
comprobar(ingreso.estado === 200 && ingreso.cuerpo.resultado === 'exito', 'primer ingreso: exito', ingreso.cuerpo);

const duplicado = await peticion('/asistencias/ingreso', {
  method: 'POST',
  headers: cabeceras,
  body: JSON.stringify({ asistenteId: 'EST00001', jornadaId }),
});
comprobar(
  duplicado.estado === 200 &&
    duplicado.cuerpo.resultado === 'duplicado' &&
    Boolean(duplicado.cuerpo.existente?.horaIngreso),
  'segundo ingreso: alerta de duplicado con datos del registro original',
  duplicado.cuerpo,
);

const refrigerio = await peticion('/refrigerios/entregar', {
  method: 'POST',
  headers: cabeceras,
  body: JSON.stringify({ asistenteId: 'EST00001', tipoRefrigerioId }),
});
comprobar(
  refrigerio.estado === 200 && refrigerio.cuerpo.resultado === 'exito',
  'refrigerio entregado',
  refrigerio.cuerpo,
);

const refrigerioDuplicado = await peticion('/refrigerios/entregar', {
  method: 'POST',
  headers: cabeceras,
  body: JSON.stringify({ asistenteId: 'EST00001', tipoRefrigerioId }),
});
comprobar(
  refrigerioDuplicado.estado === 200 && refrigerioDuplicado.cuerpo.resultado === 'duplicado',
  'segundo refrigerio: alerta de duplicado',
  refrigerioDuplicado.cuerpo,
);

const dashboard = await peticion('/dashboard/resumen', { headers: cabeceras });
comprobar(dashboard.estado === 200 && dashboard.cuerpo.totalAsistentes === 600, 'dashboard con 600 asistentes');
const etag = dashboard.cabeceras.get('etag');
comprobar(Boolean(etag), 'dashboard entrega ETag');
const condicional = await fetch(`${base}/dashboard/resumen`, {
  headers: { ...cabeceras, 'If-None-Match': etag },
});
comprobar(condicional.status === 304, 'dashboard responde 304 con If-None-Match');

const sinPermiso = await peticion('/certificados');
comprobar(sinPermiso.estado === 401, 'listado de certificados exige autenticacion', sinPermiso.estado);

const noElegible = await peticion('/certificados/emitir/EST00002', {
  method: 'POST',
  headers: cabeceras,
  body: JSON.stringify({ excepcionManual: false }),
});
comprobar(
  noElegible.estado === 409,
  'no se puede emitir certificado a un asistente no elegible',
  noElegible.cuerpo,
);

const conExcepcion = await peticion('/certificados/emitir/EST00002', {
  method: 'POST',
  headers: cabeceras,
  body: JSON.stringify({
    excepcionManual: true,
    motivo: 'Excepcion autorizada por la coordinacion academica para el evento piloto',
  }),
});
comprobar(
  conExcepcion.estado === 200 && Boolean(conExcepcion.cuerpo.codigoVerificacion),
  'certificado emitido con excepcion manual auditada',
  conExcepcion.cuerpo,
);

const codigo = conExcepcion.cuerpo?.codigoVerificacion;
const verificacion = await peticion(`/publico/verificar/${codigo}`);
comprobar(
  verificacion.estado === 200 && verificacion.cuerpo.valido === true,
  'verificacion publica confirma el certificado',
  verificacion.cuerpo,
);

const pdf = await fetch(`${base}/certificados/EST00002/pdf`, { headers: cabeceras });
comprobar(pdf.status === 200 && pdf.headers.get('content-type') === 'application/pdf', 'descarga de PDF admin');

const reporte = await fetch(`${base}/reportes/asistencia?formato=csv`, { headers: cabeceras });
comprobar(reporte.status === 200, 'reporte CSV disponible', reporte.status);

const listado = await peticion('/asistentes?porPagina=5', { headers: cabeceras });
comprobar(listado.estado === 200 && listado.cuerpo.total === 600, 'listado de asistentes paginado');

console.log(fallos === 0 ? '\nTodas las comprobaciones pasaron.' : `\n${fallos} comprobaciones fallaron.`);
process.exit(fallos === 0 ? 0 : 1);
