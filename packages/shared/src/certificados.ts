import { z } from 'zod';
import { ESTADOS_CERTIFICADO } from './enums.js';
import { MOTIVOS_INELEGIBILIDAD as MOTIVOS } from './dominio.js';

export const codigoVerificacionSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/, 'Codigo de verificacion invalido');

export const emitirCertificadoSchema = z
  .object({
    excepcionManual: z.boolean().default(false),
    motivo: z.string().trim().max(500).optional(),
  })
  .refine((datos) => !datos.excepcionManual || (datos.motivo && datos.motivo.length >= 10), {
    message: 'La excepcion manual exige un motivo de al menos 10 caracteres',
    path: ['motivo'],
  });

export type EmitirCertificadoInput = z.infer<typeof emitirCertificadoSchema>;

export const emitirLoteSchema = z.object({
  soloElegibles: z.boolean().default(true),
  incluirExcepciones: z.boolean().default(false),
  motivo: z.string().trim().max(500).optional(),
});

export type EmitirLoteInput = z.infer<typeof emitirLoteSchema>;

export const revocarCertificadoSchema = z.object({
  motivo: z.string().trim().min(10, 'El motivo es obligatorio').max(500),
});

export type RevocarCertificadoInput = z.infer<typeof revocarCertificadoSchema>;

export const estadoCertificadoSchema = z.object({
  asistenteId: z.string(),
  asistenteNombre: z.string(),
  asistenteIdInstitucional: z.string(),
  rol: z.enum(['estudiante', 'docente']),
  semestre: z.number().int().nullable(),
  estado: z.enum(ESTADOS_CERTIFICADO),
  motivos: z.array(z.enum(MOTIVOS)),
  certificadoId: z.string().uuid().nullable(),
  codigoVerificacion: z.string().nullable(),
  emitidoAt: z.string().nullable(),
  revocado: z.boolean(),
  excepcionManual: z.boolean(),
  motivoExcepcion: z.string().nullable(),
});

export type EstadoCertificadoDetalle = z.infer<typeof estadoCertificadoSchema>;

export const filtrosCertificadosSchema = z.object({
  estado: z.enum(ESTADOS_CERTIFICADO).optional(),
  rol: z.enum(['estudiante', 'docente']).optional(),
  q: z.string().trim().max(80).optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(200).default(50),
});

export type FiltrosCertificados = z.infer<typeof filtrosCertificadosSchema>;

export const progresoLoteSchema = z.object({
  id: z.string().uuid(),
  estado: z.enum(['en_proceso', 'completado', 'fallido']),
  total: z.number().int(),
  procesados: z.number().int(),
  exitosos: z.number().int(),
  fallidos: z.number().int(),
  porcentaje: z.number(),
  errores: z.array(z.object({ asistenteId: z.string(), mensaje: z.string() })),
  iniciadoAt: z.string(),
  finalizadoAt: z.string().nullable(),
});

export type ProgresoLote = z.infer<typeof progresoLoteSchema>;

/** Datos publicos de un certificado verificado. No expone mas que lo necesario. */
export const verificacionPublicaSchema = z.object({
  valido: z.boolean(),
  nombre: z.string().nullable(),
  rol: z.string().nullable(),
  seminario: z.string().nullable(),
  fechaEmision: z.string().nullable(),
  intensidadHoraria: z.number().int().nullable(),
  estado: z.string().nullable(),
});

export type VerificacionPublica = z.infer<typeof verificacionPublicaSchema>;
