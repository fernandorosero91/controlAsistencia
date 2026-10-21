/**
 * Reglas de negocio puras. Viven en el paquete compartido para que la API y la
 * interfaz usen exactamente la misma definicion y para que las pruebas unitarias
 * no dependan de la base de datos.
 */

import type { RolAsistente } from './enums.js';

/** Expresion regular por defecto del ID institucional. Configurable por el administrador. */
export const ID_REGEX_POR_DEFECTO = '^[A-Z0-9]{4,20}$';

/**
 * Normaliza un ID institucional: recorta, elimina espacios internos y pasa a mayusculas.
 * Es la misma operacion que se aplica al importar y al digitar en la app del operador.
 */
export function normalizarId(valor: string): string {
  return valor.replace(/\s+/g, '').trim().toUpperCase();
}

/** Indica si el ID cumple el formato configurado. */
export function cumpleFormatoId(id: string, regex: string = ID_REGEX_POR_DEFECTO): boolean {
  try {
    return new RegExp(regex).test(id);
  } catch {
    return false;
  }
}

/**
 * El semestre es obligatorio para estudiantes y opcional (nulo) para docentes.
 * Se usa en la validacion de Zod, en la importacion masiva y en la UI.
 */
export function semestreRequerido(rol: RolAsistente): boolean {
  return rol === 'estudiante';
}

export function validarSemestre(
  rol: RolAsistente,
  semestre: number | null | undefined,
): { valido: boolean; mensaje?: string } {
  if (semestreRequerido(rol)) {
    if (semestre === null || semestre === undefined) {
      return { valido: false, mensaje: 'El semestre es obligatorio para estudiantes' };
    }
    if (!Number.isInteger(semestre) || semestre < 1 || semestre > 30) {
      return { valido: false, mensaje: 'El semestre debe ser un numero entero entre 1 y 30' };
    }
  }
  return { valido: true };
}

export const MOTIVOS_INELEGIBILIDAD = [
  'falta_asistencia_jornada',
  'sin_registro_salida',
  'salida_antes_de_hora_fin',
  'sin_jornadas_configuradas',
] as const;

export type MotivoInelegibilidad = (typeof MOTIVOS_INELEGIBILIDAD)[number];

export const MENSAJE_MOTIVO: Record<MotivoInelegibilidad, string> = {
  falta_asistencia_jornada: 'Falta asistencia en una de las jornadas exigidas',
  sin_registro_salida: 'No tiene registro de salida (cierre) en las jornadas exigidas',
  salida_antes_de_hora_fin:
    'El registro de salida es anterior a la hora de fin del seminario dentro de la tolerancia',
  sin_jornadas_configuradas: 'El seminario no tiene jornadas configuradas',
};

export interface JornadaEvaluable {
  id: number;
  fin: Date;
}

export interface AsistenciaEvaluable {
  jornadaId: number;
  horaIngreso: Date;
  horaSalida: Date | null;
}

export interface ParametrosElegibilidad {
  exigirAmbasJornadas: boolean;
  horaFinSeminario: Date;
  toleranciaMinutos: number;
  jornadas: JornadaEvaluable[];
  asistencias: AsistenciaEvaluable[];
}

export interface ResultadoElegibilidad {
  elegible: boolean;
  motivos: MotivoInelegibilidad[];
  jornadasExigidas: number[];
  umbralCierre: Date;
}

/**
 * Calcula la elegibilidad para el certificado.
 *
 * Reglas:
 * 1. Si `exigir_ambas_jornadas` es verdadero se exige asistencia en todas las jornadas.
 *    Si es falso se exige asistencia unicamente en la jornada de cierre (la de fin mas tardio).
 * 2. Se exige al menos un registro de salida dentro de las jornadas exigidas con
 *    `hora_salida >= hora_fin_seminario - tolerancia`.
 *
 * La funcion es pura: cambiar la hora de fin o la tolerancia recalcula el resultado
 * de inmediato, sin necesidad de migraciones ni scripts.
 */
export function evaluarElegibilidad(parametros: ParametrosElegibilidad): ResultadoElegibilidad {
  const toleranciaMs = Math.max(0, parametros.toleranciaMinutos) * 60_000;
  const umbralCierre = new Date(parametros.horaFinSeminario.getTime() - toleranciaMs);
  const motivos: MotivoInelegibilidad[] = [];

  if (parametros.jornadas.length === 0) {
    return {
      elegible: false,
      motivos: ['sin_jornadas_configuradas'],
      jornadasExigidas: [],
      umbralCierre,
    };
  }

  const jornadaCierre = [...parametros.jornadas].sort(
    (a, b) => b.fin.getTime() - a.fin.getTime(),
  )[0]!;

  const jornadasExigidas = parametros.exigirAmbasJornadas
    ? parametros.jornadas.map((j) => j.id)
    : [jornadaCierre.id];

  const porJornada = new Map<number, AsistenciaEvaluable>();
  for (const asistencia of parametros.asistencias) {
    porJornada.set(asistencia.jornadaId, asistencia);
  }

  for (const jornadaId of jornadasExigidas) {
    if (!porJornada.has(jornadaId)) {
      motivos.push('falta_asistencia_jornada');
    }
  }

  const salidasRelevantes = parametros.asistencias.filter(
    (a) =>
      jornadasExigidas.includes(a.jornadaId) &&
      a.horaSalida !== null &&
      a.horaSalida.getTime() >= umbralCierre.getTime(),
  );

  if (salidasRelevantes.length === 0) {
    const tieneAlgunaSalida = parametros.asistencias.some(
      (a) => jornadasExigidas.includes(a.jornadaId) && a.horaSalida !== null,
    );
    motivos.push(tieneAlgunaSalida ? 'salida_antes_de_hora_fin' : 'sin_registro_salida');
  }

  return {
    elegible: motivos.length === 0,
    motivos: [...new Set(motivos)],
    jornadasExigidas,
    umbralCierre,
  };
}

export interface VentanaCheckin {
  inicio: Date;
  fin: Date;
}

export type EstadoVentana = 'abierta' | 'antes' | 'despues';

export function estadoVentanaCheckin(ventana: VentanaCheckin, ahora: Date): EstadoVentana {
  if (ahora.getTime() < ventana.inicio.getTime()) return 'antes';
  if (ahora.getTime() > ventana.fin.getTime()) return 'despues';
  return 'abierta';
}

/**
 * Protege las exportaciones CSV y XLSX contra la inyeccion de formulas.
 * Un texto que empieza por =, +, -, @, tab o retorno de carro se prefija con apostrofo.
 */
export function sanitizarCeldaExportacion(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  const texto = typeof valor === 'string' ? valor : String(valor);
  if (texto.length === 0) return texto;
  const primerCaracter = texto[0]!;
  if (['=', '+', '-', '@', '\t', '\r'].includes(primerCaracter)) {
    return `'${texto}`;
  }
  return texto;
}

/** Genera un codigo de verificacion legible: XXXX-XXXX-XXXX en mayusculas sin caracteres ambiguos. */
export function generarCodigoVerificacion(azar: () => number = Math.random): string {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bloques: string[] = [];
  for (let bloque = 0; bloque < 3; bloque += 1) {
    let texto = '';
    for (let i = 0; i < 4; i += 1) {
      texto += alfabeto[Math.floor(azar() * alfabeto.length)];
    }
    bloques.push(texto);
  }
  return bloques.join('-');
}

/**
 * Alfabeto del codigo de registro: sin O, I, 0 ni 1 para que se pueda dictar
 * sin ambiguedad en un aula con ruido.
 */
export const ALFABETO_CODIGO_REGISTRO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const LONGITUD_CODIGO_REGISTRO = 6;

/**
 * Genera el codigo de registro corto de un asistente: seis caracteres unicos
 * y faciles de escribir. La unicidad definitiva la garantiza el indice unico
 * `asistentes_codigo_registro_idx` de la base de datos.
 */
export function generarCodigoRegistro(azar: () => number = Math.random): string {
  let codigo = '';
  for (let i = 0; i < LONGITUD_CODIGO_REGISTRO; i += 1) {
    codigo += ALFABETO_CODIGO_REGISTRO[Math.floor(azar() * ALFABETO_CODIGO_REGISTRO.length)];
  }
  return codigo;
}

export function esCodigoRegistroValido(valor: string): boolean {
  return new RegExp(`^[${ALFABETO_CODIGO_REGISTRO}]{${LONGITUD_CODIGO_REGISTRO}}$`).test(valor);
}
