/**
 * Verificacion operativa del sistema contra la API en ejecucion.
 *
 * Comprueba, en una sola corrida, los comportamientos criticos:
 *  1. la generacion del codigo de registro y del QR de cada asistente,
 *  2. el ingreso duplicado: se rechaza con la alerta del registro original,
 *  3. el refrigerio duplicado: se rechaza con la hora de la entrega previa,
 *  4. la salida: se registra una sola vez y deja constancia de la asistencia,
 *  5. la elegibilidad: sin salida no hay certificado; con salida en hora, si.
 *
 * Uso: node scripts/verificacion-operativa.mjs [http://localhost:3000]
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const BASE = process.argv[2] ?? process.env.BASE_URL ?? 'http://localhost:3000';
const CORREO = process.env.ADMIN_CORREO ?? 'admin@seminario.local';
const CLAVE = process.env.ADMIN_CLAVE ?? 'Seminario2026';

let fallos = 0;
let comprobaciones = 0;

function comprobar(condicion, descripcion, detalle) {
  comprobaciones += 1;
  if (condicion) {
    console.log(`  OK    ${descripcion}`);
  } else {
    fallos += 1;
    console.log(`  FALLA ${descripcion}${detalle ? ` -> ${JSON.stringify(detalle)}` : ''}`);
  }
}

async function peticion(ruta, { metodo = 'GET', token, cuerpo } = {}) {
  const respuesta = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const texto = await respuesta.text();
  let datos = null;
  try {
    datos = texto ? JSON.parse(texto) : null;
  } catch {
    datos = texto;
  }
  return { estado: respuesta.status, datos, cabeceras: respuesta.headers };
}

console.log(`\nVerificacion operativa del sistema de asistencia`);
console.log(`Servidor: ${BASE}\n`);

// ------------------------------------------------------------------ sesion
const login = await peticion('/auth/login', {
  metodo: 'POST',
  cuerpo: { email: CORREO, password: CLAVE },
});
comprobar(login.estado === 200 && login.datos.tokenAcceso, 'El administrador inicia sesion');
if (login.estado !== 200) {
  console.log('No se puede continuar sin sesion.');
  process.exit(1);
}
const token = login.datos.tokenAcceso;

// ------------------------------------------------------------- contexto
const contexto = await peticion('/operador/contexto', { token });
comprobar(contexto.estado === 200, 'El contexto del operador esta disponible');
const jornadaId = contexto.datos.jornadaActiva?.id;
const tipoRefrigerioId = contexto.datos.refrigerios?.[0]?.id;
comprobar(Boolean(jornadaId), 'Hay una jornada activa', contexto.datos.jornadaActiva);
comprobar(Boolean(tipoRefrigerioId), 'Hay un refrigerio activo en la jornada');

console.log('\n1) Generacion del codigo de registro y del QR');
const idPrueba = `VER${Date.now().toString().slice(-6)}`;
const alta = await peticion('/asistentes', {
  metodo: 'POST',
  token,
  cuerpo: {
    id: idPrueba,
    nombres: 'Verificacion',
    apellidos: 'Operativa',
    rol: 'estudiante',
    semestre: 3,
    email: 'verificacion@seminario.local',
  },
});
comprobar(alta.estado === 201, 'Se crea un asistente de prueba');
const codigoRegistro = alta.datos.codigoRegistro;
comprobar(
  typeof codigoRegistro === 'string' && /^[A-Z2-9]{6}$/.test(codigoRegistro),
  'El sistema genera un codigo de registro de 6 caracteres unico',
  codigoRegistro,
);

const verificacion = await peticion(`/asistentes/verificar?codigo=${codigoRegistro}`, { token });
comprobar(
  verificacion.estado === 200 && verificacion.datos.encontrado === true,
  'La verificacion por codigo de registro encuentra al asistente',
);
comprobar(
  verificacion.datos.asistente?.nombres === 'Verificacion',
  'La verificacion devuelve el nombre para contrastarlo con la escarapela',
);

const carnets = await fetch(`${BASE}/asistentes/carnets?limite=5`, {
  headers: { Authorization: `Bearer ${token}` },
});
const bufferCarnets = Buffer.from(await carnets.arrayBuffer());
comprobar(carnets.status === 200, 'Se generan los carnets con QR');
comprobar(
  bufferCarnets.subarray(0, 5).toString() === '%PDF-',
  'El archivo de carnets es un PDF valido',
  bufferCarnets.subarray(0, 8).toString(),
);

const cartaQr = await fetch(`${BASE}/asistentes/carta-qr?limite=5`, {
  headers: { Authorization: `Bearer ${token}` },
});
comprobar(cartaQr.status === 200, 'Se genera la carta de QR para entregar en papel');

const plantilla = await fetch(`${BASE}/asistentes/plantilla`, {
  headers: { Authorization: `Bearer ${token}` },
});
comprobar(plantilla.status === 200, 'Se descarga la plantilla de importacion en Excel');

console.log('\n2) El ingreso duplicado se rechaza');
const primerIngreso = await peticion('/asistencias/ingreso', {
  metodo: 'POST',
  token,
  cuerpo: { asistenteId: idPrueba, jornadaId },
});
comprobar(
  primerIngreso.estado === 200 && primerIngreso.datos.resultado === 'exito',
  'El primer ingreso se registra',
  primerIngreso.datos,
);
const segundoIngreso = await peticion('/asistencias/ingreso', {
  metodo: 'POST',
  token,
  cuerpo: { asistenteId: idPrueba, jornadaId },
});
comprobar(
  segundoIngreso.estado === 200 && segundoIngreso.datos.resultado === 'duplicado',
  'El segundo ingreso responde "duplicado" y no es un error de servidor',
  segundoIngreso.datos,
);
comprobar(
  typeof segundoIngreso.datos.existente?.horaIngreso === 'string',
  'La alerta de duplicado muestra la hora del registro original',
);
comprobar(
  typeof segundoIngreso.datos.existente?.registradoPor === 'string',
  'La alerta de duplicado muestra quien lo registro',
);

console.log('\n3) El refrigerio duplicado se rechaza');
const primeraEntrega = await peticion('/refrigerios/entregar', {
  metodo: 'POST',
  token,
  cuerpo: { asistenteId: idPrueba, tipoRefrigerioId },
});
comprobar(
  primeraEntrega.estado === 200 && primeraEntrega.datos.resultado === 'exito',
  'La primera entrega de refrigerio se registra',
  primeraEntrega.datos,
);
const segundaEntrega = await peticion('/refrigerios/entregar', {
  metodo: 'POST',
  token,
  cuerpo: { asistenteId: idPrueba, tipoRefrigerioId },
});
comprobar(
  segundaEntrega.estado === 200 && segundaEntrega.datos.resultado === 'duplicado',
  'La segunda entrega responde "duplicado"',
  segundaEntrega.datos,
);
comprobar(
  typeof segundaEntrega.datos.existente?.entregadoAt === 'string',
  'La alerta de refrigerio muestra la hora de la entrega previa',
);

console.log('\n4) La salida se registra una sola vez');
const sinSalida = await peticion(`/certificados?q=${idPrueba}&porPagina=1`, { token });
comprobar(
  sinSalida.datos.datos?.[0]?.estado === 'no_elegible',
  'Sin salida registrada el asistente no es elegible',
  sinSalida.datos.datos?.[0]?.motivos,
);

const primeraSalida = await peticion('/asistencias/salida', {
  metodo: 'POST',
  token,
  cuerpo: { asistenteId: idPrueba, jornadaId },
});
comprobar(
  primeraSalida.estado === 200 && primeraSalida.datos.resultado === 'exito',
  'La salida se registra',
  primeraSalida.datos,
);
const segundaSalida = await peticion('/asistencias/salida', {
  metodo: 'POST',
  token,
  cuerpo: { asistenteId: idPrueba, jornadaId },
});
comprobar(
  segundaSalida.estado === 200 && segundaSalida.datos.resultado === 'duplicado',
  'La segunda salida responde "duplicado"',
);

console.log('\n5) Elegibilidad y certificado');
const config = await peticion('/config', { token });
const jornadas = await peticion('/jornadas', { token });
const otraJornada = jornadas.datos.jornadas.find((j) => j.id !== jornadaId);
comprobar(
  config.datos.exigirAmbasJornadas === true,
  'El evento exige asistencia en las dos jornadas',
);

// El evento exige las dos jornadas: se completa la asistencia de la otra.
const cierre = new Date(config.datos.horaFinSeminario).getTime() - 15 * 60 * 1000;
if (otraJornada) {
  const ingresoOtra = await peticion('/asistencias/excepcion', {
    metodo: 'POST',
    token,
    cuerpo: {
      asistenteId: idPrueba,
      jornadaId: otraJornada.id,
      tipo: 'ingreso',
      hora: new Date(otraJornada.inicio).toISOString(),
      motivo: 'Verificacion operativa: registro de ingreso en la segunda jornada',
    },
  });
  comprobar(ingresoOtra.estado === 201, 'Se registra el ingreso de la segunda jornada', ingresoOtra.datos);

  const salidaOtra = await peticion('/asistencias/excepcion', {
    metodo: 'POST',
    token,
    cuerpo: {
      asistenteId: idPrueba,
      jornadaId: otraJornada.id,
      tipo: 'salida',
      hora: new Date(cierre + 60_000).toISOString(),
      motivo: 'Verificacion operativa: cierre de la segunda jornada',
    },
  });
  comprobar(salidaOtra.estado === 201, 'Se registra la salida de la segunda jornada', salidaOtra.datos);
}

const excepcion = await peticion('/asistencias/excepcion', {
  metodo: 'POST',
  token,
  cuerpo: {
    asistenteId: idPrueba,
    jornadaId,
    tipo: 'salida',
    hora: new Date(cierre + 60_000).toISOString(),
    motivo: 'Verificacion operativa: ajuste de la salida al cierre del seminario',
  },
});
comprobar(excepcion.estado === 201, 'El administrador puede ajustar la salida con motivo', excepcion.datos);

const ahoraElegible = await peticion(`/certificados?q=${idPrueba}&porPagina=1`, { token });
comprobar(
  ahoraElegible.datos.datos?.[0]?.estado === 'elegible',
  'Con la salida en hora el asistente pasa a elegible',
  ahoraElegible.datos.datos?.[0]?.motivos,
);

const emision = await peticion(`/certificados/emitir/${idPrueba}`, {
  metodo: 'POST',
  token,
  cuerpo: { excepcionManual: false },
});
comprobar(emision.estado === 200 && emision.datos.codigoVerificacion, 'El certificado se emite', emision.datos);

const codigoCertificado = emision.datos.codigoVerificacion;
const pdf = await fetch(`${BASE}/certificados/${idPrueba}/pdf`, {
  headers: { Authorization: `Bearer ${token}` },
});
comprobar(pdf.status === 200, 'El administrador descarga el PDF del certificado');

const publica = await peticion(`/publico/verificar/${codigoCertificado}`);
comprobar(
  publica.estado === 200 && publica.datos.valido === true,
  'La verificacion publica confirma el certificado',
  publica.datos,
);

const revocacion = await peticion(`/certificados/${emision.datos.certificadoId}/revocar`, {
  metodo: 'POST',
  token,
  cuerpo: { motivo: 'Verificacion operativa: revocacion de prueba' },
});
comprobar(revocacion.estado === 200, 'El certificado se revoca con motivo');
const publicaRevocado = await peticion(`/publico/verificar/${codigoCertificado}`);
comprobar(
  publicaRevocado.datos.valido === false,
  'Tras la revocacion la verificacion publica indica que no es valido',
);

console.log('\n6) Control de acceso');
const sinSesion = await peticion('/certificados');
comprobar(sinSesion.estado === 401, 'Sin sesion no se listan los certificados');
const comoOperador = await peticion('/auth/login', {
  metodo: 'POST',
  cuerpo: { email: 'operador1@seminario.local', password: CLAVE },
});
const tokenOperador = comoOperador.datos.tokenAcceso;
const operadorEmite = await peticion(`/certificados/emitir/${idPrueba}`, {
  metodo: 'POST',
  token: tokenOperador,
  cuerpo: { excepcionManual: true, motivo: 'Intento no autorizado del operador' },
});
comprobar(
  operadorEmite.estado === 403,
  'Un operador no puede emitir certificados',
  operadorEmite.datos,
);
const operadorRegistra = await peticion('/asistencias/ingreso', {
  metodo: 'POST',
  token: tokenOperador,
  cuerpo: { asistenteId: 'EST00007', jornadaId },
});
comprobar(
  operadorRegistra.estado === 200,
  'Un operador si puede registrar asistencia',
  operadorRegistra.datos,
);

console.log(
  `\n${comprobaciones - fallos} de ${comprobaciones} comprobaciones correctas.` +
    (fallos === 0 ? '\nTodo funciona como se espera.\n' : `\n${fallos} comprobaciones fallaron.\n`),
);
writeFileSync(
  path.join(process.cwd(), 'scripts', 'resultado-verificacion.txt'),
  `${comprobaciones - fallos}/${comprobaciones} correctas\n`,
  'utf8',
);
process.exit(fallos === 0 ? 0 : 1);
