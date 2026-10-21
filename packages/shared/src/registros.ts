import { z } from 'zod';
import { RESULTADOS_REGISTRO, ROLES_ASISTENTE } from './enums.js';

export const identificadorAsistenteSchema = z.object({
  asistenteId: z.string().trim().min(1, 'El ID del asistente es obligatorio').max(32),
  jornadaId: z.coerce.number().int().positive('La jornada es obligatoria'),
  dispositivo: z.string().trim().max(120).optional(),
});

export type IdentificadorAsistenteInput = z.infer<typeof identificadorAsistenteSchema>;

export const entregaRefrigerioSchema = z.object({
  asistenteId: z.string().trim().min(1, 'El ID del asistente es obligatorio').max(32),
  tipoRefrigerioId: z.coerce.number().int().positive('El tipo de refrigerio es obligatorio'),
  dispositivo: z.string().trim().max(120).optional(),
});

export type EntregaRefrigerioInput = z.infer<typeof entregaRefrigerioSchema>;

export const asistenteResumenSchema = z.object({
  id: z.string(),
  nombres: z.string(),
  apellidos: z.string(),
  rol: z.enum(ROLES_ASISTENTE),
  semestre: z.number().int().nullable(),
});

export type AsistenteResumen = z.infer<typeof asistenteResumenSchema>;

export const registroExistenteSchema = z.object({
  id: z.string(),
  jornadaId: z.number().int(),
  jornadaNombre: z.string().nullable(),
  horaIngreso: z.string(),
  horaSalida: z.string().nullable(),
  registradoPor: z.string().nullable(),
  dispositivo: z.string().nullable(),
});

export type RegistroExistente = z.infer<typeof registroExistenteSchema>;

export const entregaExistenteSchema = z.object({
  id: z.string(),
  tipoRefrigerioId: z.number().int(),
  tipoRefrigerioNombre: z.string().nullable(),
  entregadoAt: z.string(),
  entregadoPor: z.string().nullable(),
});

export type EntregaExistente = z.infer<typeof entregaExistenteSchema>;

/**
 * Respuesta unificada de los tres modos de registro (ingreso, refrigerio y salida).
 * Un duplicado nunca es un error de servidor: es un resultado valido con datos del
 * registro original, para que el operador muestre la alerta ambar.
 */
export const respuestaRegistroSchema = z.object({
  resultado: z.enum(RESULTADOS_REGISTRO),
  mensaje: z.string(),
  asistente: asistenteResumenSchema.nullable(),
  existente: z.union([registroExistenteSchema, entregaExistenteSchema]).nullable(),
  requiereBusquedaManual: z.boolean().default(false),
});

export type RespuestaRegistro = z.infer<typeof respuestaRegistroSchema>;

export const busquedaManualSchema = z.object({
  q: z.string().trim().min(2, 'Escriba al menos 2 caracteres').max(80),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(50).default(20),
});

export type BusquedaManualInput = z.infer<typeof busquedaManualSchema>;

export const excepcionManualSchema = z
  .object({
    asistenteId: z.string().trim().min(1).max(32),
    jornadaId: z.coerce.number().int().positive(),
    tipo: z.enum(['ingreso', 'salida']),
    hora: z.coerce.date().optional(),
    motivo: z
      .string()
      .trim()
      .min(10, 'El motivo es obligatorio y debe tener al menos 10 caracteres')
      .max(500),
  })
  .refine((datos) => datos.tipo !== 'salida' || datos.hora !== undefined, {
    message: 'Para registrar una salida manual se debe indicar la hora',
    path: ['hora'],
  });

export type ExcepcionManualInput = z.infer<typeof excepcionManualSchema>;
