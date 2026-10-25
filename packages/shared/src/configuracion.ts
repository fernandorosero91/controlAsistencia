import { z } from 'zod';
import { ID_REGEX_POR_DEFECTO } from './dominio.js';

/** Firmante del certificado: nombre, cargo y dependencia opcional. */
export const firmanteSchema = z.object({
  nombre: z.string().trim().min(3, 'Indique el nombre de quien firma').max(120),
  cargo: z.string().trim().min(3, 'Indique el cargo de quien firma').max(120),
  entidad: z.string().trim().max(120).optional().default(''),
});

export type Firmante = z.infer<typeof firmanteSchema>;

export const seminarioConfigSchema = z.object({
  nombre: z.string().trim().min(3, 'El nombre del seminario es obligatorio').max(160),
  fecha: z.coerce.date(),
  horaFinSeminario: z.coerce.date(),
  toleranciaMinutos: z.coerce.number().int().min(0).max(240),
  exigirAmbasJornadas: z.boolean(),
  intensidadHoraria: z.coerce.number().int().min(1).max(24),
  /** Horas minimas de permanencia en cada jornada exigida para el certificado. */
  minimoPermanenciaHoras: z.coerce.number().int().min(0).max(12),
  permitirRegistroFueraDeVentana: z.boolean().default(false),
  textoEncabezado: z.string().trim().max(200).optional(),
  textoCierre: z.string().trim().max(600).optional(),
  lugar: z.string().trim().max(160).optional(),
  facultad: z.string().trim().max(160).optional(),
  contacto: z.string().trim().max(80).optional(),
  firmaNombre: z.string().trim().max(120).optional(),
  firmaCargo: z.string().trim().max(120).optional(),
  /** Hasta tres firmantes, en el orden en que aparecen en el certificado. */
  firmas: z.array(firmanteSchema).max(3).default([]),
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

/**
 * Revisa que los horarios de una jornada sean coherentes entre si.
 *
 * La base de datos tambien lo comprueba (restriccion `jornadas_ventana_valida`),
 * pero alli el error llega como un 500 sin explicacion. Aqui se devuelve el
 * mensaje que el administrador necesita para corregir el dato.
 */
export function validarCoherenciaJornada(datos: {
  inicio: Date;
  fin: Date;
  ventanaCheckinInicio: Date;
  ventanaCheckinFin: Date;
}): string | null {
  if (datos.fin.getTime() <= datos.inicio.getTime()) {
    return 'La hora de fin de la jornada debe ser posterior a la de inicio';
  }
  if (datos.ventanaCheckinFin.getTime() <= datos.ventanaCheckinInicio.getTime()) {
    return 'El cierre del registro debe ser posterior a su apertura';
  }
  return null;
}

export const jornadaPartialSchema = jornadaSchema
  .partial()
  .refine((datos) => Object.keys(datos).length > 0, { message: 'Debe enviar al menos un campo' });

export type JornadaPartialInput = z.infer<typeof jornadaPartialSchema>;

/**
 * Accesos que el administrador controla en la app del operador.
 *
 * La jornada no se elige: se deduce del horario. Lo que el administrador decide
 * es que modulos ve el operador y, en caso de que el evento se corra, cual es la
 * jornada en curso.
 */
export const accesosOperadorSchema = z.object({
  operadorIngresoHabilitado: z.boolean().optional(),
  operadorRefrigerioHabilitado: z.boolean().optional(),
  operadorSalidaHabilitado: z.boolean().optional(),
  operadorSouvenirHabilitado: z.boolean().optional(),
  /** Minutos de gracia despues del cierre de la jornada. */
  margenCierreMinutos: z.coerce.number().int().min(0).max(180).optional(),
  /** Jornada fijada a mano; null o ausente significa deteccion automatica. */
  jornadaForzadaId: z.coerce.number().int().positive().nullable().optional(),
});

export type AccesosOperadorInput = z.infer<typeof accesosOperadorSchema>;

/** Modulos de la app del operador que el administrador puede habilitar. */
export const modulosOperadorSchema = z.object({
  ingreso: z.boolean(),
  refrigerio: z.boolean(),
  salida: z.boolean(),
});

export type ModulosOperador = z.infer<typeof modulosOperadorSchema>;

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

/** Souvenir o regalo que se entrega una vez por asistente (sin jornada). */
export const tipoSouvenirSchema = z.object({
  nombre: z.string().trim().min(2).max(60),
  activo: z.boolean().default(true),
  orden: z.coerce.number().int().min(0).max(50).default(0),
});

export type TipoSouvenirInput = z.infer<typeof tipoSouvenirSchema>;

export const tipoSouvenirLecturaSchema = z.object({
  id: z.number().int(),
  nombre: z.string(),
  activo: z.boolean(),
  orden: z.number().int(),
  entregados: z.number().int().optional(),
});

export type TipoSouvenirLectura = z.infer<typeof tipoSouvenirLecturaSchema>;

export const tipoRefrigerioLecturaSchema = z.object({
  id: z.number().int(),
  nombre: z.string(),
  jornadaId: z.number().int(),
  activo: z.boolean(),
  orden: z.number().int(),
  entregados: z.number().int().optional(),
});

export type TipoRefrigerioLectura = z.infer<typeof tipoRefrigerioLecturaSchema>;
