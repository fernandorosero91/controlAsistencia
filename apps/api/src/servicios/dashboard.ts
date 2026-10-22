import { createHash } from 'node:crypto';
import { count, eq, gte, isNull, sql } from 'drizzle-orm';
import { evaluarElegibilidad, type ResumenDashboard } from '@seminario/shared';
import { cargarEntorno } from '../config/entorno.js';
import { db } from '../db/cliente.js';
import {
  asistencias,
  asistentes,
  certificados,
  entregasRefrigerio,
  jornadas,
  tiposRefrigerio,
} from '../db/esquema.js';
import { cache } from './cache.js';
import { obtenerConfig } from './configuracion.js';

const CLAVE_RESUMEN = 'dashboard:resumen';

/**
 * Calcula el resumen del dashboard con consultas agregadas indexadas.
 * No hay N+1: cada bloque es una consulta de agregacion sobre indices.
 */
export async function calcularResumen(): Promise<ResumenDashboard> {
  const config = await obtenerConfig();
  const ahora = new Date();

  const [totalesAsistentes, totalesDentro, totalesFuera, totalEmitidos, totalRevocados] =
    await Promise.all([
      db.select({ total: count() }).from(asistentes).where(eq(asistentes.activo, true)),
      db.select({ dentro: count() }).from(asistencias).where(isNull(asistencias.horaSalida)),
      db
        .select({ fuera: count() })
        .from(asistencias)
        .where(sql`${asistencias.horaSalida} IS NOT NULL`),
      db.select({ emitidos: count() }).from(certificados).where(eq(certificados.revocado, false)),
      db.select({ revocados: count() }).from(certificados).where(eq(certificados.revocado, true)),
    ]);

  const totalAsistentes = totalesAsistentes[0]?.total ?? 0;
  const dentroAhora = totalesDentro[0]?.dentro ?? 0;
  const fueraAhora = totalesFuera[0]?.fuera ?? 0;
  const emitidos = totalEmitidos[0]?.emitidos ?? 0;
  const revocados = totalRevocados[0]?.revocados ?? 0;

  const [porJornada, porRefrigerio, ritmo, listaJornadas, tipos, asistenciasAsistentes] =
    await Promise.all([
      db
        .select({
          jornadaId: asistencias.jornadaId,
          jornadaNombre: jornadas.nombre,
          ingresos: count(),
          salidas: sql<number>`count(*) FILTER (WHERE ${asistencias.horaSalida} IS NOT NULL)::int`,
        })
        .from(asistencias)
        .innerJoin(jornadas, eq(jornadas.id, asistencias.jornadaId))
        .groupBy(asistencias.jornadaId, jornadas.nombre),
      db
        .select({
          tipoRefrigerioId: entregasRefrigerio.tipoRefrigerioId,
          nombre: tiposRefrigerio.nombre,
          jornadaId: tiposRefrigerio.jornadaId,
          entregados: count(),
        })
        .from(entregasRefrigerio)
        .innerJoin(tiposRefrigerio, eq(tiposRefrigerio.id, entregasRefrigerio.tipoRefrigerioId))
        .groupBy(
          entregasRefrigerio.tipoRefrigerioId,
          tiposRefrigerio.nombre,
          tiposRefrigerio.jornadaId,
        ),
      db
        .select({
          minuto: sql<string>`to_char(date_trunc('minute', ${asistencias.horaIngreso}), 'YYYY-MM-DD"T"HH24:MI')`,
          registros: count(),
        })
        .from(asistencias)
        .where(gte(asistencias.horaIngreso, new Date(ahora.getTime() - 60 * 60 * 1000)))
        .groupBy(sql`date_trunc('minute', ${asistencias.horaIngreso})`)
        .orderBy(sql`date_trunc('minute', ${asistencias.horaIngreso})`),
      db.select().from(jornadas).orderBy(jornadas.orden),
      db
        .select()
        .from(tiposRefrigerio)
        .where(eq(tiposRefrigerio.activo, true))
        .orderBy(tiposRefrigerio.orden),
      db
        .select({
          asistenteId: asistencias.asistenteId,
          jornadaId: asistencias.jornadaId,
          horaIngreso: asistencias.horaIngreso,
          horaSalida: asistencias.horaSalida,
        })
        .from(asistencias),
    ]);

  const mapaJornadas = new Map(porJornada.map((fila) => [fila.jornadaId, fila]));

  const resumenPorJornada = listaJornadas.map((jornada) => {
    const datos = mapaJornadas.get(jornada.id);
    const ingresos = datos?.ingresos ?? 0;
    const salidas = datos?.salidas ?? 0;
    return {
      jornadaId: jornada.id,
      jornadaNombre: jornada.nombre,
      totalAsistentes: totalAsistentes,
      ingresos,
      salidas,
      pendientes: totalAsistentes - ingresos,
      porcentajeAsistencia:
        totalAsistentes > 0 ? Math.round((ingresos / totalAsistentes) * 10000) / 100 : 0,
      dentroAhora: Math.max(ingresos - salidas, 0),
    };
  });

  const mapaRefrigerios = new Map(porRefrigerio.map((fila) => [fila.tipoRefrigerioId, fila]));
  const resumenRefrigerios = tipos.map((tipo) => {
    const entregados = mapaRefrigerios.get(tipo.id)?.entregados ?? 0;
    const posibles = mapaJornadas.get(tipo.jornadaId)?.ingresos ?? 0;
    return {
      tipoRefrigerioId: tipo.id,
      nombre: tipo.nombre,
      jornadaId: tipo.jornadaId,
      entregados,
      pendientes: Math.max(posibles - entregados, 0),
    };
  });

  // Elegibilidad calculada en memoria a partir de las asistencias reales.
  const porAsistente = new Map<string, typeof asistenciasAsistentes>();
  for (const asistencia of asistenciasAsistentes) {
    const lista = porAsistente.get(asistencia.asistenteId) ?? [];
    lista.push(asistencia);
    porAsistente.set(asistencia.asistenteId, lista);
  }

  let elegibles = 0;
  for (const [, lista] of porAsistente) {
    const evaluacion = evaluarElegibilidad({
      exigirAmbasJornadas: config.exigirAmbasJornadas,
      horaFinSeminario: new Date(config.horaFinSeminario),
      toleranciaMinutos: config.toleranciaMinutos,
      minimoPermanenciaHoras: config.minimoPermanenciaHoras,
      jornadas: listaJornadas.map((jornada) => ({ id: jornada.id, fin: jornada.fin })),
      asistencias: lista.map((asistencia) => ({
        jornadaId: asistencia.jornadaId,
        horaIngreso: asistencia.horaIngreso,
        horaSalida: asistencia.horaSalida,
      })),
    });
    if (evaluacion.elegible) elegibles += 1;
  }

  const asistentesConRegistro = porAsistente.size;
  const noElegibles = asistentesConRegistro - elegibles;

  return {
    generadoAt: ahora.toISOString(),
    totalAsistentes,
    porJornada: resumenPorJornada,
    refrigerios: resumenRefrigerios,
    ritmoIngreso: ritmo.map((fila) => ({ minuto: fila.minuto, registros: fila.registros })),
    dentroAhora,
    fueraAhora,
    elegibles,
    noElegibles,
    emitidos,
    revocados,
  };
}

export async function obtenerResumen(): Promise<{ resumen: ResumenDashboard; etag: string }> {
  const entorno = cargarEntorno();
  const enCache = await cache.obtener<ResumenDashboard>(CLAVE_RESUMEN);
  const resumen = enCache ?? (await calcularResumen());
  if (!enCache) {
    await cache.guardar(CLAVE_RESUMEN, resumen, entorno.CACHE_TTL_MS);
  }
  const etag = `"${createHash('sha1').update(JSON.stringify(resumen)).digest('hex')}"`;
  return { resumen, etag };
}

export async function invalidarResumen(): Promise<void> {
  await cache.invalidar(CLAVE_RESUMEN);
}
