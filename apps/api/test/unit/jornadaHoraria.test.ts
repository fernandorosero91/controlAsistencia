import { describe, expect, it } from 'vitest';
import { resolverJornadaPorHorario, type JornadaInfo } from '../../src/servicios/configuracion.js';

/**
 * La jornada del operador no se elige: la deduce el reloj del servidor a partir
 * del horario de cada jornada. Estas pruebas fijan esa regla, que es la que
 * evita que un ingreso quede en la jornada equivocada.
 */

function jornada(horas: number, nombre: string, orden: number): JornadaInfo {
  const inicio = new Date(2026, 9, 27, horas, 0, 0);
  const fin = new Date(2026, 9, 27, horas + 4, 0, 0);
  return {
    id: orden,
    nombre,
    inicio: inicio.toISOString(),
    fin: fin.toISOString(),
    ventanaCheckinInicio: inicio.toISOString(),
    ventanaCheckinFin: fin.toISOString(),
    orden,
  };
}

const manana = jornada(8, 'Manana', 1);
const tarde = jornada(14, 'Tarde', 2);
const lista = [manana, tarde];

const dentroDeManana = new Date(2026, 9, 27, 9, 0, 0);
const finDeManana = new Date(2026, 9, 27, 12, 0, 0);
const dentroDeTarde = new Date(2026, 9, 27, 15, 0, 0);
const almuerzo = new Date(2026, 9, 27, 13, 0, 0);
const antesDeTodo = new Date(2026, 9, 27, 6, 0, 0);

describe('deteccion de la jornada vigente por horario', () => {
  it('devuelve la jornada que esta en curso', () => {
    const resultado = resolverJornadaPorHorario(lista, dentroDeManana, { margenCierreMinutos: 20 });

    expect(resultado.jornada?.id).toBe(manana.id);
    expect(resultado.motivo).toBe('activa');
  });

  it('devuelve la jornada de la tarde cuando empieza', () => {
    const resultado = resolverJornadaPorHorario(lista, dentroDeTarde, { margenCierreMinutos: 20 });

    expect(resultado.jornada?.id).toBe(tarde.id);
    expect(resultado.motivo).toBe('activa');
  });

  it('mantiene la jornada durante el margen de cierre para registrar las salidas', () => {
    const resultado = resolverJornadaPorHorario(
      lista,
      new Date(2026, 9, 27, 12, 10, 0),
      { margenCierreMinutos: 20 },
    );

    expect(resultado.jornada?.id).toBe(manana.id);
    expect(resultado.motivo).toBe('margen_cierre');
  });

  it('no hay jornada vigente fuera del horario y muestra la siguiente', () => {
    const resultado = resolverJornadaPorHorario(lista, almuerzo, { margenCierreMinutos: 20 });

    expect(resultado.jornada).toBeNull();
    expect(resultado.motivo).toBe('fuera_de_horario');
    expect(resultado.proxima?.id).toBe(tarde.id);
  });

  it('no hay jornada vigente antes de que empiece la primera', () => {
    const resultado = resolverJornadaPorHorario(lista, antesDeTodo, { margenCierreMinutos: 20 });

    expect(resultado.jornada).toBeNull();
    expect(resultado.proxima?.id).toBe(manana.id);
  });

  it('la jornada fijada por el administrador manda sobre el horario', () => {
    const resultado = resolverJornadaPorHorario(lista, almuerzo, {
      jornadaForzadaId: tarde.id,
      margenCierreMinutos: 20,
    });

    expect(resultado.jornada?.id).toBe(tarde.id);
    expect(resultado.motivo).toBe('forzada');
  });

  it('sin jornadas configuradas no hay jornada vigente', () => {
    const resultado = resolverJornadaPorHorario([], dentroDeManana, {});

    expect(resultado.jornada).toBeNull();
    expect(resultado.motivo).toBe('sin_jornadas');
  });

  it('si dos jornadas se solapan manda la que empezo de ultima', () => {
    const tardeTardia: JornadaInfo = {
      ...tarde,
      id: 3,
      nombre: 'Noche',
      inicio: new Date(2026, 9, 27, 10, 0, 0).toISOString(),
      fin: new Date(2026, 9, 27, 14, 0, 0).toISOString(),
    };

    const resultado = resolverJornadaPorHorario(
      [...lista, tardeTardia],
      new Date(2026, 9, 27, 11, 0, 0),
      {},
    );

    expect(resultado.jornada?.id).toBe(3);
  });

  it('el margen de cierre configurable define hasta cuando sigue vigente la jornada', () => {
    const conMargenCorto = resolverJornadaPorHorario(
      lista,
      new Date(2026, 9, 27, 12, 10, 0),
      { margenCierreMinutos: 5 },
    );
    const conMargenLargo = resolverJornadaPorHorario(
      lista,
      new Date(2026, 9, 27, 12, 10, 0),
      { margenCierreMinutos: 30 },
    );

    expect(conMargenCorto.jornada).toBeNull();
    expect(conMargenLargo.jornada?.id).toBe(manana.id);
  });

  it('el margen por defecto es de veinte minutos', () => {
    const resultado = resolverJornadaPorHorario(
      lista,
      new Date(2026, 9, 27, 12, 15, 0),
      {},
    );

    expect(resultado.jornada?.id).toBe(manana.id);
    expect(resultado.motivo).toBe('margen_cierre');
  });

  it('indica hasta que momento sigue vigente la jornada', () => {
    const resultado = resolverJornadaPorHorario(lista, dentroDeManana, { margenCierreMinutos: 20 });

    expect(resultado.vigenteHasta).toBe(
      new Date(finDeManana.getTime() + 20 * 60_000).toISOString(),
    );
  });
});
