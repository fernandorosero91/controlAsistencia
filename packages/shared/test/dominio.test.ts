import { describe, expect, it } from 'vitest';
import {
  cumpleFormatoCedula,
  cumpleFormatoId,
  esCodigoRegistroValido,
  estadoVentanaCheckin,
  evaluarElegibilidad,
  generarCodigoRegistro,
  generarCodigoVerificacion,
  ID_REGEX_POR_DEFECTO,
  normalizarCedula,
  normalizarId,
  sanitizarCeldaExportacion,
  validarSemestre,
} from '../src/index.js';

const jornadaManana = { id: 1, fin: new Date('2026-11-20T17:00:00.000Z') };
const jornadaTarde = { id: 2, fin: new Date('2026-11-20T23:00:00.000Z') };
const horaFin = new Date('2026-11-20T23:00:00.000Z');

describe('normalizacion del ID institucional', () => {
  it('recorta, elimina espacios y pasa a mayusculas', () => {
    expect(normalizarId('  est 00001 ')).toBe('EST00001');
    expect(normalizarId('est-00001')).toBe('EST-00001');
  });

  it('es idempotente', () => {
    const unaVez = normalizarId('  ab 12 ');
    expect(normalizarId(unaVez)).toBe(unaVez);
  });
});

describe('normalizacion de la cedula de ciudadania', () => {
  it('recorta, elimina espacios y guiones y pasa a mayusculas', () => {
    expect(normalizarCedula(' 1094 867-245 ')).toBe('1094867245');
    expect(normalizarCedula('ab 12')).toBe('AB12');
  });

  it('acepta cedulas de 5 a 20 caracteres alfanumericos', () => {
    expect(cumpleFormatoCedula('1094867245')).toBe(true);
    expect(cumpleFormatoCedula('80123456')).toBe(true);
    expect(cumpleFormatoCedula('E12345678')).toBe(true);
  });

  it('rechaza las cedulas demasiado cortas o con caracteres no validos', () => {
    expect(cumpleFormatoCedula('1234')).toBe(false);
    expect(cumpleFormatoCedula('1094$67245')).toBe(false);
    expect(cumpleFormatoCedula('1094867245 000 000 000 000 000')).toBe(false);
  });
});

describe('validacion del formato del ID', () => {
  it('acepta los IDs que cumplen la expresion por defecto', () => {    expect(cumpleFormatoId('EST00001')).toBe(true);
    expect(cumpleFormatoId('DOC0001')).toBe(true);
  });

  it('rechaza los IDs con caracteres no permitidos', () => {
    expect(cumpleFormatoId('EST-00001')).toBe(false);
    expect(cumpleFormatoId('AB')).toBe(false);
    expect(cumpleFormatoId('')).toBe(false);
  });

  it('acepta una expresion regular configurable', () => {
    expect(cumpleFormatoId('EST-00001', '^[A-Z]{3}-[0-9]{5}$')).toBe(true);
    expect(cumpleFormatoId('EST00001', '^[A-Z]{3}-[0-9]{5}$')).toBe(false);
  });

  it('no falla cuando la expresion configurada es invalida', () => {
    expect(cumpleFormatoId('EST00001', '[')).toBe(false);
  });

  it('usa la expresion por defecto declarada', () => {
    expect(ID_REGEX_POR_DEFECTO).toBe('^[A-Z0-9]{4,20}$');
  });
});

describe('semestre por rol', () => {
  it('exige semestre para estudiantes', () => {
    expect(validarSemestre('estudiante', null).valido).toBe(false);
    expect(validarSemestre('estudiante', 5).valido).toBe(true);
  });

  it('no exige semestre para docentes', () => {
    expect(validarSemestre('docente', null).valido).toBe(true);
    expect(validarSemestre('docente', 3).valido).toBe(true);
  });

  it('rechaza semestres fuera de rango', () => {
    expect(validarSemestre('estudiante', 0).valido).toBe(false);
    expect(validarSemestre('estudiante', 31).valido).toBe(false);
  });
});

describe('evaluacion de elegibilidad para el certificado', () => {
  const base = {
    exigirAmbasJornadas: true,
    horaFinSeminario: horaFin,
    toleranciaMinutos: 15,
    minimoPermanenciaHoras: 3,
    jornadas: [jornadaManana, jornadaTarde],
  };

  it('otorga elegibilidad con asistencia en ambas jornadas y salida dentro de la tolerancia', () => {
    const resultado = evaluarElegibilidad({
      ...base,
      asistencias: [
        {
          jornadaId: 1,
          horaIngreso: new Date('2026-11-20T12:00:00.000Z'),
          horaSalida: new Date('2026-11-20T17:00:00.000Z'),
        },
        {
          jornadaId: 2,
          horaIngreso: new Date('2026-11-20T18:00:00.000Z'),
          horaSalida: new Date('2026-11-20T22:50:00.000Z'),
        },
      ],
    });

    expect(resultado.elegible).toBe(true);
    expect(resultado.motivos).toHaveLength(0);
    expect(resultado.jornadasExigidas).toEqual([1, 2]);
  });

  it('rechaza a quien falta en una de las jornadas exigidas', () => {
    const resultado = evaluarElegibilidad({
      ...base,
      asistencias: [
        {
          jornadaId: 1,
          horaIngreso: new Date('2026-11-20T12:00:00.000Z'),
          horaSalida: new Date('2026-11-20T17:00:00.000Z'),
        },
      ],
    });

    expect(resultado.elegible).toBe(false);
    expect(resultado.motivos).toContain('falta_asistencia_jornada');
  });

  it('rechaza a quien no tiene registro de salida', () => {
    const resultado = evaluarElegibilidad({
      ...base,
      asistencias: [
        { jornadaId: 1, horaIngreso: new Date('2026-11-20T12:00:00.000Z'), horaSalida: null },
        { jornadaId: 2, horaIngreso: new Date('2026-11-20T18:00:00.000Z'), horaSalida: null },
      ],
    });

    expect(resultado.elegible).toBe(false);
    expect(resultado.motivos).toContain('sin_registro_salida');
  });

  it('rechaza a quien salio antes de la hora de fin mas alla de la tolerancia', () => {
    const resultado = evaluarElegibilidad({
      ...base,
      asistencias: [
        {
          jornadaId: 1,
          horaIngreso: new Date('2026-11-20T12:00:00.000Z'),
          horaSalida: new Date('2026-11-20T17:00:00.000Z'),
        },
        {
          jornadaId: 2,
          horaIngreso: new Date('2026-11-20T18:00:00.000Z'),
          horaSalida: new Date('2026-11-20T22:00:00.000Z'),
        },
      ],
    });

    expect(resultado.elegible).toBe(false);
    expect(resultado.motivos).toContain('salida_antes_de_hora_fin');
  });

  it('acepta una salida que cae dentro de la tolerancia', () => {
    const resultado = evaluarElegibilidad({
      ...base,
      asistencias: [
        {
          jornadaId: 1,
          horaIngreso: new Date('2026-11-20T12:00:00.000Z'),
          horaSalida: new Date('2026-11-20T17:00:00.000Z'),
        },
        {
          jornadaId: 2,
          horaIngreso: new Date('2026-11-20T18:00:00.000Z'),
          horaSalida: new Date('2026-11-20T22:45:00.000Z'),
        },
      ],
    });

    expect(resultado.elegible).toBe(true);
  });

  it('recalcula el resultado al cambiar la hora de fin', () => {
    const asistencias = [
      {
        jornadaId: 1,
        horaIngreso: new Date('2026-11-20T12:00:00.000Z'),
        horaSalida: new Date('2026-11-20T17:00:00.000Z'),
      },
      {
        jornadaId: 2,
        horaIngreso: new Date('2026-11-20T18:00:00.000Z'),
        // Tres horas de permanencia, el minimo exigido.
        horaSalida: new Date('2026-11-20T21:00:00.000Z'),
      },
    ];

    const antes = evaluarElegibilidad({ ...base, asistencias });
    const despues = evaluarElegibilidad({
      ...base,
      horaFinSeminario: new Date('2026-11-20T20:15:00.000Z'),
      asistencias,
    });

    expect(antes.elegible).toBe(false);
    expect(despues.elegible).toBe(true);
  });

  it('con exigeAmbasJornadas en false solo exige la jornada de cierre', () => {
    const resultado = evaluarElegibilidad({
      ...base,
      exigirAmbasJornadas: false,
      asistencias: [
        {
          jornadaId: 2,
          horaIngreso: new Date('2026-11-20T18:00:00.000Z'),
          horaSalida: new Date('2026-11-20T22:50:00.000Z'),
        },
      ],
    });

    expect(resultado.elegible).toBe(true);
    expect(resultado.jornadasExigidas).toEqual([2]);
  });

  it('reporta la falta de jornadas configuradas', () => {
    const resultado = evaluarElegibilidad({ ...base, jornadas: [], asistencias: [] });
    expect(resultado.elegible).toBe(false);
    expect(resultado.motivos).toEqual(['sin_jornadas_configuradas']);
  });

  it('rechaza a quien no permanece el minimo de horas en una jornada', () => {
    const resultado = evaluarElegibilidad({
      ...base,
      asistencias: [
        {
          jornadaId: 1,
          horaIngreso: new Date('2026-11-20T12:00:00.000Z'),
          // Permanencia de una hora: menos que el minimo de tres.
          horaSalida: new Date('2026-11-20T13:00:00.000Z'),
        },
        {
          jornadaId: 2,
          horaIngreso: new Date('2026-11-20T18:00:00.000Z'),
          horaSalida: new Date('2026-11-20T22:50:00.000Z'),
        },
      ],
    });

    expect(resultado.elegible).toBe(false);
    expect(resultado.motivos).toContain('permanencia_insuficiente');
  });

  it('acepta exactamente el minimo de permanencia', () => {
    const resultado = evaluarElegibilidad({
      ...base,
      asistencias: [
        {
          jornadaId: 1,
          horaIngreso: new Date('2026-11-20T12:00:00.000Z'),
          horaSalida: new Date('2026-11-20T15:00:00.000Z'),
        },
        {
          jornadaId: 2,
          horaIngreso: new Date('2026-11-20T18:00:00.000Z'),
          horaSalida: new Date('2026-11-20T21:00:00.000Z'),
        },
      ],
    });

    expect(resultado.motivos).not.toContain('permanencia_insuficiente');
  });

  it('con minimo de permanencia en cero la regla no se aplica', () => {
    const resultado = evaluarElegibilidad({
      ...base,
      minimoPermanenciaHoras: 0,
      asistencias: [
        {
          jornadaId: 1,
          horaIngreso: new Date('2026-11-20T12:00:00.000Z'),
          horaSalida: new Date('2026-11-20T17:00:00.000Z'),
        },
        {
          jornadaId: 2,
          horaIngreso: new Date('2026-11-20T18:00:00.000Z'),
          horaSalida: new Date('2026-11-20T22:50:00.000Z'),
        },
      ],
    });

    expect(resultado.elegible).toBe(true);
  });
});

describe('codigo de registro del asistente', () => {
  it('tiene seis caracteres del alfabeto sin O, I, 0 ni 1', () => {
    for (let intento = 0; intento < 200; intento += 1) {
      const codigo = generarCodigoRegistro();
      expect(codigo).toHaveLength(6);
      expect(codigo).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
      expect(codigo).not.toMatch(/[OI01]/);
    }
  });

  it('es reproducible con una fuente de azar controlada', () => {
    expect(generarCodigoRegistro(() => 0)).toBe('AAAAAA');
  });

  it('valida el formato esperado', () => {
    expect(esCodigoRegistroValido('K7M4D2')).toBe(true);
    expect(esCodigoRegistroValido('k7m4d2')).toBe(false);
    expect(esCodigoRegistroValido('K7M4D')).toBe(false);
    expect(esCodigoRegistroValido('K7M4D2X')).toBe(false);
    expect(esCodigoRegistroValido('O1I0AB')).toBe(false);
  });
});

describe('ventanas de check-in', () => {
  const ventana = {
    inicio: new Date('2026-11-20T11:30:00.000Z'),
    fin: new Date('2026-11-20T14:00:00.000Z'),
  };

  it('detecta la ventana abierta, antes y despues', () => {
    expect(estadoVentanaCheckin(ventana, new Date('2026-11-20T12:00:00.000Z'))).toBe('abierta');
    expect(estadoVentanaCheckin(ventana, new Date('2026-11-20T10:00:00.000Z'))).toBe('antes');
    expect(estadoVentanaCheckin(ventana, new Date('2026-11-20T15:00:00.000Z'))).toBe('despues');
  });

  it('incluye los limites exactos de la ventana', () => {
    expect(estadoVentanaCheckin(ventana, ventana.inicio)).toBe('abierta');
    expect(estadoVentanaCheckin(ventana, ventana.fin)).toBe('abierta');
  });
});

describe('proteccion contra inyeccion de formulas en exportaciones', () => {
  it('antepone apostrofo a los valores que empiezan por operadores', () => {
    expect(sanitizarCeldaExportacion('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(sanitizarCeldaExportacion('+1234')).toBe("'+1234");
    expect(sanitizarCeldaExportacion('-1234')).toBe("'-1234");
    expect(sanitizarCeldaExportacion('@cmd')).toBe("'@cmd");
  });

  it('deja intactos los valores seguros', () => {
    expect(sanitizarCeldaExportacion('Ana Acosta')).toBe('Ana Acosta');
    expect(sanitizarCeldaExportacion('')).toBe('');
    expect(sanitizarCeldaExportacion(null)).toBe('');
  });
});

describe('codigo de verificacion', () => {
  it('genera un codigo con el formato esperado', () => {
    const codigo = generarCodigoVerificacion();
    expect(codigo).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });

  it('es determinista con una fuente de azar controlada', () => {
    const codigo = generarCodigoVerificacion(() => 0);
    expect(codigo).toBe('AAAA-AAAA-AAAA');
  });
});
