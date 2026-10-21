import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { validarConsulta, validarCuerpo, validarParametros } from '../../src/lib/validacion.js';
import { ErrorApi } from '../../src/plugins/errores.js';

/**
 * Capa de validacion de la API. Toda ruta valida su entrada con Zod y responde
 * 422 con el detalle por campo; estas pruebas fijan ese contrato porque el panel
 * y la app del operador dependen de el para mostrar los errores.
 */

const esquemaAsistente = z.object({
  id: z.string().regex(/^[A-Z0-9]{4,20}$/, 'El ID debe tener entre 4 y 20 caracteres'),
  nombres: z.string().min(2),
  semestre: z.number().int().min(1).max(10).optional(),
});

describe('validacion del cuerpo de una peticion', () => {
  it('devuelve los datos cuando el cuerpo es valido', () => {
    const datos = validarCuerpo(esquemaAsistente, {
      id: 'EST00121',
      nombres: 'Ana Maria',
      semestre: 4,
    });

    expect(datos).toEqual({ id: 'EST00121', nombres: 'Ana Maria', semestre: 4 });
  });

  it('descarta las claves que no estan en el esquema', () => {
    const datos = validarCuerpo(esquemaAsistente, {
      id: 'EST00121',
      nombres: 'Ana Maria',
      rol: 'admin',
      activo: true,
    });

    expect(Object.keys(datos).sort()).toEqual(['id', 'nombres']);
  });

  it('lanza un error de validacion con estado 422', () => {
    const error = capturar(() => validarCuerpo(esquemaAsistente, { id: 'x', nombres: 'A' }));

    expect(error).toBeInstanceOf(ErrorApi);
    expect(error.codigo).toBe('VALIDACION');
    expect(error.codigoHttp).toBe(422);
    expect(error.mensaje).toBe('Los datos enviados no son validos');
  });

  it('informa el campo exacto que fallo', () => {
    const error = capturar(() => validarCuerpo(esquemaAsistente, { id: '12', nombres: 'Ana' }));

    expect(error.detalles).toHaveLength(1);
    expect(error.detalles?.[0]?.campo).toBe('id');
    expect(error.detalles?.[0]?.mensaje).toContain('ID');
  });

  it('agrupa varios campos invalidos en el detalle', () => {
    const error = capturar(() => validarCuerpo(esquemaAsistente, { id: 'x', nombres: 'A' }));

    const campos = error.detalles?.map((detalle) => detalle.campo) ?? [];
    expect(campos).toEqual(expect.arrayContaining(['id', 'nombres']));
  });
});

describe('validacion de los parametros de consulta', () => {
  const esquemaConsulta = z.object({
    pagina: z.coerce.number().int().min(1).default(1),
    porPagina: z.coerce.number().int().min(1).max(100).default(20),
    busqueda: z.string().trim().optional(),
  });

  it('aplica los valores por defecto cuando no se envian', () => {
    const consulta = validarConsulta(esquemaConsulta, {});

    expect(consulta.pagina).toBe(1);
    expect(consulta.porPagina).toBe(20);
  });

  it('convierte los numeros que llegan como texto en la URL', () => {
    const consulta = validarConsulta(esquemaConsulta, { pagina: '3', porPagina: '50' });

    expect(consulta.pagina).toBe(3);
    expect(consulta.porPagina).toBe(50);
  });

  it('rechaza un limite fuera del rango permitido', () => {
    const error = capturar(() => validarConsulta(esquemaConsulta, { porPagina: '5000' }));

    expect(error.codigo).toBe('VALIDACION');
    expect(error.mensaje).toBe('Los parametros de consulta no son validos');
    expect(error.detalles?.[0]?.campo).toBe('porPagina');
  });
});

describe('validacion de los parametros de ruta', () => {
  const esquemaRuta = z.object({ asistenteId: z.string().uuid() });

  it('acepta un identificador valido', () => {
    const parametros = validarParametros(esquemaRuta, {
      asistenteId: '3f2b58a4-1c6e-4d3f-9a0b-6c5e2d1a7b90',
    });

    expect(parametros.asistenteId).toBe('3f2b58a4-1c6e-4d3f-9a0b-6c5e2d1a7b90');
  });

  it('rechaza un identificador con formato invalido', () => {
    const error = capturar(() => validarParametros(esquemaRuta, { asistenteId: '123' }));

    expect(error.codigo).toBe('VALIDACION');
    expect(error.codigoHttp).toBe(422);
    expect(error.mensaje).toBe('Los parametros de la ruta no son validos');
  });
});

/** Ejecuta la funcion y devuelve el ErrorApi lanzado, fallando si no lanza. */
function capturar(accion: () => unknown): ErrorApi {
  try {
    accion();
  } catch (error) {
    if (error instanceof ErrorApi) return error;
    throw error;
  }
  throw new Error('Se esperaba un ErrorApi y no se lanzo ninguno');
}
