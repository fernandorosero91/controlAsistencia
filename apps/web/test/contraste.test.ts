import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rutaTokens = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/estilos/tokens.css',
);

const contenido = readFileSync(rutaTokens, 'utf8');

function leerToken(nombre: string): string {
  const coincidencia = contenido.match(new RegExp(`--color-${nombre}:\\s*#([0-9a-fA-F]{6})`));
  if (!coincidencia) throw new Error(`No se encontro el token --color-${nombre}`);
  return coincidencia[1]!;
}

function aRgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

function luminancia(hex: string): number {
  const canales = aRgb(hex).map((valor) => {
    const normalizado = valor / 255;
    return normalizado <= 0.03928
      ? normalizado / 12.92
      : ((normalizado + 0.055) / 1.055) ** 2.4;
  });
  const [r, g, b] = canales as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contraste(primero: string, segundo: string): number {
  const l1 = luminancia(primero);
  const l2 = luminancia(segundo);
  const claro = Math.max(l1, l2);
  const oscuro = Math.min(l1, l2);
  return (claro + 0.05) / (oscuro + 0.05);
}

describe('contraste de la paleta institucional', () => {
  const combinaciones: { nombre: string; texto: string; fondo: string; minimo: number }[] = [
    { nombre: 'texto principal sobre superficie', texto: 'neutro-900', fondo: 'neutro-50', minimo: 4.5 },
    { nombre: 'texto secundario sobre superficie', texto: 'neutro-600', fondo: 'neutro-50', minimo: 4.5 },
    { nombre: 'texto de etiqueta sobre superficie', texto: 'neutro-700', fondo: 'neutro-50', minimo: 4.5 },
    { nombre: 'texto de marca sobre superficie', texto: 'primario-700', fondo: 'primario-50', minimo: 4.5 },
    { nombre: 'texto de acento sobre superficie', texto: 'acento-700', fondo: 'acento-50', minimo: 4.5 },
    { nombre: 'texto de exito sobre fondo de exito', texto: 'exito-700', fondo: 'exito-100', minimo: 4.5 },
    { nombre: 'texto de aviso sobre fondo de aviso', texto: 'aviso-700', fondo: 'aviso-100', minimo: 4.5 },
    { nombre: 'texto de error sobre fondo de error', texto: 'error-700', fondo: 'error-100', minimo: 4.5 },
    { nombre: 'blanco sobre boton primario', texto: 'neutro-50', fondo: 'primario-600', minimo: 4.5 },
    { nombre: 'blanco sobre el extremo claro del degradado', texto: 'neutro-50', fondo: 'marca-500', minimo: 4.5 },
    { nombre: 'blanco sobre el extremo oscuro del degradado', texto: 'neutro-50', fondo: 'marca-600', minimo: 4.5 },
    { nombre: 'enlace primario sobre blanco', texto: 'primario-600', fondo: 'neutro-50', minimo: 4.5 },
    { nombre: 'anillo de foco sobre la superficie', texto: 'acento-600', fondo: 'neutro-50', minimo: 3 },
  ];

  for (const combinacion of combinaciones) {
    it(`${combinacion.nombre} cumple el minimo ${combinacion.minimo}:1`, () => {
      const ratio = contraste(
        leerToken(combinacion.texto),
        leerToken(combinacion.fondo),
      );
      expect(ratio).toBeGreaterThanOrEqual(combinacion.minimo);
    });
  }

  it('el texto de resultado es legible sobre el fondo del aviso', () => {
    const ratio = contraste(leerToken('neutro-700'), leerToken('aviso-100'));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });
});
