import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { generarCartaQrPDF, generarEscarapelaPDF } from '../../src/servicios/pdf.js';

/**
 * La escarapela que se adjunta al correo debe ser del tamano de la tarjeta, no
 * una hoja A4 con espacios en blanco. Estas pruebas fijan el tamano de pagina
 * para que un cambio futuro no vuelva a enviar la hoja completa.
 */

const asistente = {
  asistente: {
    id: 'ESC90001',
    nombres: 'Maria Jose',
    apellidos: 'Fernandez De La Hoz',
    rol: 'estudiante' as const,
    semestre: 7,
  },
  codigoRegistro: '9FSAV2',
  idInstitucional: 'ESC90001',
  cedulaCiudadania: '1112223334',
  email: 'maria.jose@universidadcooperativa.edu.co',
  nombreSeminario: 'IV Seminario de Ingenieria de Software',
  facultad: 'Facultad de Ingenieria',
  fecha: '2026-10-27',
  lugar: 'Camara de Comercio - Pasto',
};

describe('escarapela en PDF', () => {
  it('la version individual mide exactamente lo que la tarjeta', async () => {
    const pdf = await generarEscarapelaPDF(asistente);
    const documento = await PDFDocument.load(pdf);

    expect(documento.getPageCount()).toBe(1);
    const { width, height } = documento.getPage(0).getSize();
    expect(Math.round(width)).toBe(280);
    expect(Math.round(height)).toBe(400);
  });

  it('la carta para imprimir sigue siendo A4 con cuatro tarjetas por hoja', async () => {
    const datos = [asistente, { ...asistente, idInstitucional: 'ESC90002' }];
    const pdf = await generarCartaQrPDF(datos);
    const documento = await PDFDocument.load(pdf);

    expect(documento.getPageCount()).toBe(1);
    const { width, height } = documento.getPage(0).getSize();
    expect(Math.round(width)).toBe(595);
    expect(Math.round(height)).toBe(842);
  });

  it('la escarapela individual pesa mucho menos que la hoja A4', async () => {
    const individual = await generarEscarapelaPDF(asistente);
    const hoja = await generarCartaQrPDF([asistente]);

    expect(individual.length).toBeLessThan(hoja.length);
  });
});
