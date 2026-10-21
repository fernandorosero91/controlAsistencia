import { z } from 'zod';

/** Limites de paginacion aplicados a todos los listados. */
export const LIMITE_POR_PAGINA_MAX = 200;

export const paginacionSchema = z.object({
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(LIMITE_POR_PAGINA_MAX).default(50),
});

export type Paginacion = z.infer<typeof paginacionSchema>;

export interface RespuestaPaginada<T> {
  datos: T[];
  pagina: number;
  porPagina: number;
  total: number;
  totalPaginas: number;
}

export function construirRespuestaPaginada<T>(
  datos: T[],
  total: number,
  paginacion: Paginacion,
): RespuestaPaginada<T> {
  const totalPaginas = paginacion.porPagina > 0 ? Math.ceil(total / paginacion.porPagina) : 0;
  return {
    datos,
    pagina: paginacion.pagina,
    porPagina: paginacion.porPagina,
    total,
    totalPaginas,
  };
}

/** Formato de error unificado de la API. */
export const codigoErrorSchema = z.enum([
  'VALIDACION',
  'NO_AUTENTICADO',
  'NO_AUTORIZADO',
  'NO_ENCONTRADO',
  'CONFLICTO',
  'IDEMPOTENCIA',
  'LIMITE_TASA',
  'INTERNO',
  'NO_DISPONIBLE',
]);

export type CodigoError = z.infer<typeof codigoErrorSchema>;

export const detalleErrorSchema = z.object({
  codigo: codigoErrorSchema,
  mensaje: z.string(),
  detalles: z.array(z.object({ campo: z.string(), mensaje: z.string() })).optional(),
});

export type DetalleError = z.infer<typeof detalleErrorSchema>;

/** Formato de fecha para la API: ISO 8601 en UTC. */
export const fechaIsoSchema = z.string().datetime({ offset: true });
