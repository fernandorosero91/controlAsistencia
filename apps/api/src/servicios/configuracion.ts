import { asc, eq } from 'drizzle-orm';
import { cargarEntorno } from '../config/entorno.js';
import { db } from '../db/cliente.js';
import { jornadas, seminarioConfig } from '../db/esquema.js';
import { cache } from './cache.js';
import { errores } from '../plugins/errores.js';
import type { AccesosOperadorInput, SeminarioConfigInput, Firmante } from '@seminario/shared';

export interface ConfigSeminario {
  nombre: string;
  fecha: string;
  horaFinSeminario: string;
  toleranciaMinutos: number;
  exigirAmbasJornadas: boolean;
  intensidadHoraria: number;
  /** Horas minimas de permanencia en cada jornada exigida para el certificado. */
  minimoPermanenciaHoras: number;
  permitirRegistroFueraDeVentana: boolean;
  textoEncabezado: string | null;
  textoCierre: string | null;
  lugar: string | null;
  facultad: string | null;
  contacto: string | null;
  firmaNombre: string | null;
  firmaCargo: string | null;
  firmas: Firmante[];
  idRegex: string;
  urlPublica: string | null;
  /** Modulos visibles en la app del operador. */
  operadorIngresoHabilitado: boolean;
  operadorRefrigerioHabilitado: boolean;
  operadorSalidaHabilitado: boolean;
  /**
   * Minutos despues del cierre de la jornada en los que la jornada sigue
   * vigente, para alcanzar a registrar las salidas.
   */
  margenCierreMinutos: number;
  /** Jornada fijada a mano por el administrador; null = deteccion por horario. */
  jornadaForzadaId: number | null;
}

export interface JornadaInfo {
  id: number;
  nombre: string;
  inicio: string;
  fin: string;
  ventanaCheckinInicio: string;
  ventanaCheckinFin: string;
  orden: number;
}

const CLAVE_CONFIG = 'config:seminario';
const CLAVE_JORNADAS = 'config:jornadas';

function ttlCache(): number {
  return cargarEntorno().CACHE_TTL_MS;
}

export async function obtenerConfig(): Promise<ConfigSeminario> {
  const enCache = await cache.obtener<ConfigSeminario>(CLAVE_CONFIG);
  if (enCache) return enCache;

  const filas = await db.select().from(seminarioConfig).where(eq(seminarioConfig.id, 1)).limit(1);
  const fila = filas[0];
  if (!fila) {
    throw errores.noEncontrado(
      'El seminario no esta configurado. Un administrador debe completar la configuracion inicial.',
    );
  }

  const config: ConfigSeminario = {
    nombre: fila.nombre,
    fecha: fila.fecha,
    horaFinSeminario: fila.horaFinSeminario.toISOString(),
    toleranciaMinutos: fila.toleranciaMinutos,
    exigirAmbasJornadas: fila.exigirAmbasJornadas,
    intensidadHoraria: fila.intensidadHoraria,
    minimoPermanenciaHoras: fila.minimoPermanenciaHoras,
    permitirRegistroFueraDeVentana: fila.permitirRegistroFueraDeVentana,
    textoEncabezado: fila.textoEncabezado,
    textoCierre: fila.textoCierre,
    lugar: fila.lugar,
    facultad: fila.facultad,
    contacto: fila.contacto,
    firmaNombre: fila.firmaNombre,
    firmaCargo: fila.firmaCargo,
    firmas: (fila.firmas ?? []) as Firmante[],
    idRegex: fila.idRegex,
    urlPublica: fila.urlPublica,
    operadorIngresoHabilitado: fila.operadorIngresoHabilitado,
    operadorRefrigerioHabilitado: fila.operadorRefrigerioHabilitado,
    operadorSalidaHabilitado: fila.operadorSalidaHabilitado,
    margenCierreMinutos: fila.margenCierreMinutos,
    jornadaForzadaId: fila.jornadaForzadaId,
  };

  await cache.guardar(CLAVE_CONFIG, config, ttlCache());
  return config;
}

export async function guardarConfig(datos: SeminarioConfigInput): Promise<ConfigSeminario> {
  const fechaIso =
    datos.fecha instanceof Date ? datos.fecha.toISOString().slice(0, 10) : datos.fecha;

  await db
    .insert(seminarioConfig)
    .values({
      id: 1,
      nombre: datos.nombre,
      fecha: fechaIso,
      horaFinSeminario: datos.horaFinSeminario,
      toleranciaMinutos: datos.toleranciaMinutos,
      exigirAmbasJornadas: datos.exigirAmbasJornadas,
      intensidadHoraria: datos.intensidadHoraria,
      minimoPermanenciaHoras: datos.minimoPermanenciaHoras,
      permitirRegistroFueraDeVentana: datos.permitirRegistroFueraDeVentana,
      textoEncabezado: datos.textoEncabezado ?? null,
      textoCierre: datos.textoCierre ?? null,
      lugar: datos.lugar ?? null,
      facultad: datos.facultad ?? null,
      contacto: datos.contacto ?? null,
      firmaNombre: datos.firmaNombre ?? null,
      firmaCargo: datos.firmaCargo ?? null,
      firmas: datos.firmas ?? [],
      idRegex: datos.idRegex,
      urlPublica: datos.urlPublica || null,
    })
    .onConflictDoUpdate({
      target: seminarioConfig.id,
      set: {
        nombre: datos.nombre,
        fecha: fechaIso,
        horaFinSeminario: datos.horaFinSeminario,
        toleranciaMinutos: datos.toleranciaMinutos,
        exigirAmbasJornadas: datos.exigirAmbasJornadas,
        intensidadHoraria: datos.intensidadHoraria,
        minimoPermanenciaHoras: datos.minimoPermanenciaHoras,
        permitirRegistroFueraDeVentana: datos.permitirRegistroFueraDeVentana,
        textoEncabezado: datos.textoEncabezado ?? null,
        textoCierre: datos.textoCierre ?? null,
        lugar: datos.lugar ?? null,
        facultad: datos.facultad ?? null,
        contacto: datos.contacto ?? null,
        firmaNombre: datos.firmaNombre ?? null,
        firmaCargo: datos.firmaCargo ?? null,
        firmas: datos.firmas ?? [],
        idRegex: datos.idRegex,
        urlPublica: datos.urlPublica || null,
      },
    });

  await cache.invalidar(CLAVE_CONFIG);
  return obtenerConfig();
}

export async function listarJornadas(): Promise<JornadaInfo[]> {
  const enCache = await cache.obtener<JornadaInfo[]>(CLAVE_JORNADAS);
  if (enCache) return enCache;

  const filas = await db.select().from(jornadas).orderBy(asc(jornadas.orden), asc(jornadas.inicio));
  const resultado = filas.map((fila) => ({
    id: fila.id,
    nombre: fila.nombre,
    inicio: fila.inicio.toISOString(),
    fin: fila.fin.toISOString(),
    ventanaCheckinInicio: fila.ventanaCheckinInicio.toISOString(),
    ventanaCheckinFin: fila.ventanaCheckinFin.toISOString(),
    orden: fila.orden,
  }));

  await cache.guardar(CLAVE_JORNADAS, resultado, ttlCache());
  return resultado;
}

export async function invalidarCacheConfiguracion(): Promise<void> {
  await cache.invalidar(CLAVE_CONFIG);
  await cache.invalidar(CLAVE_JORNADAS);
}

export type MotivoJornada =
  | 'activa'
  | 'margen_cierre'
  | 'forzada'
  | 'fuera_de_horario'
  | 'sin_jornadas';

export interface JornadaVigente {
  jornada: JornadaInfo | null;
  motivo: MotivoJornada;
  /** Instante hasta el que la jornada sigue vigente (fin + margen de cierre). */
  vigenteHasta: string | null;
  /** Siguiente jornada por iniciar, cuando no hay ninguna vigente. */
  proxima: JornadaInfo | null;
}

/**
 * Determina la jornada vigente a partir del horario del evento.
 *
 * El operador no elige jornada: la decide el reloj del servidor. Una jornada
 * sigue vigente desde su inicio hasta su fin mas un margen de cierre, de modo
 * que las salidas se puedan registrar aunque la sesion ya haya terminado. Si el
 * administrador fijo una jornada a mano, esa manda.
 */
export function resolverJornadaPorHorario(
  lista: JornadaInfo[],
  ahora: Date = new Date(),
  opciones: { jornadaForzadaId?: number | null; margenCierreMinutos?: number } = {},
): JornadaVigente {
  if (lista.length === 0) {
    return { jornada: null, motivo: 'sin_jornadas', vigenteHasta: null, proxima: null };
  }

  if (opciones.jornadaForzadaId) {
    const forzada = lista.find((jornada) => jornada.id === opciones.jornadaForzadaId);
    if (forzada) {
      return { jornada: forzada, motivo: 'forzada', vigenteHasta: null, proxima: null };
    }
  }

  const margenMs = Math.max(opciones.margenCierreMinutos ?? 20, 0) * 60_000;
  const instante = ahora.getTime();
  const inicioDe = (jornada: JornadaInfo) => new Date(jornada.inicio).getTime();
  const finDe = (jornada: JornadaInfo) => new Date(jornada.fin).getTime();

  // Si dos jornadas se solapan se toma la que empezo de ultima.
  const enCurso = lista
    .filter((jornada) => inicioDe(jornada) <= instante && instante <= finDe(jornada))
    .sort((a, b) => inicioDe(b) - inicioDe(a))[0];

  if (enCurso) {
    return {
      jornada: enCurso,
      motivo: 'activa',
      vigenteHasta: new Date(finDe(enCurso) + margenMs).toISOString(),
      proxima: null,
    };
  }

  const enMargen = lista
    .filter((jornada) => finDe(jornada) < instante && instante <= finDe(jornada) + margenMs)
    .sort((a, b) => finDe(b) - finDe(a))[0];

  if (enMargen) {
    return {
      jornada: enMargen,
      motivo: 'margen_cierre',
      vigenteHasta: new Date(finDe(enMargen) + margenMs).toISOString(),
      proxima: null,
    };
  }

  const proxima =
    lista
      .filter((jornada) => inicioDe(jornada) > instante)
      .sort((a, b) => inicioDe(a) - inicioDe(b))[0] ?? null;

  return { jornada: null, motivo: 'fuera_de_horario', vigenteHasta: null, proxima };
}

/**
 * Guarda solo los accesos del operador y la jornada forzada. Se mantiene aparte
 * del guardado general de la configuracion para que los interruptores se puedan
 * cambiar durante el evento sin reenviar todo el formulario.
 */
export async function guardarAccesosOperador(
  datos: AccesosOperadorInput,
): Promise<ConfigSeminario> {
  const cambios = {
    ...(datos.operadorIngresoHabilitado !== undefined
      ? { operadorIngresoHabilitado: datos.operadorIngresoHabilitado }
      : {}),
    ...(datos.operadorRefrigerioHabilitado !== undefined
      ? { operadorRefrigerioHabilitado: datos.operadorRefrigerioHabilitado }
      : {}),
    ...(datos.operadorSalidaHabilitado !== undefined
      ? { operadorSalidaHabilitado: datos.operadorSalidaHabilitado }
      : {}),
    ...(datos.margenCierreMinutos !== undefined
      ? { margenCierreMinutos: datos.margenCierreMinutos }
      : {}),
    ...(datos.jornadaForzadaId !== undefined ? { jornadaForzadaId: datos.jornadaForzadaId } : {}),
  };

  if (Object.keys(cambios).length === 0) return obtenerConfig();

  if (datos.jornadaForzadaId) {
    const existe = await db
      .select({ id: jornadas.id })
      .from(jornadas)
      .where(eq(jornadas.id, datos.jornadaForzadaId))
      .limit(1);
    if (!existe[0]) throw errores.validacion('La jornada indicada no existe');
  }

  await db
    .update(seminarioConfig)
    .set({ ...cambios, updatedAt: new Date() })
    .where(eq(seminarioConfig.id, 1));

  await invalidarCacheConfiguracion();
  return obtenerConfig();
}
