import { describe, expect, it } from 'vitest';
import { validarFila } from '../../src/servicios/importacion.js';

const REGEX_ID = '^[A-Z0-9]{4,20}$';

function filaCon(extra: Record<string, string> = {}): Record<string, string> {
  return {
    id: 'EST00001',
    nombres: 'Ana',
    apellidos: 'Perez',
    rol: 'estudiante',
    semestre: '3',
    email: 'ana@ucc.edu.co',
    ...extra,
  };
}

/**
 * El archivo institucional escribe el tipo de documento de muchas formas.
 * Ninguna variante de tarjeta de identidad puede terminar guardada como CC:
 * se imprimiria "C.C." en la escarapela y en el certificado.
 */
describe('tipo de documento en la importacion', () => {
  it('reconoce todas las variantes de tarjeta de identidad', () => {
    const variantes = [
      'TI',
      'ti',
      'T.I.',
      'T.I',
      't i',
      'Tarjeta de Identidad',
      'TARJETA DE IDENTIDAD',
      'tarjeta identidad',
    ];

    for (const valor of variantes) {
      const resultado = validarFila(
        2,
        filaCon({ 'tipo documento': valor, cedula: '1099888777' }),
        REGEX_ID,
      );
      expect(resultado.datos.tipoDocumento, `variante "${valor}"`).toBe('TI');
      expect(resultado.valida, `variante "${valor}"`).toBe(true);
    }
  });

  it('reconoce las variantes de cedula de ciudadania', () => {
    for (const valor of ['CC', 'cc', 'C.C.', 'c c', 'Cedula', 'CEDULA DE CIUDADANIA']) {
      const resultado = validarFila(
        2,
        filaCon({ 'tipo documento': valor, cedula: '1094867245' }),
        REGEX_ID,
      );
      expect(resultado.datos.tipoDocumento, `variante "${valor}"`).toBe('CC');
      expect(resultado.valida).toBe(true);
    }
  });

  it('sin columna de tipo de documento asume cedula', () => {
    const resultado = validarFila(2, filaCon({ cedula: '1094867245' }), REGEX_ID);

    expect(resultado.datos.tipoDocumento).toBe('CC');
    expect(resultado.valida).toBe(true);
  });

  it('rechaza un tipo de documento que no es CC ni TI', () => {
    const resultado = validarFila(
      2,
      filaCon({ 'tipo documento': 'Pasaporte', cedula: '1094867245' }),
      REGEX_ID,
    );

    expect(resultado.valida).toBe(false);
    expect(resultado.errores.some((error) => error.campo === 'tipo documento')).toBe(true);
  });
});
