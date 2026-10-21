import ExcelJS from 'exceljs';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import {
  cumpleFormatoId,
  normalizarId,
  ROLES_ASISTENTE,
  type ErrorImportacion,
  type FilaAsistenteImportada,
  type VistaPreviaImportacion,
} from '@seminario/shared';

const ENCABEZADOS = ['id', 'nombres', 'apellidos', 'rol', 'semestre'] as const;

export type FormatoImportacion = 'csv' | 'xlsx';

export interface ResultadoParseo {
  filas: { fila: number; datos: Record<string, string> }[];
  errorLectura?: string;
}

function aTexto(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'string') return valor.trim();
  if (typeof valor === 'number' || typeof valor === 'boolean') return String(valor);
  if (valor instanceof Date) return valor.toISOString();
  return String(valor).trim();
}

/** Convierte el contenido de un CSV a filas indexadas por numero de fila real. */
export function parsearCsv(contenido: string): ResultadoParseo {
  const registros = parse(contenido, {
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    bom: true,
  }) as string[][];

  if (registros.length === 0) {
    return { filas: [], errorLectura: 'El archivo esta vacio' };
  }

  const encabezados = registros[0]!.map((valor) => valor.toLowerCase().trim());
  const faltantes = ENCABEZADOS.filter(
    (encabezado) => !encabezados.includes(encabezado) && encabezado !== 'semestre',
  );
  if (faltantes.length > 0) {
    return {
      filas: [],
      errorLectura: `Faltan columnas obligatorias en el archivo: ${faltantes.join(', ')}`,
    };
  }

  const filas = registros.slice(1).map((celdas, indice) => {
    const datos: Record<string, string> = {};
    encabezados.forEach((encabezado, indiceCelda) => {
      datos[encabezado] = aTexto(celdas[indiceCelda]);
    });
    return { fila: indice + 2, datos };
  });

  return { filas };
}

/** Convierte la primera hoja de un XLSX a filas indexadas por numero de fila real. */
export async function parsearXlsx(buffer: Buffer): Promise<ResultadoParseo> {
  const libro = new ExcelJS.Workbook();
  // ExcelJS declara su propio tipo Buffer (distinto @types/node), por eso se usa `never`.
  await libro.xlsx.load(buffer as never);
  const hoja = libro.worksheets[0];
  if (!hoja) {
    return { filas: [], errorLectura: 'El archivo no tiene hojas' };
  }

  const filas: { fila: number; datos: Record<string, string> }[] = [];
  let encabezados: string[] | null = null;

  hoja.eachRow((fila) => {
    const valores = (fila.values as unknown[]).slice(1).map(aTexto);
    if (valores.every((valor) => valor.length === 0)) return;

    if (!encabezados) {
      encabezados = valores.map((valor) => valor.toLowerCase().trim());
      return;
    }

    const datos: Record<string, string> = {};
    encabezados.forEach((encabezado, indice) => {
      datos[encabezado] = valores[indice] ?? '';
    });
    filas.push({ fila: fila.number, datos });
  });

  if (!encabezados) {
    return { filas: [], errorLectura: 'El archivo no tiene encabezados' };
  }

  const faltantes = ENCABEZADOS.filter(
    (encabezado) => !encabezados!.includes(encabezado) && encabezado !== 'semestre',
  );
  if (faltantes.length > 0) {
    return {
      filas: [],
      errorLectura: `Faltan columnas obligatorias en el archivo: ${faltantes.join(', ')}`,
    };
  }

  return { filas };
}

export interface ValidacionFila {
  fila: number;
  datos: Partial<FilaAsistenteImportada>;
  errores: ErrorImportacion[];
  valida: boolean;
}

const rolSchema = z.enum(ROLES_ASISTENTE);

/**
 * Valida una fila del archivo. El ID se normaliza igual que en la app del operador
 * para que el mismo ID siempre represente al mismo asistente.
 */
export function validarFila(
  fila: number,
  datos: Record<string, string>,
  idRegex: string,
): ValidacionFila {
  const errores: ErrorImportacion[] = [];
  const idOriginal = datos.id ?? '';
  const id = normalizarId(idOriginal);
  const nombres = (datos.nombres ?? '').trim();
  const apellidos = (datos.apellidos ?? '').trim();
  const rolTexto = (datos.rol ?? '').trim().toLowerCase();
  const semestreTexto = (datos.semestre ?? '').trim();
  const correoTexto = (datos.email ?? '').trim().toLowerCase();

  if (idOriginal.length === 0) {
    errores.push({ fila, campo: 'id', mensaje: 'El ID es obligatorio', valor: null });
  } else if (!cumpleFormatoId(id, idRegex)) {
    errores.push({
      fila,
      campo: 'id',
      mensaje: `El ID no cumple el formato configurado (${idRegex})`,
      valor: idOriginal,
    });
  }

  if (nombres.length === 0) {
    errores.push({ fila, campo: 'nombres', mensaje: 'Los nombres son obligatorios', valor: null });
  }

  if (apellidos.length === 0) {
    errores.push({
      fila,
      campo: 'apellidos',
      mensaje: 'Los apellidos son obligatorios',
      valor: null,
    });
  }

  const rol = rolSchema.safeParse(rolTexto);
  if (!rol.success) {
    errores.push({
      fila,
      campo: 'rol',
      mensaje: `El rol debe ser ${ROLES_ASISTENTE.join(' o ')}`,
      valor: datos.rol ?? null,
    });
  }

  let semestre: number | null = null;
  if (semestreTexto.length > 0) {
    const numero = Number(semestreTexto);
    if (!Number.isInteger(numero) || numero < 1 || numero > 30) {
      errores.push({
        fila,
        campo: 'semestre',
        mensaje: 'El semestre debe ser un numero entero entre 1 y 30',
        valor: semestreTexto,
      });
    } else {
      semestre = numero;
    }
  }

  if (rol.success && rol.data === 'estudiante' && semestre === null) {
    errores.push({
      fila,
      campo: 'semestre',
      mensaje: 'El semestre es obligatorio para estudiantes',
      valor: null,
    });
  }

  if (rol.success && rol.data === 'docente' && semestre !== null) {
    errores.push({
      fila,
      campo: 'semestre',
      mensaje: 'El semestre no aplica para docentes',
      valor: semestreTexto,
    });
  }

  let correo: string | null = null;
  if (correoTexto.length > 0) {
    const resultadoCorreo = z
      .string()
      .email('Correo electronico invalido')
      .max(120)
      .safeParse(correoTexto);
    if (!resultadoCorreo.success) {
      errores.push({
        fila,
        campo: 'email',
        mensaje: 'El correo electronico no tiene un formato valido',
        valor: correoTexto,
      });
    } else {
      correo = correoTexto;
    }
  }

  return {
    fila,
    datos: {
      id: idOriginal.length > 0 ? id : '',
      nombres,
      apellidos,
      rol: rol.success ? rol.data : 'estudiante',
      semestre,
      email: correo ?? '',
    },
    errores,
    valida: errores.length === 0,
  };
}

export function construirVistaPrevia(
  validaciones: ValidacionFila[],
  nuevos: number,
  actualizados: number,
  duplicados: number,
  totalEnArchivo: number,
): VistaPreviaImportacion {
  return {
    totalFilas: totalEnArchivo,
    filasValidas: validaciones.filter((v) => v.valida).length,
    filasConError: validaciones.filter((v) => !v.valida).length,
    nuevos,
    actualizados,
    duplicadosEnArchivo: duplicados,
    muestra: validaciones.slice(0, 50).map((validacion) => ({
      fila: validacion.fila,
      datos: validacion.datos,
      errores: validacion.errores,
    })),
  };
}
