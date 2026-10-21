import { z } from 'zod';
import { ROLES_ASISTENTE } from './enums.js';

export const filaAsistenteImportadaSchema = z.object({
  id: z.string().min(1, 'El ID es obligatorio').max(32),
  nombres: z.string().min(1, 'Los nombres son obligatorios').max(80),
  apellidos: z.string().min(1, 'Los apellidos son obligatorios').max(80),
  rol: z.enum(ROLES_ASISTENTE),
  semestre: z.union([z.number().int().min(1).max(30), z.null()]).optional(),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Correo electronico invalido')
    .max(120)
    .optional()
    .or(z.literal('')),
});

export type FilaAsistenteImportada = z.infer<typeof filaAsistenteImportadaSchema>;

export const errorImportacionSchema = z.object({
  fila: z.number().int(),
  campo: z.string().nullable(),
  mensaje: z.string(),
  valor: z.string().nullable(),
});

export type ErrorImportacion = z.infer<typeof errorImportacionSchema>;

export const vistaPreviaImportacionSchema = z.object({
  totalFilas: z.number().int(),
  filasValidas: z.number().int(),
  filasConError: z.number().int(),
  nuevos: z.number().int(),
  actualizados: z.number().int(),
  duplicadosEnArchivo: z.number().int(),
  /**
   * Todas las filas del archivo, no solo una muestra: el panel devuelve las
   * filas completas para poder confirmar la importacion de los ~600 asistentes.
   * La tabla de la interfaz muestra solo las primeras, pero el boton de
   * importar envia el archivo entero.
   */
  filas: z.array(
    z.object({
      fila: z.number().int(),
      datos: filaAsistenteImportadaSchema.partial(),
      errores: z.array(errorImportacionSchema),
    }),
  ),
});

export type VistaPreviaImportacion = z.infer<typeof vistaPreviaImportacionSchema>;

export const confirmarImportacionSchema = z.object({
  filas: z.array(
    z.object({
      fila: z.number().int(),
      id: z.string().min(1).max(32),
      nombres: z.string().min(1).max(80),
      apellidos: z.string().min(1).max(80),
      rol: z.enum(ROLES_ASISTENTE),
      semestre: z.union([z.number().int().min(1).max(30), z.null()]).optional(),
      email: z
        .string()
        .trim()
        .toLowerCase()
        .email('Correo electronico invalido')
        .max(120)
        .optional()
        .or(z.literal('')),
    }),
  ),
  modo: z.enum(['crear_actualizar', 'solo_nuevos']).default('crear_actualizar'),
});

export type ConfirmarImportacionInput = z.infer<typeof confirmarImportacionSchema>;
