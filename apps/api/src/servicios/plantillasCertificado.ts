import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  MENSAJE_MOTIVO,
  REGLA_ELEGIBILIDAD_DOCX,
  evaluarElegibilidad,
  type DatosTitularPlantilla,
  type GenerarDesdePlantillaInput,
  type ListadoElegibilidad,
  type LoteCertificados,
  type MarcasElegibilidad,
  type PlantillaCertificado,
  type ResumenGeneracion,
} from '@seminario/shared';
import { cargarEntorno } from '../config/entorno.js';
import { db } from '../db/cliente.js';
import {
  asistencias,
  asistentes,
  jornadas,
  lotesCertificadosDocx,
  plantillasCertificado,
} from '../db/esquema.js';
import { errores } from '../plugins/errores.js';
import { abrirPlantilla, generarDocx } from './plantillaDocx.js';
import { obtenerConfig } from './configuracion.js';

/** Sanitiza un texto para usarlo como nombre de archivo. */
function nombreArchivoSeguro(valor: string): string {
  const limpio = valor
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase();
  return limpio.length > 0 ? limpio.slice(0, 80) : 'CERTIFICADO';
}

function directorioPlantillas(): string {
  return path.resolve(process.cwd(), cargarEntorno().PLANTILLAS_DIR);
}

function directorioGenerados(): string {
  return path.resolve(process.cwd(), cargarEntorno().CERTIFICADOS_GENERADOS_DIR);
}

function aPlantillaPublica(fila: typeof plantillasCertificado.$inferSelect): PlantillaCertificado {
  return {
    id: fila.id,
    nombre: fila.nombre,
    nombreArchivo: fila.nombreArchivo,
    tamanoBytes: fila.tamanoBytes,
    camposDetectados: (fila.camposDetectados ?? []) as PlantillaCertificado['camposDetectados'],
    esPredeterminada: fila.esPredeterminada,
    activa: fila.activa,
    creadoPor: fila.creadoPor,
    createdAt: fila.createdAt.toISOString(),
    updatedAt: fila.updatedAt.toISOString(),
  };
}

export async function listarPlantillas(soloActivas = false): Promise<PlantillaCertificado[]> {
  const filas = await db
    .select()
    .from(plantillasCertificado)
    .where(soloActivas ? eq(plantillasCertificado.activa, true) : sql`true`)
    .orderBy(asc(plantillasCertificado.createdAt));
  return filas.map(aPlantillaPublica);
}

export async function obtenerPlantilla(id: string): Promise<PlantillaCertificado> {
  const filas = await db
    .select()
    .from(plantillasCertificado)
    .where(eq(plantillasCertificado.id, id))
    .limit(1);
  const fila = filas[0];
  if (!fila) throw errores.noEncontrado('La plantilla no existe');
  return aPlantillaPublica(fila);
}

export interface CrearPlantillaInput {
  nombre: string;
  nombreArchivo: string;
  contenido: Buffer;
  creadoPor: string;
  esPredeterminada?: boolean;
}

/**
 * Guarda en disco una plantilla .docx y valida que el documento sea legible.
 * Al ser la primera plantilla, se marca como predeterminada de forma automatica.
 */
export async function crearPlantilla(input: CrearPlantillaInput): Promise<PlantillaCertificado> {
  const plantilla = await abrirPlantilla(input.contenido).catch((error) => {
    throw errores.validacion(
      error instanceof Error ? error.message : 'El archivo no es una plantilla .docx valida',
    );
  });

  const directorio = directorioPlantillas();
  await mkdir(directorio, { recursive: true });

  const id = randomUUID();
  const hash = createHash('sha256').update(input.contenido).digest('hex').slice(0, 16);
  const ruta = path.join(directorio, `${id}-${hash}.docx`);
  await writeFile(ruta, input.contenido);

  const existentes = await db
    .select({ id: plantillasCertificado.id })
    .from(plantillasCertificado)
    .limit(1);
  const esPredeterminada = input.esPredeterminada ?? existentes.length === 0;

  const insertadas = await db
    .insert(plantillasCertificado)
    .values({
      id,
      nombre: input.nombre,
      nombreArchivo: input.nombreArchivo,
      rutaArchivo: ruta,
      tamanoBytes: input.contenido.length,
      camposDetectados: plantilla.campos,
      esPredeterminada,
      activa: true,
      creadoPor: input.creadoPor,
    })
    .returning();

  // Solo una plantilla puede ser predeterminada: al insertar otra se degrada la anterior.
  if (esPredeterminada) {
    await db
      .update(plantillasCertificado)
      .set({ esPredeterminada: false })
      .where(and(eq(plantillasCertificado.esPredeterminada, true), sql`${plantillasCertificado.id} <> ${id}`));
  }

  return aPlantillaPublica(insertadas[0]!);
}

export interface ActualizarPlantillaDatos {
  nombre?: string;
  esPredeterminada?: boolean;
  activa?: boolean;
}

export async function actualizarPlantilla(
  id: string,
  datos: ActualizarPlantillaDatos,
): Promise<PlantillaCertificado> {
  const filas = await db
    .select()
    .from(plantillasCertificado)
    .where(eq(plantillasCertificado.id, id))
    .limit(1);
  if (!filas[0]) throw errores.noEncontrado('La plantilla no existe');

  if (datos.esPredeterminada === false && filas[0].esPredeterminada) {
    throw errores.conflicto('Debe existir una plantilla predeterminada. Marque otra antes de quitar esta.');
  }

  const actualizadas = await db
    .update(plantillasCertificado)
    .set({
      ...(datos.nombre !== undefined ? { nombre: datos.nombre } : {}),
      ...(datos.esPredeterminada !== undefined ? { esPredeterminada: datos.esPredeterminada } : {}),
      ...(datos.activa !== undefined ? { activa: datos.activa } : {}),
      updatedAt: new Date(),
    })
    .where(eq(plantillasCertificado.id, id))
    .returning();

  if (datos.esPredeterminada === true) {
    await db
      .update(plantillasCertificado)
      .set({ esPredeterminada: false })
      .where(and(eq(plantillasCertificado.esPredeterminada, true), sql`${plantillasCertificado.id} <> ${id}`));
  }

  return aPlantillaPublica(actualizadas[0]!);
}

export async function eliminarPlantilla(id: string): Promise<void> {
  const filas = await db
    .select()
    .from(plantillasCertificado)
    .where(eq(plantillasCertificado.id, id))
    .limit(1);
  const fila = filas[0];
  if (!fila) throw errores.noEncontrado('La plantilla no existe');

  await db.delete(plantillasCertificado).where(eq(plantillasCertificado.id, id));
  await unlink(fila.rutaArchivo).catch(() => undefined);

  // Si se elimino la predeterminada, la plantilla activa mas antigua la reemplaza.
  if (fila.esPredeterminada) {
    const siguientes = await db
      .select({ id: plantillasCertificado.id })
      .from(plantillasCertificado)
      .where(eq(plantillasCertificado.activa, true))
      .orderBy(asc(plantillasCertificado.createdAt))
      .limit(1);
    if (siguientes[0]) {
      await db
        .update(plantillasCertificado)
        .set({ esPredeterminada: true })
        .where(eq(plantillasCertificado.id, siguientes[0].id));
    }
  }
}

/** Convierte una fila del padron al conjunto de campos de la plantilla. */
function datosTitular(fila: typeof asistentes.$inferSelect): DatosTitularPlantilla {
  const cedula = (fila.cedulaCiudadania ?? '').trim();
  const prefijoDocumento = fila.tipoDocumento === 'TI' ? 'T.I.' : 'C.C.';
  return {
    asistenteId: fila.id,
    nombre: `${fila.nombres} ${fila.apellidos}`.replace(/\s+/g, ' ').trim().toUpperCase(),
    cedula: cedula.length > 0 ? `${prefijoDocumento} ${cedula}` : fila.id,
    id: fila.id,
    rol: fila.rol === 'estudiante' ? 'Estudiante' : 'Docente',
    semestre: fila.semestre !== null ? String(fila.semestre) : '',
  };
}

export interface CertificadoGenerado {
  asistenteId: string;
  nombre: string;
  archivo: string;
  contenido: Buffer;
}

/** Jornadas ordenadas (manana = menor `orden`, tarde = mayor `orden`). */
async function jornadasOrdenadas() {
  return db
    .select({ id: jornadas.id, nombre: jornadas.nombre, inicio: jornadas.inicio, fin: jornadas.fin, orden: jornadas.orden })
    .from(jornadas)
    .orderBy(asc(jornadas.orden));
}

interface AsistenciaCruda {
  jornadaId: number;
  horaIngreso: Date;
  horaSalida: Date | null;
}

/**
 * Trae las marcas reales (ingreso y salida con sus horas) de cada asistente,
 * con una sola consulta. La elegibilidad se calcula con la misma funcion que
 * usa el certificado en PDF: las 4 marcas y la permanencia minima por jornada.
 */
async function asistenciasPorAsistente(
  asistenteIds: string[],
): Promise<Map<string, AsistenciaCruda[]>> {
  const mapa = new Map<string, AsistenciaCruda[]>();
  if (asistenteIds.length === 0) return mapa;

  const filas = await db
    .select({
      asistenteId: asistencias.asistenteId,
      jornadaId: asistencias.jornadaId,
      horaIngreso: asistencias.horaIngreso,
      horaSalida: asistencias.horaSalida,
    })
    .from(asistencias)
    .where(inArray(asistencias.asistenteId, asistenteIds));

  for (const fila of filas) {
    const lista = mapa.get(fila.asistenteId) ?? [];
    lista.push({
      jornadaId: fila.jornadaId,
      horaIngreso: fila.horaIngreso,
      horaSalida: fila.horaSalida,
    });
    mapa.set(fila.asistenteId, lista);
  }

  return mapa;
}

interface ConteosAsistencia {
  jornadaId: number;
  ingreso: boolean;
  salida: boolean;
}

/**
 * Cuenta, por asistente, si tiene ingreso y salida registrados en cada jornada.
 * Se resuelve con una sola consulta agregada (sin N+1).
 */
async function conteosPorAsistente(
  asistenteIds: string[],
): Promise<Map<string, Map<number, ConteosAsistencia>>> {
  const mapa = new Map<string, Map<number, ConteosAsistencia>>();
  if (asistenteIds.length === 0) return mapa;

  const filas = await db
    .select({
      asistenteId: asistencias.asistenteId,
      jornadaId: asistencias.jornadaId,
      ingreso: sql<boolean>`${asistencias.horaIngreso} IS NOT NULL`,
      salida: sql<boolean>`${asistencias.horaSalida} IS NOT NULL`,
    })
    .from(asistencias)
    .where(inArray(asistencias.asistenteId, asistenteIds));

  for (const fila of filas) {
    let porJornada = mapa.get(fila.asistenteId);
    if (!porJornada) {
      porJornada = new Map();
      mapa.set(fila.asistenteId, porJornada);
    }
    porJornada.set(fila.jornadaId, {
      jornadaId: fila.jornadaId,
      ingreso: Boolean(fila.ingreso),
      salida: Boolean(fila.salida),
    });
  }
  return mapa;
}

function evaluarMarcas(
  fila: typeof asistentes.$inferSelect,
  conteos: Map<number, ConteosAsistencia> | undefined,
  jornadasTodas: { id: number; nombre: string; fin: Date }[],
  marcasReales: AsistenciaCruda[],
  config: {
    exigirAmbasJornadas: boolean;
    horaFinSeminario: Date;
    toleranciaMinutos: number;
    minimoPermanenciaHoras: number;
  },
): MarcasElegibilidad {
  const nombre = `${fila.nombres} ${fila.apellidos}`.replace(/\s+/g, ' ').trim().toUpperCase();
  const marcas = jornadasTodas.map((jornada) => {
    const conteo = conteos?.get(jornada.id);
    return { jornada, ingreso: conteo?.ingreso ?? false, salida: conteo?.salida ?? false };
  });

  const ingresoManana = marcas[0]?.ingreso ?? false;
  const salidaManana = marcas[0]?.salida ?? false;
  const ingresoTarde = marcas[1]?.ingreso ?? false;
  const salidaTarde = marcas[1]?.salida ?? false;

  // Misma regla para Word y PDF: 4 marcas y permanencia.
  const evaluacion = evaluarElegibilidad({
    exigirAmbasJornadas: config.exigirAmbasJornadas,
    horaFinSeminario: config.horaFinSeminario,
    toleranciaMinutos: config.toleranciaMinutos,
    minimoPermanenciaHoras: config.minimoPermanenciaHoras,
    jornadas: jornadasTodas.map((jornada) => ({ id: jornada.id, fin: jornada.fin })),
    asistencias: marcasReales,
  });

  const faltantes = marcas
    .filter((marca) => evaluacion.jornadasExigidas.includes(marca.jornada.id))
    .flatMap((marca) => {
      const lista: string[] = [];
      if (!marca.ingreso) lista.push(`ingreso ${marca.jornada.nombre}`);
      if (!marca.salida) lista.push(`salida ${marca.jornada.nombre}`);
      return lista;
    });

  const motivo = evaluacion.elegible
    ? null
    : faltantes.length > 0
      ? `Falta: ${faltantes.join(', ')}`
      : evaluacion.motivos.map((item) => MENSAJE_MOTIVO[item]).join('; ');

  return {
    asistenteId: fila.id,
    nombre,
    ingresoManana,
    salidaManana,
    ingresoTarde,
    salidaTarde,
    elegible: evaluacion.elegible,
    motivo,
  };
}

/**
 * Lista la elegibilidad del padron (con filtro opcional por rol). Un asistente
 * es elegible solo si tiene las 4 marcas: ingreso y salida en cada jornada.
 */
export async function listarElegibilidad(filtros: {
  rol?: 'estudiante' | 'docente';
}): Promise<ListadoElegibilidad> {
  const jornadasExigidas = await jornadasOrdenadas();
  const config = await obtenerConfig();

  const condiciones = [eq(asistentes.activo, true)];
  if (filtros.rol) condiciones.push(eq(asistentes.rol, filtros.rol));

  const filas = await db
    .select()
    .from(asistentes)
    .where(and(...condiciones))
    .orderBy(asc(asistentes.apellidos), asc(asistentes.nombres));

  const ids = filas.map((fila) => fila.id);
  const conteos = await conteosPorAsistente(ids);
  const marcasReales = await asistenciasPorAsistente(ids);
  const datos = filas.map((fila) =>
    evaluarMarcas(
      fila,
      conteos.get(fila.id),
      jornadasExigidas,
      marcasReales.get(fila.id) ?? [],
      {
        exigirAmbasJornadas: config.exigirAmbasJornadas,
        horaFinSeminario: new Date(config.horaFinSeminario),
        toleranciaMinutos: config.toleranciaMinutos,
        minimoPermanenciaHoras: config.minimoPermanenciaHoras,
      },
    ),
  );
  const elegibles = datos.filter((dato) => dato.elegible).length;

  return {
    total: datos.length,
    elegibles,
    noElegibles: datos.length - elegibles,
    jornadasExigidas: jornadasExigidas.map((jornada) => jornada.nombre),
    regla: REGLA_ELEGIBILIDAD_DOCX,
    datos,
  };
}

/**
 * Genera los documentos .docx de los asistentes indicados con la plantilla dada.
 *
 * Por defecto solo se certifica a quienes tienen las 4 marcas completas
 * (ingreso y salida en cada jornada). El resumen incluye la evaluacion por
 * asistente para saber quien quedo fuera y por que.
 */
export async function generarCertificados(
  input: GenerarDesdePlantillaInput,
): Promise<{ generados: CertificadoGenerado[]; resumen: ResumenGeneracion }> {
  const plantillas = await db
    .select()
    .from(plantillasCertificado)
    .where(eq(plantillasCertificado.id, input.plantillaId))
    .limit(1);
  const plantillaFila = plantillas[0];
  if (!plantillaFila) throw errores.noEncontrado('La plantilla no existe');
  if (!plantillaFila.activa) throw errores.conflicto('La plantilla esta inactiva');

  const condiciones = [eq(asistentes.activo, true)];
  if (input.rol) condiciones.push(eq(asistentes.rol, input.rol));
  if (!input.todos && input.asistenteIds && input.asistenteIds.length > 0) {
    condiciones.push(inArray(asistentes.id, input.asistenteIds));
  } else if (!input.todos && (!input.asistenteIds || input.asistenteIds.length === 0)) {
    throw errores.validacion('Indique al menos un asistente o marque la opcion de todo el padron');
  }

  const filas = await db
    .select()
    .from(asistentes)
    .where(and(...condiciones))
    .orderBy(asc(asistentes.apellidos), asc(asistentes.nombres));

  if (filas.length === 0) {
    throw errores.conflicto('No hay asistentes que coincidan con la seleccion');
  }

  const jornadasExigidas = await jornadasOrdenadas();
  const config = await obtenerConfig();
  const ids = filas.map((fila) => fila.id);
  const conteos = await conteosPorAsistente(ids);
  const marcasReales = await asistenciasPorAsistente(ids);

  const elegibilidad = filas.map((fila) =>
    evaluarMarcas(
      fila,
      conteos.get(fila.id),
      jornadasExigidas,
      marcasReales.get(fila.id) ?? [],
      {
        exigirAmbasJornadas: config.exigirAmbasJornadas,
        horaFinSeminario: new Date(config.horaFinSeminario),
        toleranciaMinutos: config.toleranciaMinutos,
        minimoPermanenciaHoras: config.minimoPermanenciaHoras,
      },
    ),
  );

  const soloElegibles = input.soloElegibles !== false;
  const aptos = soloElegibles
    ? filas.filter((_, indice) => elegibilidad[indice]!.elegible)
    : filas;

  const contenidoPlantilla = await readFile(plantillaFila.rutaArchivo);
  const plantillaAbierta = await abrirPlantilla(contenidoPlantilla);
  const prefijo = input.prefijoArchivo ? nombreArchivoSeguro(input.prefijoArchivo) : 'CERTIFICADO';

  const generados: CertificadoGenerado[] = [];
  const erroresGeneracion: ResumenGeneracion['errores'] = [];

  for (const fila of aptos) {
    try {
      const datos = datosTitular(fila);
      const contenido = await generarDocx(plantillaAbierta, datos);
      generados.push({
        asistenteId: fila.id,
        nombre: datos.nombre,
        archivo: `${prefijo}-${nombreArchivoSeguro(fila.id)}-${nombreArchivoSeguro(datos.nombre)}.docx`,
        contenido,
      });
    } catch (error) {
      erroresGeneracion.push({
        asistenteId: fila.id,
        mensaje: error instanceof Error ? error.message : 'Error desconocido al generar el documento',
      });
    }
  }

  // Quienes no tienen las 4 marcas se reportan como omitidos con el motivo.
  const omitidosPorElegibilidad = soloElegibles
    ? elegibilidad.filter((marca) => !marca.elegible)
    : [];

  const resumen: ResumenGeneracion = {
    total: filas.length,
    generados: generados.length,
    omitidos: omitidosPorElegibilidad.length + erroresGeneracion.length,
    detalles: generados.map((item) => ({
      asistenteId: item.asistenteId,
      nombre: item.nombre,
      archivo: item.archivo,
    })),
    errores: erroresGeneracion,
    elegibilidad,
  };

  return { generados, resumen };
}

function aLotePublico(fila: typeof lotesCertificadosDocx.$inferSelect): LoteCertificados {
  return {
    id: fila.id,
    plantillaId: fila.plantillaId ?? '',
    nombrePlantilla: fila.nombrePlantilla,
    carpeta: fila.carpeta,
    archivoZip: fila.archivoZip,
    total: fila.total,
    generados: fila.generados,
    omitidos: fila.omitidos,
    tamanoZip: fila.tamanoZip ?? 0,
    generadoPor: fila.generadoPor,
    createdAt: fila.createdAt.toISOString(),
  };
}

export interface GenerarLoteInput extends GenerarDesdePlantillaInput {
  generadoPor: string;
}

/**
 * Genera los certificados y los persiste en disco dentro de la carpeta
 * `certificadosGenerados`, empaquetando ademas un ZIP descargable. El lote queda
 * registrado en la base para poder listarlo y descargarlo despues.
 */
export async function generarLotePersistido(
  input: GenerarLoteInput,
): Promise<{ lote: LoteCertificados; resumen: ResumenGeneracion }> {
  const { generados, resumen } = await generarCertificados(input);
  if (generados.length === 0) {
    throw errores.conflicto(
      'No hay asistentes elegibles: se requiere ingreso y salida en cada jornada.',
    );
  }

  const marcaTiempo = new Date().toISOString().replace(/[:.]/g, '-');
  const nombreCarpeta = `lote-${marcaTiempo}`;
  const carpeta = path.join(directorioGenerados(), nombreCarpeta);
  await mkdir(carpeta, { recursive: true });

  const zip = new JSZip();
  for (const certificado of generados) {
    const ruta = path.join(carpeta, certificado.archivo);
    await writeFile(ruta, certificado.contenido);
    zip.file(certificado.archivo, certificado.contenido);
  }
  const contenidoZip = await zip.generateAsync({ type: 'nodebuffer' });
  const archivoZip = path.join(carpeta, 'certificados.zip');
  await writeFile(archivoZip, contenidoZip);

  const plantilla = await db
    .select({ nombre: plantillasCertificado.nombre })
    .from(plantillasCertificado)
    .where(eq(plantillasCertificado.id, input.plantillaId))
    .limit(1);

  const insertadas = await db
    .insert(lotesCertificadosDocx)
    .values({
      plantillaId: input.plantillaId,
      nombrePlantilla: plantilla[0]?.nombre ?? 'Plantilla',
      carpeta,
      archivoZip,
      total: resumen.total,
      generados: resumen.generados,
      omitidos: resumen.omitidos,
      tamanoZip: contenidoZip.length,
      generadoPor: input.generadoPor,
    })
    .returning();

  return { lote: aLotePublico(insertadas[0]!), resumen };
}

export async function listarLotes(): Promise<LoteCertificados[]> {
  const filas = await db
    .select()
    .from(lotesCertificadosDocx)
    .orderBy(sql`${lotesCertificadosDocx.createdAt} DESC`)
    .limit(100);
  return filas.map(aLotePublico);
}

export async function obtenerLote(id: string): Promise<LoteCertificados> {
  const filas = await db
    .select()
    .from(lotesCertificadosDocx)
    .where(eq(lotesCertificadosDocx.id, id))
    .limit(1);
  const fila = filas[0];
  if (!fila) throw errores.noEncontrado('El lote de certificados no existe');
  return aLotePublico(fila);
}

/** Lee el ZIP de un lote desde disco para entregarlo como descarga. */
export async function leerZipLote(id: string): Promise<{ lote: LoteCertificados; contenido: Buffer }> {
  const lote = await obtenerLote(id);
  const contenido = await readFile(lote.archivoZip).catch(() => {
    throw errores.noEncontrado('El archivo del lote no esta disponible en disco');
  });
  return { lote, contenido };
}

/** Elimina del disco la carpeta de un lote y su registro. */
export async function eliminarLote(id: string): Promise<void> {
  const lote = await obtenerLote(id);
  await rm(lote.carpeta, { recursive: true, force: true }).catch(() => undefined);
  await db.delete(lotesCertificadosDocx).where(eq(lotesCertificadosDocx.id, id));
}

/** Lista los archivos .docx de un lote leyendolos desde su carpeta. */
export async function leerArchivosLote(id: string): Promise<string[]> {
  const lote = await obtenerLote(id);
  const entradas = await readdir(lote.carpeta).catch(() => []);
  return entradas.filter((nombre) => nombre.toLowerCase().endsWith('.docx'));
}
