import { z } from 'zod';
import { ROLES_ASISTENTE } from './enums.js';
import { CEDULA_REGEX, normalizarCedula, normalizarId } from './dominio.js';

/** Cedula de ciudadania: opcional, entre 5 y 20 caracteres alfanumericos. */
export const cedulaSchema = z
  .string()
  .trim()
  .max(20, 'La cedula no puede tener mas de 20 caracteres')
  .transform((valor) => normalizarCedula(valor))
  .refine((valor) => valor.length === 0 || CEDULA_REGEX.test(valor), {
    message: 'La cedula debe tener entre 5 y 20 caracteres, sin espacios ni guiones',
  });

export const asistenteSchema = z.object({
  id: z.string().min(1).max(32),
  nombres: z.string().trim().min(1, 'Los nombres son obligatorios').max(80),
  apellidos: z.string().trim().min(1, 'Los apellidos son obligatorios').max(80),
  rol: z.enum(ROLES_ASISTENTE),
  semestre: z.number().int().min(1).max(30).nullable().optional(),
  cedulaCiudadania: cedulaSchema.optional().or(z.literal('')),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email('Correo electronico invalido')
    .max(120)
    .optional()
    .or(z.literal('')),
  activo: z.boolean().default(true),
});

export type AsistenteInput = z.infer<typeof asistenteSchema>;

export const asistenteCreateSchema = asistenteSchema.superRefine((datos, ctx) => {
  if (datos.rol === 'estudiante' && (datos.semestre === null || datos.semestre === undefined)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['semestre'],
      message: 'El semestre es obligatorio para estudiantes',
    });
  }
  if (datos.rol === 'docente' && datos.semestre !== null && datos.semestre !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['semestre'],
      message: 'El semestre no aplica para docentes',
    });
  }
});

export const asistenteUpdateSchema = z
  .object({
    nombres: z.string().trim().min(1).max(80).optional(),
    apellidos: z.string().trim().min(1).max(80).optional(),
    rol: z.enum(ROLES_ASISTENTE).optional(),
    semestre: z.number().int().min(1).max(30).nullable().optional(),
    cedulaCiudadania: cedulaSchema.optional().or(z.literal('')),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email('Correo electronico invalido')
      .max(120)
      .optional()
      .or(z.literal('')),
    activo: z.boolean().optional(),
  })
  .refine((datos) => Object.keys(datos).length > 0, {
    message: 'Debe enviar al menos un campo para actualizar',
  });

export type AsistenteUpdateInput = z.infer<typeof asistenteUpdateSchema>;

export const asistenteLecturaSchema = z.object({
  id: z.string(),
  codigoRegistro: z.string().nullable(),
  nombres: z.string(),
  apellidos: z.string(),
  cedulaCiudadania: z.string().nullable(),
  email: z.string().nullable(),
  rol: z.enum(ROLES_ASISTENTE),
  semestre: z.number().int().nullable(),
  activo: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type AsistenteLectura = z.infer<typeof asistenteLecturaSchema>;

export const filtrosAsistentesSchema = z.object({
  q: z.string().trim().max(80).optional(),
  rol: z.enum(ROLES_ASISTENTE).optional(),
  semestre: z.coerce.number().int().min(1).max(30).optional(),
  activo: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(200).default(50),
});

export type FiltrosAsistentes = z.infer<typeof filtrosAsistentesSchema>;

/**
 * Normaliza el identificador recibido en la API antes de buscarlo.
 * Se exporta para que el cliente use exactamente la misma regla.
 */
export function prepararIdBusqueda(id: string): string {
  return normalizarId(id);
}
