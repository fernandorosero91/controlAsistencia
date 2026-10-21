import { z } from 'zod';
import { FORMATOS_EXPORTACION } from './enums.js';

export const resumenJornadaSchema = z.object({
  jornadaId: z.number().int(),
  jornadaNombre: z.string(),
  totalAsistentes: z.number().int(),
  ingresos: z.number().int(),
  salidas: z.number().int(),
  pendientes: z.number().int(),
  porcentajeAsistencia: z.number(),
  dentroAhora: z.number().int(),
});

export const resumenRefrigerioSchema = z.object({
  tipoRefrigerioId: z.number().int(),
  nombre: z.string(),
  jornadaId: z.number().int(),
  entregados: z.number().int(),
  pendientes: z.number().int(),
});

export const resumenDashboardSchema = z.object({
  generadoAt: z.string(),
  totalAsistentes: z.number().int(),
  porJornada: z.array(resumenJornadaSchema),
  refrigerios: z.array(resumenRefrigerioSchema),
  ritmoIngreso: z.array(z.object({ minuto: z.string(), registros: z.number().int() })),
  dentroAhora: z.number().int(),
  fueraAhora: z.number().int(),
  elegibles: z.number().int(),
  noElegibles: z.number().int(),
  emitidos: z.number().int(),
  revocados: z.number().int(),
});

export type ResumenDashboard = z.infer<typeof resumenDashboardSchema>;

export const filtrosReporteSchema = z.object({
  formato: z.enum(FORMATOS_EXPORTACION).default('csv'),
  jornadaId: z.coerce.number().int().positive().optional(),
  rol: z.enum(['estudiante', 'docente']).optional(),
  desde: z.coerce.date().optional(),
  hasta: z.coerce.date().optional(),
  estado: z.enum(['elegible', 'no_elegible', 'emitido', 'revocado']).optional(),
  q: z.string().trim().max(80).optional(),
});

export type FiltrosReporte = z.infer<typeof filtrosReporteSchema>;

export const reporteAsistenciaFilaSchema = z.object({
  id: z.string(),
  nombres: z.string(),
  apellidos: z.string(),
  rol: z.string(),
  semestre: z.number().int().nullable(),
  jornada: z.string(),
  horaIngreso: z.string().nullable(),
  horaSalida: z.string().nullable(),
  registradoPor: z.string().nullable(),
});

export const reporteRefrigerioFilaSchema = z.object({
  id: z.string(),
  nombres: z.string(),
  apellidos: z.string(),
  rol: z.string(),
  refrigerio: z.string(),
  jornada: z.string(),
  entregadoAt: z.string().nullable(),
  entregadoPor: z.string().nullable(),
});

export const reporteElegibilidadFilaSchema = z.object({
  id: z.string(),
  nombres: z.string(),
  apellidos: z.string(),
  rol: z.string(),
  semestre: z.number().int().nullable(),
  estado: z.string(),
  motivos: z.string(),
  codigoVerificacion: z.string().nullable(),
  emitidoAt: z.string().nullable(),
});

export const filaAuditoriaSchema = z.object({
  id: z.string(),
  usuario: z.string().nullable(),
  accion: z.string(),
  entidad: z.string(),
  entidadId: z.string().nullable(),
  ip: z.string().nullable(),
  createdAt: z.string(),
});

export type FilaAuditoria = z.infer<typeof filaAuditoriaSchema>;
