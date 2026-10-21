import { z, type ZodTypeAny } from 'zod';
import { errores } from '../plugins/errores.js';

function aDetalle(issues: { path: (string | number)[]; message: string }[]) {
  return issues.map((issue) => ({
    campo: issue.path.join('.') || '(general)',
    mensaje: issue.message,
  }));
}

/** Valida el cuerpo de la peticion y lanza un error 422 con el detalle por campo. */
export function validarCuerpo<S extends ZodTypeAny>(esquema: S, cuerpo: unknown): z.output<S> {
  const resultado = esquema.safeParse(cuerpo);
  if (!resultado.success) {
    throw errores.validacion(
      'Los datos enviados no son validos',
      aDetalle(resultado.error.issues),
    );
  }
  return resultado.data;
}

/** Valida los parametros de consulta y normaliza los valores por defecto. */
export function validarConsulta<S extends ZodTypeAny>(esquema: S, consulta: unknown): z.output<S> {
  const resultado = esquema.safeParse(consulta);
  if (!resultado.success) {
    throw errores.validacion(
      'Los parametros de consulta no son validos',
      aDetalle(resultado.error.issues),
    );
  }
  return resultado.data;
}

/** Valida los parametros de ruta. */
export function validarParametros<S extends ZodTypeAny>(
  esquema: S,
  parametros: unknown,
): z.output<S> {
  const resultado = esquema.safeParse(parametros);
  if (!resultado.success) {
    throw errores.validacion(
      'Los parametros de la ruta no son validos',
      aDetalle(resultado.error.issues),
    );
  }
  return resultado.data;
}
