import { and, eq, or, sql } from 'drizzle-orm';
import { generarCodigoRegistro, normalizarId } from '@seminario/shared';
import { db } from '../db/cliente.js';
import { asistentes } from '../db/esquema.js';
import { errores } from '../plugins/errores.js';

/**
 * Normaliza lo que el operador escribe: puede ser el ID institucional
 * (cedula o codigo estudiantil) o el codigo de registro corto.
 */
export function normalizarIdentificadorIngresado(valor: string): string {
  return valor.replace(/\s+/g, '').trim().toUpperCase();
}

/**
 * Busca un asistente por ID institucional o por codigo de registro.
 * Es la unica forma de buscar durante el registro: el operador nunca tiene que
 * saber cual de los dos digito.
 */
export async function buscarAsistentePorIdentificador(valor: string) {
  const normalizado = normalizarIdentificadorIngresado(valor);
  if (normalizado.length === 0) return null;

  const filas = await db
    .select()
    .from(asistentes)
    .where(
      or(
        eq(asistentes.id, normalizado),
        eq(asistentes.codigoRegistro, normalizado),
        eq(sql`upper(${asistentes.codigoRegistro})`, normalizado),
      )!,
    )
    .limit(1);

  return filas[0] ?? null;
}

/**
 * Genera un codigo de registro unico. La unicidad definitiva la impone el
 * indice unico de la base de datos; aqui se reintenta ante un choque.
 */
export async function generarCodigoDisponible(): Promise<string> {
  for (let intento = 0; intento < 20; intento += 1) {
    const codigo = generarCodigoRegistro();
    const existente = await db
      .select({ id: asistentes.id })
      .from(asistentes)
      .where(eq(asistentes.codigoRegistro, codigo))
      .limit(1);
    if (existente.length === 0) return codigo;
  }
  throw errores.conflicto('No fue posible generar un codigo de registro unico');
}

export interface DatosCrearAsistente {
  id: string;
  nombres: string;
  apellidos: string;
  rol: 'estudiante' | 'docente';
  semestre: number | null;
  email?: string | null;
  activo: boolean;
}

export async function crearAsistente(datos: DatosCrearAsistente) {
  const id = normalizarId(datos.id);
  const codigoRegistro = await generarCodigoDisponible();

  const insertados = await db
    .insert(asistentes)
    .values({
      id,
      codigoRegistro,
      email: datos.email ? datos.email.toLowerCase() : null,
      nombres: datos.nombres,
      apellidos: datos.apellidos,
      rol: datos.rol,
      semestre: datos.rol === 'docente' ? null : datos.semestre,
      activo: datos.activo,
    })
    .returning();

  return insertados[0]!;
}

export async function actualizarCorreo(
  asistenteId: string,
  email: string | null,
): Promise<void> {
  await db
    .update(asistentes)
    .set({ email: email ? email.toLowerCase() : null })
    .where(eq(asistentes.id, asistenteId));
}

export async function listarConCorreo(): Promise<
  { id: string; codigoRegistro: string | null; email: string | null; nombres: string; apellidos: string }[]
> {
  return db
    .select({
      id: asistentes.id,
      codigoRegistro: asistentes.codigoRegistro,
      email: asistentes.email,
      nombres: asistentes.nombres,
      apellidos: asistentes.apellidos,
    })
    .from(asistentes)
    .where(and(eq(asistentes.activo, true), sql`${asistentes.email} IS NOT NULL`));
}
