import { asc, eq } from 'drizzle-orm';
import { cargarEntorno } from '../config/entorno.js';
import { db } from '../db/cliente.js';
import { jornadas, seminarioConfig } from '../db/esquema.js';
import { cache } from './cache.js';
import { errores } from '../plugins/errores.js';
import type { SeminarioConfigInput, Firmante } from '@seminario/shared';

export interface ConfigSeminario {
  nombre: string;
  fecha: string;
  horaFinSeminario: string;
  toleranciaMinutos: number;
  exigirAmbasJornadas: boolean;
  intensidadHoraria: number;
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

/**
 * Determina la jornada que debe venir preseleccionada en la app del operador.
 * Prioridad: la jornada en curso, luego la que tiene abierta la ventana de check-in,
 * luego la mas cercana por iniciar y, como ultimo recurso, la ultima.
 */
export function resolverJornadaActiva(
  lista: JornadaInfo[],
  ahora: Date = new Date(),
): JornadaInfo | null {
  if (lista.length === 0) return null;

  const enCurso = lista.find(
    (j) =>
      new Date(j.inicio).getTime() <= ahora.getTime() &&
      ahora.getTime() <= new Date(j.fin).getTime(),
  );
  if (enCurso) return enCurso;

  const ventanaAbierta = lista.find(
    (j) =>
      new Date(j.ventanaCheckinInicio).getTime() <= ahora.getTime() &&
      ahora.getTime() <= new Date(j.ventanaCheckinFin).getTime(),
  );
  if (ventanaAbierta) return ventanaAbierta;

  const futuras = lista
    .filter((j) => new Date(j.inicio).getTime() > ahora.getTime())
    .sort((a, b) => new Date(a.inicio).getTime() - new Date(b.inicio).getTime());
  if (futuras.length > 0) return futuras[0]!;

  return lista[lista.length - 1]!;
}
