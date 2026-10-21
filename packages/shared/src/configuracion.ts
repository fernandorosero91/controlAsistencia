import { z } from 'zod';
import { ID_REGEX_POR_DEFECTO } from './dominio.js';

export const seminarioConfigSchema = z.object({
  nombre: z.string().trim().min(3, 'El nombre del seminario es obligatorio').max(160),
  fecha: z.coerce.date(),
  horaFinSeminario: z.coerce.date(),
  toleranciaMinutos: z.coerce.number().int().min(0).max(240),
  exigirAmbasJornadas: z.boolean(),
  intensidadHoraria: z.coerce.number().int().min(1).max(24),
  permitirRegistroFueraDeVentana: z.boolean().default(false),
  textoEncabezado: z.string().trim().max(200).optional(),
  textoCierre: z.string().trim().max(600).optional(),
  firmaNombre: z.string().trim().max(120).optional(),
  firmaCargo: z.string().trim().max(120).optional(),
  idRegex: z.string().trim().min(1).max(120).default(ID_REGEX_POR_DEFECTO),
  urlPublica: z.string().trim().url().optional().or(z.literal('')),
});

export type SeminarioConfigInput = z.infer<typeof seminarioConfigSchema>;

export const jornadaSchema = z.object({
  nombre: z.string().trim().min(2).max(60),
  inicio: z.coerce.date(),
  fin: z.coerce.date(),
  ventanaCheckinInicio: z.coerce.date(),
  ventanaCheckinFin: z.coerce.date(),
  orden: z.coerce.number().int().min(0).max(50).default(0),
});

export type JornadaInput = z.infer<typeof jornadaSchema>;

export const jornadaPartialSchema = jornadaSchema.partial().refine(
  (datos) => Object.keys(datos).length > 0,
  { message: 'Debe enviar al menos un campo' },
);

export type JornadaPartialInput = z.infer<typeof jornadaPartialSchema>;

export const jornadaLecturaSchema = z.object({
  id: z.number().int(),
  nombre: z.string(),
  inicio: z.string(),
  fin: z.string(),
  ventanaCheckinInicio: z.string(),
  ventanaCheckinFin: z.string(),
  orden: z.number().int(),
});

export type JornadaLectura = z.infer<typeof jornadaLecturaSchema>;

export const tipoRefrigerioSchema = z.object({
  nombre: z.string().trim().min(2).max(60),
  jornadaId: z.coerce.number().int().positive(),
  activo: z.boolean().default(true),
  orden: z.coerce.number().int().min(0).max(50).default(0),
});

export type TipoRefrigerioInput = z.infer<typeof tipoRefrigerioSchema>;

export const tipoRefrigerioLecturaSchema = z.object({
  id: z.number().int(),
  nombre: z.string(),
  jornadaId: z.number().int(),
  activo: z.boolean(),
  orden: z.number().int(),
  entregados: z.number().int().optional(),
});

export type TipoRefrigerioLectura = z.infer<typeof tipoRefrigerioLecturaSchema>;
