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

/** Seleccion de asistentes para generar certificados desde una plantilla. */
export const generarDesdePlantillaSchema = z.object({
  plantillaId: z.string().uuid('La plantilla no es valida'),
  /** IDs institucionales del padron. Si va vacio y `todos` es true, se usa el padron completo. */
  asistenteIds: z.array(z.string().trim().min(1)).max(2000).optional(),
  todos: z.boolean().default(false),
  rol: z.enum(ROLES_ASISTENTE).optional(),
  /** Exige que el asistente sea elegible para el certificado. */
  soloElegibles: z.boolean().default(false),
  /** Sobrescribe el nombre de archivo base (sin extension) de los .docx generados. */
  prefijoArchivo: z.string().trim().max(60).optional(),
});

export type GenerarDesdePlantillaInput = z.infer<typeof generarDesdePlantillaSchema>;

/** Resultado de una generacion individual o por lote. */
export interface ResumenGeneracion {
  total: number;
  generados: number;
  omitidos: number;
  detalles: { asistenteId: string; nombre: string; archivo: string }[];
  errores: { asistenteId: string; mensaje: string }[];
}
