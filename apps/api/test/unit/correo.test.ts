import { describe, expect, it } from 'vitest';
import { componerCorreo } from '../../src/servicios/correo.js';

/**
 * El correo con la credencial es la primera impresion del sistema: debe verse
 * institucional y explicar que la credencial controla la asistencia.
 */
const mensaje = {
  destinatario: 'el.roserso@ucc.edu.co',
  nombre: 'Elier Fernando Rosero Bravo',
  codigoRegistro: 'LQBJ9V',
  idInstitucional: '908032',
  nombreSeminario: 'IV Seminario de Ingenieria de Software',
  lugar: 'Camara de Comercio - Pasto',
  fecha: '2026-10-27',
  contacto: '311 781 7327',
  facultad: 'Facultad de Ingenieria',
};

describe('correo con la credencial', () => {
  it('usa un asunto institucional con el nombre del evento', () => {
    const correo = componerCorreo(mensaje);
    expect(correo.asunto).toBe(
      'Credencial de asistencia - IV Seminario de Ingenieria de Software',
    );
  });

  it('explica que la credencial controla la asistencia y que es obligatoria', () => {
    const correo = componerCorreo(mensaje);

    expect(correo.html).toContain('Su credencial controla la asistencia');
    expect(correo.html).toContain('obligatoria para entrar');
    expect(correo.html).toContain('Registre la salida');
    expect(correo.texto).toContain('SU CREDENCIAL CONTROLA LA ASISTENCIA');
    expect(correo.texto).toContain('Lleve la escarapela adjunta');
    expect(correo.texto).toContain('Registre la salida');
  });

  it('muestra el codigo, el ID, el evento y los datos del evento', () => {
    const correo = componerCorreo(mensaje);

    expect(correo.html).toContain('LQBJ9V');
    expect(correo.html).toContain('908032');
    expect(correo.html).toContain('IV Seminario de Ingenieria de Software');
    expect(correo.html).toContain('Camara de Comercio - Pasto');
    expect(correo.html).toContain('Facultad de Ingenieria');
    expect(correo.texto).toContain('LQBJ9V');
  });

  it('no usa el saludo informal ni la paleta generica anterior', () => {
    const correo = componerCorreo(mensaje);

    expect(correo.texto).not.toContain('Hola Elier');
    expect(correo.html).not.toContain('1d31d4');
    expect(correo.html).not.toContain('#eef2ff');
    expect(correo.html).toContain('#132740');
  });

  it('escapa los datos del titular en el HTML', () => {
    const correo = componerCorreo({ ...mensaje, nombre: 'Ana <script>alert(1)</script>' });

    expect(correo.html).not.toContain('<script>');
    expect(correo.html).toContain('&lt;script&gt;');
  });
});
