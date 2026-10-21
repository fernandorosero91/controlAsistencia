import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { and, asc, count, eq, sql } from 'drizzle-orm';
import {
  evaluarElegibilidad,
  generarCodigoVerificacion,
  MENSAJE_MOTIVO,
  type EstadoCertificadoDetalle,
  type MotivoInelegibilidad,
  type ProgresoLote,
} from '@seminario/shared';
import { cargarEntorno } from '../config/entorno.js';
import { logger } from '../config/log.js';
import { db } from '../db/cliente.js';
import {
  asistencias,
  asistentes,
  certificados,
  certificadosLotes,
  jornadas,
} from '../db/esquema.js';
import { errores } from '../plugins/errores.js';
import { obtenerConfig } from './configuracion.js';
import { generarCertificadoPDF } from './pdf.js';
import { invalidarResumen } from './dashboard.js';

export interface EvaluacionElegibilidad {
  elegible: boolean;
  motivos: MotivoInelegibilidad[];
  mensajes: string[];
}

export async function evaluarElegibilidadAsistente(
  asistenteId: string,
): Promise<EvaluacionElegibilidad> {
  const config = await obtenerConfig();
  const [listaJornadas, listaAsistencias] = await Promise.all([
    db.select().from(jornadas).orderBy(asc(jornadas.orden)),
    db
      .select({
        jornadaId: asistencias.jornadaId,
        horaIngreso: asistencias.horaIngreso,
        horaSalida: asistencias.horaSalida,
      })
      .from(asistencias)
      .where(eq(asistencias.asistenteId, asistenteId)),
  ]);

  const evaluacion = evaluarElegibilidad({
    exigirAmbasJornadas: config.exigirAmbasJornadas,
    horaFinSeminario: new Date(config.horaFinSeminario),
    toleranciaMinutos: config.toleranciaMinutos,
    jornadas: listaJornadas.map((jornada) => ({ id: jornada.id, fin: jornada.fin })),
    asistencias: listaAsistencias.map((asistencia) => ({
      jornadaId: asistencia.jornadaId,
      horaIngreso: asistencia.horaIngreso,
      horaSalida: asistencia.horaSalida,
    })),
  });

  return {
    elegible: evaluacion.elegible,
    motivos: evaluacion.motivos,
    mensajes: evaluacion.motivos.map((motivo) => MENSAJE_MOTIVO[motivo]),
  };
}

export async function listarCertificados(filtros: {
  estado?: 'elegible' | 'no_elegible' | 'emitido' | 'revocado';
  rol?: 'estudiante' | 'docente';
  q?: string;
  pagina: number;
  porPagina: number;
}): Promise<{ datos: EstadoCertificadoDetalle[]; total: number }> {
  const config = await obtenerConfig();
  const [listaJornadas, listaAsistencias, emitidos] = await Promise.all([
    db.select().from(jornadas).orderBy(asc(jornadas.orden)),
    db
      .select({
        asistenteId: asistencias.asistenteId,
        jornadaId: asistencias.jornadaId,
        horaIngreso: asistencias.horaIngreso,
        horaSalida: asistencias.horaSalida,
      })
      .from(asistencias),
    db.select().from(certificados),
  ]);

  const mapaAsistencias = new Map<string, typeof listaAsistencias>();
  for (const asistencia of listaAsistencias) {
    const lista = mapaAsistencias.get(asistencia.asistenteId) ?? [];
    lista.push(asistencia);
    mapaAsistencias.set(asistencia.asistenteId, lista);
  }

  const mapaEmitidos = new Map(emitidos.map((certificado) => [certificado.asistenteId, certificado]));

  const condiciones = [eq(asistentes.activo, true)];
  if (filtros.rol) condiciones.push(eq(asistentes.rol, filtros.rol));
  if (filtros.q) {
    const busqueda = `%${filtros.q.toLowerCase()}%`;
    condiciones.push(
      sql`(${asistentes.nombres} || ' ' || ${asistentes.apellidos}) ILIKE ${busqueda} OR ${asistentes.id} ILIKE ${busqueda}`,
    );
  }

  const filas = await db
    .select()
    .from(asistentes)
    .where(and(...condiciones))
    .orderBy(asc(asistentes.apellidos), asc(asistentes.nombres));

  const detalles: EstadoCertificadoDetalle[] = filas.map((fila) => {
    const assists = mapaAsistencias.get(fila.id) ?? [];
    const evaluacion = evaluarElegibilidad({
      exigirAmbasJornadas: config.exigirAmbasJornadas,
      horaFinSeminario: new Date(config.horaFinSeminario),
      toleranciaMinutos: config.toleranciaMinutos,
      jornadas: listaJornadas.map((jornada) => ({ id: jornada.id, fin: jornada.fin })),
      asistencias: assists.map((asistencia) => ({
        jornadaId: asistencia.jornadaId,
        horaIngreso: asistencia.horaIngreso,
        horaSalida: asistencia.horaSalida,
      })),
    });

    const certificado = mapaEmitidos.get(fila.id);
    let estado: EstadoCertificadoDetalle['estado'];
    if (certificado?.revocado) estado = 'revocado';
    else if (certificado) estado = 'emitido';
    else if (evaluacion.elegible) estado = 'elegible';
    else estado = 'no_elegible';

    return {
      asistenteId: fila.id,
      asistenteNombre: `${fila.nombres} ${fila.apellidos}`,
      asistenteIdInstitucional: fila.id,
      rol: fila.rol,
      semestre: fila.semestre,
      estado,
      motivos: evaluacion.motivos,
      certificadoId: certificado?.id ?? null,
      codigoVerificacion: certificado?.codigoVerificacion ?? null,
      emitidoAt: certificado?.emitidoAt.toISOString() ?? null,
      revocado: certificado?.revocado ?? false,
      excepcionManual: certificado?.excepcionManual ?? false,
      motivoExcepcion: certificado?.motivoExcepcion ?? null,
    };
  });

  const filtrados =
    filtros.estado === undefined
      ? detalles
      : detalles.filter((detalle) => detalle.estado === filtros.estado);

  const total = filtrados.length;
  const inicio = (filtros.pagina - 1) * filtros.porPagina;
  return {
    datos: filtrados.slice(inicio, inicio + filtros.porPagina),
    total,
  };
}

function directorioCertificados(): string {
  return path.resolve(process.cwd(), cargarEntorno().CERTIFICADOS_DIR);
}

export async function construirPdfCertificado(
  asistenteId: string,
  codigoVerificacion: string,
): Promise<{ pdf: Buffer; hash: string }> {
  const config = await obtenerConfig();
  const entorno = cargarEntorno();

  const filas = await db
    .select()
    .from(asistentes)
    .where(eq(asistentes.id, asistenteId))
    .limit(1);
  const asistente = filas[0];
  if (!asistente) throw errores.noEncontrado('El asistente no existe');

  const base = (config.urlPublica ?? entorno.BASE_URL_PUBLICA).replace(/\/$/, '');
  const pdf = await generarCertificadoPDF({
    nombre: `${asistente.nombres} ${asistente.apellidos}`,
    id: asistente.id,
    rol: asistente.rol === 'estudiante' ? 'estudiante' : 'docente',
    nombreSeminario: config.nombre,
    fecha: new Date(config.fecha).toLocaleDateString('es-CO', {
      timeZone: 'America/Bogota',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    }),
    intensidadHoraria: config.intensidadHoraria,
    textoEncabezado: config.textoEncabezado,
    textoCierre: config.textoCierre,
    firmaNombre: config.firmaNombre,
    firmaCargo: config.firmaCargo,
    codigoVerificacion,
    urlVerificacion: `${base}/verificar/${codigoVerificacion}`,
  });

  const buffer = Buffer.from(pdf);
  const hash = createHash('sha256').update(buffer).digest('hex');
  return { pdf: buffer, hash };
}

export async function emitirCertificado(
  asistenteId: string,
  adminId: string,
  opciones: { excepcionManual?: boolean; motivo?: string; loteId?: string; regenerar?: boolean } = {},
): Promise<{ codigoVerificacion: string; certificadoId: string; yaExistia: boolean }> {
  const existente = await db
    .select()
    .from(certificados)
    .where(eq(certificados.asistenteId, asistenteId))
    .limit(1);

  const actual = existente[0];
  if (actual && !opciones.regenerar) {
    throw errores.conflicto(
      'El asistente ya tiene un certificado emitido. Use la opcion de regenerar para actualizarlo.',
    );
  }

  const evaluacion = await evaluarElegibilidadAsistente(asistenteId);
  if (!evaluacion.elegible && !opciones.excepcionManual) {
    throw errores.conflicto(
      `El asistente no es elegible: ${evaluacion.mensajes.join('; ')}. ` +
        'Registre una excepcion manual con motivo para emitirlo de todas formas.',
    );
  }
  if (!evaluacion.elegible && opciones.excepcionManual && !opciones.motivo) {
    throw errores.validacion('La excepcion manual exige un motivo obligatorio');
  }

  const codigoVerificacion = actual?.codigoVerificacion ?? (await generarCodigoUnico());
  const { pdf, hash } = await construirPdfCertificado(asistenteId, codigoVerificacion);

  if (actual) {
    await db
      .update(certificados)
      .set({
        hashPdf: hash,
        emitidoAt: new Date(),
        emitidoPor: adminId,
        revocado: false,
        motivoRevocacion: null,
        excepcionManual: opciones.excepcionManual ?? actual.excepcionManual,
        motivoExcepcion: opciones.motivo ?? actual.motivoExcepcion,
        loteId: opciones.loteId ?? actual.loteId,
      })
      .where(eq(certificados.id, actual.id));

    await guardarPdf(actual.id, pdf);
    await invalidarResumen();
    return { codigoVerificacion, certificadoId: actual.id, yaExistia: true };
  }

  const insertados = await db
    .insert(certificados)
    .values({
      asistenteId,
      codigoVerificacion,
      emitidoPor: adminId,
      hashPdf: hash,
      excepcionManual: opciones.excepcionManual ?? false,
      motivoExcepcion: opciones.motivo ?? null,
      loteId: opciones.loteId ?? null,
    })
    .returning({ id: certificados.id });

  const certificadoId = insertados[0]!.id;
  await guardarPdf(certificadoId, pdf);
  await invalidarResumen();
  return { codigoVerificacion, certificadoId, yaExistia: false };
}

async function generarCodigoUnico(): Promise<string> {
  for (let intento = 0; intento < 12; intento += 1) {
    const codigo = generarCodigoVerificacion();
    const existente = await db
      .select({ id: certificados.id })
      .from(certificados)
      .where(eq(certificados.codigoVerificacion, codigo))
      .limit(1);
    if (existente.length === 0) return codigo;
  }
  throw errores.conflicto('No fue posible generar un codigo de verificacion unico');
}

async function guardarPdf(certificadoId: string, pdf: Buffer): Promise<void> {
  const directorio = directorioCertificados();
  await mkdir(directorio, { recursive: true });
  await writeFile(path.join(directorio, `${certificadoId}.pdf`), pdf);
}

export async function obtenerPdfCertificado(
  asistenteId: string,
): Promise<{ pdf: Buffer; codigoVerificacion: string; emitidoAt: Date }> {
  const filas = await db
    .select()
    .from(certificados)
    .where(
      and(eq(certificados.asistenteId, asistenteId), eq(certificados.revocado, false)),
    )
    .limit(1);
  const certificado = filas[0];
  if (!certificado) throw errores.noEncontrado('El asistente no tiene un certificado vigente');

  const ruta = path.join(directorioCertificados(), `${certificado.id}.pdf`);
  try {
    const pdf = await readFile(ruta);
    const hash = createHash('sha256').update(pdf).digest('hex');
    if (hash !== certificado.hashPdf) {
      const regenerado = await construirPdfCertificado(asistenteId, certificado.codigoVerificacion);
      await guardarPdf(certificado.id, regenerado.pdf);
      return {
        pdf: regenerado.pdf,
        codigoVerificacion: certificado.codigoVerificacion,
        emitidoAt: certificado.emitidoAt,
      };
    }
    return {
      pdf,
      codigoVerificacion: certificado.codigoVerificacion,
      emitidoAt: certificado.emitidoAt,
    };
  } catch {
    const regenerado = await construirPdfCertificado(asistenteId, certificado.codigoVerificacion);
    await guardarPdf(certificado.id, regenerado.pdf);
    return {
      pdf: regenerado.pdf,
      codigoVerificacion: certificado.codigoVerificacion,
      emitidoAt: certificado.emitidoAt,
    };
  }
}

export async function revocarCertificado(
  certificadoId: string,
  motivo: string,
  adminId: string,
): Promise<void> {
  const filas = await db
    .select()
    .from(certificados)
    .where(eq(certificados.id, certificadoId))
    .limit(1);
  const certificado = filas[0];
  if (!certificado) throw errores.noEncontrado('El certificado no existe');
  if (certificado.revocado) throw errores.conflicto('El certificado ya estaba revocado');

  await db
    .update(certificados)
    .set({ revocado: true, motivoRevocacion: motivo, emitidoPor: adminId })
    .where(eq(certificados.id, certificadoId));

  await invalidarResumen();
}

export async function obtenerProgresoLote(loteId: string): Promise<ProgresoLote> {
  const filas = await db
    .select()
    .from(certificadosLotes)
    .where(eq(certificadosLotes.id, loteId))
    .limit(1);
  const lote = filas[0];
  if (!lote) throw errores.noEncontrado('El lote no existe');

  const porcentaje =
    lote.total > 0 ? Math.round(((lote.procesados / lote.total) * 10000) / 100) : 0;

  return {
    id: lote.id,
    estado: lote.estado,
    total: lote.total,
    procesados: lote.procesados,
    exitosos: lote.exitosos,
    fallidos: lote.fallidos,
    porcentaje,
    errores: (lote.errores ?? []) as { asistenteId: string; mensaje: string }[],
    iniciadoAt: lote.iniciadoAt.toISOString(),
    finalizadoAt: lote.finalizadoAt?.toISOString() ?? null,
  };
}

export async function listarAsistentesElegibles(): Promise<string[]> {
  const config = await obtenerConfig();
  const [listaJornadas, listaAsistencias] = await Promise.all([
    db.select().from(jornadas).orderBy(asc(jornadas.orden)),
    db
      .select({
        asistenteId: asistencias.asistenteId,
        jornadaId: asistencias.jornadaId,
        horaIngreso: asistencias.horaIngreso,
        horaSalida: asistencias.horaSalida,
      })
      .from(asistencias),
  ]);

  const mapa = new Map<string, typeof listaAsistencias>();
  for (const asistencia of listaAsistencias) {
    const lista = mapa.get(asistencia.asistenteId) ?? [];
    lista.push(asistencia);
    mapa.set(asistencia.asistenteId, lista);
  }

  const elegibles: string[] = [];
  for (const [asistenteId, lista] of mapa) {
    const evaluacion = evaluarElegibilidad({
      exigirAmbasJornadas: config.exigirAmbasJornadas,
      horaFinSeminario: new Date(config.horaFinSeminario),
      toleranciaMinutos: config.toleranciaMinutos,
      jornadas: listaJornadas.map((jornada) => ({ id: jornada.id, fin: jornada.fin })),
      asistencias: lista.map((asistencia) => ({
        jornadaId: asistencia.jornadaId,
        horaIngreso: asistencia.horaIngreso,
        horaSalida: asistencia.horaSalida,
      })),
    });
    if (evaluacion.elegible) elegibles.push(asistenteId);
  }
  return elegibles;
}

/** Verificacion publica: no expone mas que lo indispensable. */
export async function verificarCodigoPublico(codigo: string): Promise<{
  valido: boolean;
  nombre: string | null;
  rol: string | null;
  seminario: string | null;
  fechaEmision: string | null;
  intensidadHoraria: number | null;
  estado: string | null;
}> {
  const codigoNormalizado = codigo.trim().toUpperCase();
  const filas = await db
    .select({
      codigoVerificacion: certificados.codigoVerificacion,
      emitidoAt: certificados.emitidoAt,
      revocado: certificados.revocado,
      asistenteId: asistentes.id,
      nombres: asistentes.nombres,
      apellidos: asistentes.apellidos,
      rol: asistentes.rol,
    })
    .from(certificados)
    .innerJoin(asistentes, eq(asistentes.id, certificados.asistenteId))
    .where(eq(certificados.codigoVerificacion, codigoNormalizado))
    .limit(1);

  const encontrado = filas[0];
  if (!encontrado) {
    return {
      valido: false,
      nombre: null,
      rol: null,
      seminario: null,
      fechaEmision: null,
      intensidadHoraria: null,
      estado: null,
    };
  }

  const config = await obtenerConfig();
  return {
    valido: !encontrado.revocado,
    nombre: `${encontrado.nombres} ${encontrado.apellidos}`,
    rol: encontrado.rol,
    seminario: config.nombre,
    fechaEmision: encontrado.emitidoAt.toISOString(),
    intensidadHoraria: config.intensidadHoraria,
    estado: encontrado.revocado ? 'revocado' : 'emitido',
  };
}

export async function contarCertificados(): Promise<{ emitidos: number; revocados: number }> {
  const [emitidos] = await db
    .select({ total: count() })
    .from(certificados)
    .where(eq(certificados.revocado, false));
  const [revocados] = await db
    .select({ total: count() })
    .from(certificados)
    .where(eq(certificados.revocado, true));
  return { emitidos: emitidos?.total ?? 0, revocados: revocados?.total ?? 0 };
}
