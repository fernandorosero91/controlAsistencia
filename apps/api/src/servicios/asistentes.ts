import { and, asc, eq, or, sql } from 'drizzle-orm';
import { generarCodigoRegistro, normalizarCedula, normalizarId } from '@seminario/shared';
import { db } from '../db/cliente.js';
import { asistencias, asistentes, jornadas, usuariosSistema } from '../db/esquema.js';
import { errores } from '../plugins/errores.js';

/**
 * Normaliza lo que el operador escribe: puede ser el ID institucional
 * (cedula o codigo estudiantil) o el codigo de registro corto.
 */
export function normalizarIdentificadorIngresado(valor: string): string {
  return valor.replace(/\s+/g, '').trim().toUpperCase();
}

/**
 * Busca un asistente por ID institucional, por codigo de registro o por cedula
 * de ciudadania. Es la unica forma de buscar durante el registro: el operador
 * nunca tiene que saber cual de los tres digito.
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
        // La cedula tambien sirve para registrar: si la escarapela esta danada
        // o mal impresa, el operador puede escribirla.
        eq(asistentes.cedulaCiudadania, normalizarCedula(normalizado)),
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
  tipoDocumento?: 'CC' | 'TI';
  cedulaCiudadania?: string | null;
  email?: string | null;
  activo: boolean;
}

/** Normaliza la cedula para guardarla: vacia si no se envio. */
function cedulaNormalizada(valor: string | null | undefined): string | null {
  if (!valor) return null;
  const normalizada = normalizarCedula(valor);
  return normalizada.length > 0 ? normalizada : null;
}

export async function crearAsistente(datos: DatosCrearAsistente) {
  const id = normalizarId(datos.id);
  const codigoRegistro = await generarCodigoDisponible();

  const insertados = await db
    .insert(asistentes)
    .values({
      id,
      codigoRegistro,
      cedulaCiudadania: cedulaNormalizada(datos.cedulaCiudadania),
      tipoDocumento: datos.tipoDocumento ?? 'CC',
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

export interface ResultadoLote {
  insertados: number;
  fallidos: number;
}

/**
 * Inserta un lote de asistentes nuevos.
 *
 * Importar el padron completo son unas 600 filas: hacerlo con un insert por
 * fila (y una consulta adicional por fila para buscar un codigo de registro
 * libre) multiplica el tiempo de espera del administrador. Aqui los codigos se
 * generan en memoria y se insertan en bloques de 200; solo si un codigo choca
 * con uno existente (caso muy improbable) esa fila se reintenta por separado.
 */
export async function crearAsistentesLote(lista: DatosCrearAsistente[]): Promise<ResultadoLote> {
  if (lista.length === 0) return { insertados: 0, fallidos: 0 };

  const usados = new Set<string>();
  const filas = lista.map((datos) => {
    let codigo = generarCodigoRegistro();
    while (usados.has(codigo)) codigo = generarCodigoRegistro();
    usados.add(codigo);
    return {
      id: normalizarId(datos.id),
      codigoRegistro: codigo,
      cedulaCiudadania: cedulaNormalizada(datos.cedulaCiudadania),
      tipoDocumento: datos.tipoDocumento ?? 'CC',
      email: datos.email ? datos.email.toLowerCase() : null,
      nombres: datos.nombres,
      apellidos: datos.apellidos,
      rol: datos.rol,
      semestre: datos.rol === 'docente' ? null : datos.semestre,
      activo: datos.activo,
    };
  });

  const insertadosIds = new Set<string>();
  for (let indice = 0; indice < filas.length; indice += 200) {
    const lote = filas.slice(indice, indice + 200);
    const resultado = await db
      .insert(asistentes)
      .values(lote)
      .onConflictDoNothing()
      .returning({ id: asistentes.id });
    for (const fila of resultado) insertadosIds.add(fila.id);
  }

  // Filas que chocaron con un codigo de registro ya usado: se reintentan una
  // por una con un codigo nuevo.
  for (const fila of filas) {
    if (insertadosIds.has(fila.id)) continue;
    const codigo = await generarCodigoDisponible();
    const resultado = await db
      .insert(asistentes)
      .values({ ...fila, codigoRegistro: codigo })
      .onConflictDoNothing()
      .returning({ id: asistentes.id });
    if (resultado.length > 0) insertadosIds.add(fila.id);
  }

  return { insertados: insertadosIds.size, fallidos: filas.length - insertadosIds.size };
}

export async function actualizarCorreo(asistenteId: string, email: string | null): Promise<void> {
  await db
    .update(asistentes)
    .set({ email: email ? email.toLowerCase() : null })
    .where(eq(asistentes.id, asistenteId));
}

export async function listarConCorreo(opciones: { soloPendientes?: boolean } = {}): Promise<
  {
    id: string;
    codigoRegistro: string | null;
    cedulaCiudadania: string | null;
    tipoDocumento: 'CC' | 'TI';
    email: string | null;
    nombres: string;
    apellidos: string;
    rol: 'estudiante' | 'docente';
    semestre: number | null;
  }[]
> {
  const condiciones = [eq(asistentes.activo, true), sql`${asistentes.email} IS NOT NULL`];

  // Pendientes = nunca se envio o el ultimo intento fallo. Los que estan en cola
  // o ya recibieron el correo se omiten para no duplicar.
  if (opciones.soloPendientes !== false) {
    condiciones.push(
      sql`(${asistentes.credencialEstado} IS NULL OR ${asistentes.credencialEstado} = 'error')`,
    );
  }

  return db
    .select({
      id: asistentes.id,
      codigoRegistro: asistentes.codigoRegistro,
      cedulaCiudadania: asistentes.cedulaCiudadania,
      tipoDocumento: asistentes.tipoDocumento,
      email: asistentes.email,
      nombres: asistentes.nombres,
      apellidos: asistentes.apellidos,
      rol: asistentes.rol,
      semestre: asistentes.semestre,
    })
    .from(asistentes)
    .where(and(...condiciones));
}

export interface VerificacionAsistente {
  encontrado: boolean;
  asistente: {
    id: string;
    codigoRegistro: string | null;
    cedulaCiudadania: string | null;
    tipoDocumento: 'CC' | 'TI';
    nombres: string;
    apellidos: string;
    rol: 'estudiante' | 'docente';
    semestre: number | null;
  } | null;
  jornadas: {
    jornadaId: number;
    jornadaNombre: string;
    tieneIngreso: boolean;
    horaIngreso: string | null;
    horaSalida: string | null;
    registradoPor: string | null;
  }[];
}

/**
 * Verificacion previa de un asistente: devuelve el nombre para que el operador lo
 * compare con la escarapela antes de registrar, y el estado de cada jornada.
 */
export async function verificarAsistente(valor: string): Promise<VerificacionAsistente> {
  const [asistente, listaJornadas] = await Promise.all([
    buscarAsistentePorIdentificador(valor),
    db.select().from(jornadas).orderBy(asc(jornadas.orden), asc(jornadas.inicio)),
  ]);

  if (!asistente) {
    return { encontrado: false, asistente: null, jornadas: [] };
  }

  const registros = await db
    .select({
      jornadaId: asistencias.jornadaId,
      horaIngreso: asistencias.horaIngreso,
      horaSalida: asistencias.horaSalida,
      registradoPor: usuariosSistema.nombre,
    })
    .from(asistencias)
    .leftJoin(usuariosSistema, eq(usuariosSistema.id, asistencias.registradoPor))
    .where(eq(asistencias.asistenteId, asistente.id));

  const porJornada = new Map(registros.map((registro) => [registro.jornadaId, registro]));

  return {
    encontrado: true,
    asistente: {
      id: asistente.id,
      codigoRegistro: asistente.codigoRegistro,
      cedulaCiudadania: asistente.cedulaCiudadania,
      tipoDocumento: asistente.tipoDocumento,
      nombres: asistente.nombres,
      apellidos: asistente.apellidos,
      rol: asistente.rol,
      semestre: asistente.semestre,
    },
    jornadas: listaJornadas.map((jornada) => {
      const registro = porJornada.get(jornada.id);
      return {
        jornadaId: jornada.id,
        jornadaNombre: jornada.nombre,
        tieneIngreso: Boolean(registro),
        horaIngreso: registro?.horaIngreso.toISOString() ?? null,
        horaSalida: registro?.horaSalida?.toISOString() ?? null,
        registradoPor: registro?.registradoPor ?? null,
      };
    }),
  };
}
