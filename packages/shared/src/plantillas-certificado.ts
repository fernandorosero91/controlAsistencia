import { z } from 'zod';
import { ROLES_ASISTENTE } from './enums.js';

/**
 * Modulo de generacion de certificados en formato DOCX a partir de una plantilla.
 *
 * Reproduce el flujo del script de escritorio (CertificateCreator.py): se toma un
 * documento base .docx y se reemplazan los campos del titular en el XML, para
 * emitir un archivo por asistente. Los campos reconocidos en la plantilla son:
 *
 *   {{nombre}}          Nombre completo del asistente (mayusculas).
 *   {{cedula}}          Cedula de ciudadania (o el ID si no hay cedula).
 *   {{id}}              ID institucional.
 *   {{rol}}             Estudiante o Docente.
 *   {{semestre}}        Semestre del estudiante.
 */

/** Campos que la plantilla .docx puede contener entre dobles llaves. */
export const CAMPOS_PLANTILLA = [
  'nombre',
  'cedula',
  'id',
  'rol',
  'semestre',
] as const;
export type CampoPlantilla = (typeof CAMPOS_PLANTILLA)[number];

/**
 * Mapeo de los controles de contenido (Content Controls / SDT) de Word hacia los
 * campos del modulo.
 *
 * Las plantillas institucionales no usan `{{campo}}`: usan controles de contenido
 * cuyo `tag`/`alias` describe el dato (por ejemplo "Nombre del estudiante"). El
 * motor reconoce esos titulos y los asocia al campo correspondiente. La clave se
 * normaliza (minusculas, sin tildes, sin espacios repetidos) antes de comparar.
 *
 * Los controles que no aparecen aqui (ciudad, fechas, firmas, etc.) son datos del
 * seminario o de las firmas: no son del titular y se dejan vacios al generar.
 */
export const ALIAS_CONTROL_PLANTILLA: Record<string, CampoPlantilla> = {
  'nombre del estudiante': 'nombre',
  'nombre del alumno': 'nombre',
  nombre: 'nombre',
  'documento de identidad': 'cedula',
  documento: 'cedula',
  cedula: 'cedula',
  'numero de documento': 'cedula',
  'identificacion': 'cedula',
  id: 'id',
  'id institucional': 'id',
  rol: 'rol',
  'rol del asistente': 'rol',
  semestre: 'semestre',
};

/** Normaliza el titulo de un control de contenido para compararlo con los alias. */
export function normalizarTituloControl(titulo: string): string {
  return titulo
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Descripcion legible de cada campo, para mostrar en el panel. */
export const DESCRIPCION_CAMPO_PLANTILLA: Record<CampoPlantilla, string> = {
  nombre: 'Nombre completo del asistente',
  cedula: 'Cedula de ciudadania (o el ID si no hay cedula registrada)',
  id: 'ID institucional',
  rol: 'Rol: Estudiante o Docente',
  semestre: 'Semestre del estudiante',
};

/** Datos de un titular ya resueltos, listos para volcar en la plantilla. */
export interface DatosTitularPlantilla {
  asistenteId: string;
  nombre: string;
  cedula: string;
  id: string;
  rol: string;
  semestre: string;
}

/** Plantilla de certificado almacenada en el sistema. */
export const plantillaCertificadoSchema = z.object({
  id: z.string().uuid(),
  nombre: z.string(),
  nombreArchivo: z.string().nullable(),
  tamanoBytes: z.number().int().nullable(),
  camposDetectados: z.array(z.enum(CAMPOS_PLANTILLA)),
  esPredeterminada: z.boolean(),
  activa: z.boolean(),
  creadoPor: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type PlantillaCertificado = z.infer<typeof plantillaCertificadoSchema>;

export const filtrosPlantillasSchema = z.object({
  soloActivas: z.coerce.boolean().default(false),
});

export type FiltrosPlantillas = z.infer<typeof filtrosPlantillasSchema>;

/** Cuerpo para actualizar los metadatos de una plantilla (renombrar, activar). */
export const actualizarPlantillaSchema = z
  .object({
    nombre: z.string().trim().min(3, 'El nombre es obligatorio').max(120).optional(),
    esPredeterminada: z.boolean().optional(),
    activa: z.boolean().optional(),
  })
  .refine((datos) => Object.keys(datos).length > 0, {
    message: 'No hay cambios por aplicar',
  });

export type ActualizarPlantillaInput = z.infer<typeof actualizarPlantillaSchema>;

/**
 * Regla de elegibilidad del certificado .docx.
 *
 * Un asistente es elegible unicamente si registro su entrada y su salida en
 * TODAS las jornadas del seminario (manana y tarde). Es decir, se exigen las
 * 4 marcas: ingreso y salida de cada una de las 2 jornadas.
 */
export const REGLA_ELEGIBILIDAD_DOCX =
  'Requiere ingreso y salida registrados en cada jornada (manana y tarde)';

/** Seleccion de asistentes para generar certificados desde una plantilla. */
export const generarDesdePlantillaSchema = z.object({
  plantillaId: z.string().uuid('La plantilla no es valida'),
  /** IDs institucionales del padron. Si va vacio y `todos` es true, se usa el padron completo. */
  asistenteIds: z.array(z.string().trim().min(1)).max(2000).optional(),
  todos: z.boolean().default(false),
  rol: z.enum(ROLES_ASISTENTE).optional(),
  /**
   * Exige que el asistente tenga las 4 marcas (ingreso y salida en cada
   * jornada). Por defecto activado: solo se certifica a quien asistio completo.
   */
  soloElegibles: z.boolean().default(true),
  /** Sobrescribe el nombre de archivo base (sin extension) de los .docx generados. */
  prefijoArchivo: z.string().trim().max(60).optional(),
});

export type GenerarDesdePlantillaInput = z.infer<typeof generarDesdePlantillaSchema>;

/** Estado de las 4 marcas exigidas a un asistente para ser elegible. */
export interface MarcasElegibilidad {
  asistenteId: string;
  nombre: string;
  ingresoManana: boolean;
  salidaManana: boolean;
  ingresoTarde: boolean;
  salidaTarde: boolean;
  elegible: boolean;
  motivo: string | null;
}

/** Resultado de una generacion individual o por lote. */
export interface ResumenGeneracion {
  total: number;
  generados: number;
  omitidos: number;
  detalles: { asistenteId: string; nombre: string; archivo: string }[];
  errores: { asistenteId: string; mensaje: string }[];
  /** Marcas por asistente evaluado (permite ver quien quedo fuera y por que). */
  elegibilidad: MarcasElegibilidad[];
}

/** Lote de certificados .docx generados y persistidos en disco. */
export interface LoteCertificados {
  id: string;
  plantillaId: string;
  nombrePlantilla: string;
  carpeta: string;
  archivoZip: string;
  total: number;
  generados: number;
  omitidos: number;
  tamanoZip: number;
  generadoPor: string | null;
  createdAt: string;
}

/**
 * Listado de elegibilidad: para cada asistente del padron (con filtro opcional
 * por rol) indica si tiene las 4 marcas requeridas.
 */
export interface ListadoElegibilidad {
  total: number;
  elegibles: number;
  noElegibles: number;
  jornadasExigidas: string[];
  regla: string;
  datos: MarcasElegibilidad[];
}
