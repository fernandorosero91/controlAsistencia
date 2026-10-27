import { and, asc, eq, sql } from 'drizzle-orm';
import { normalizarId, type AsistenteResumen, type RespuestaRegistro } from '@seminario/shared';
import { db } from '../db/cliente.js';
import {
  asistencias,
  asistentes,
  entregasRefrigerio,
  entregasSouvenir,
  jornadas,
  tiposRefrigerio,
  tiposSouvenir,
  usuariosSistema,
} from '../db/esquema.js';
import { obtenerConfig } from './configuracion.js';
import { buscarAsistentePorIdentificador } from './asistentes.js';

export interface ContextoOperador {
  usuarioId: string;
  usuarioNombre: string;
  dispositivo?: string | null;
  idempotencyKey?: string | null;
  ahora?: Date;
  /**
   * Jornada que el servidor considera vigente. Si llega y no coincide con la
   * jornada del registro, se rechaza: el operador no puede registrar en otra
   * jornada por error. Va en null en los registros diferidos (cola offline),
   * que se capturaron cuando su jornada si estaba vigente.
   */
  jornadaVigente?: { id: number; nombre: string } | null;
}

function mensajeJornadaEquivocada(
  jornadaVigente: { id: number; nombre: string },
  jornadaSolicitada: string,
): string {
  return `La jornada activa es "${jornadaVigente.nombre}". Este registro corresponde a "${jornadaSolicitada}", que no es la jornada en curso.`;
}

function aResumen(fila: {
  id: string;
  codigoRegistro: string | null;
  nombres: string;
  apellidos: string;
  rol: 'estudiante' | 'docente';
  semestre: number | null;
}): AsistenteResumen {
  return {
    id: fila.id,
    codigoRegistro: fila.codigoRegistro,
    nombres: fila.nombres,
    apellidos: fila.apellidos,
    rol: fila.rol,
    semestre: fila.semestre,
  };
}

export async function buscarAsistentePorId(id: string) {
  const normalizado = normalizarId(id);
  const filas = await db.select().from(asistentes).where(eq(asistentes.id, normalizado)).limit(1);
  return filas[0] ?? null;
}

/**
 * Busqueda usada durante el registro: acepta el ID institucional (cedula o
 * codigo estudiantil) o el codigo de registro corto que codifica el QR.
 */
export async function buscarParaRegistro(valor: string) {
  return buscarAsistentePorIdentificador(valor);
}

async function obtenerJornada(jornadaId: number) {
  const filas = await db.select().from(jornadas).where(eq(jornadas.id, jornadaId)).limit(1);
  return filas[0] ?? null;
}

/**
 * Registra el ingreso de un asistente a una jornada.
 *
 * La escritura es una sola sentencia atomica con ON CONFLICT DO NOTHING sobre el
 * constraint UNIQUE (asistente_id, jornada_id). Nunca se consulta y luego se inserta:
 * la garantia de unicidad la impone la base de datos, no la aplicacion.
 */
export async function registrarIngreso(
  parametros: {
    asistenteId: string;
    jornadaId: number;
  } & ContextoOperador,
): Promise<RespuestaRegistro> {
  const ahora = parametros.ahora ?? new Date();
  const asistente = await buscarAsistentePorIdentificador(parametros.asistenteId);

  if (!asistente) {
    return {
      resultado: 'no_encontrado',
      mensaje: 'ID no encontrado. Verifique el codigo o use la busqueda manual por nombre.',
      asistente: null,
      existente: null,
      requiereBusquedaManual: true,
    };
  }

  if (!asistente.activo) {
    return {
      resultado: 'no_permitido',
      mensaje: 'El asistente esta inactivo en el sistema. Contacte al administrador.',
      asistente: aResumen(asistente),
      existente: null,
      requiereBusquedaManual: false,
    };
  }

  const jornada = await obtenerJornada(parametros.jornadaId);
  if (!jornada) {
    return {
      resultado: 'no_permitido',
      mensaje: 'La jornada indicada no existe.',
      asistente: aResumen(asistente),
      existente: null,
      requiereBusquedaManual: false,
    };
  }

  if (parametros.jornadaVigente && parametros.jornadaVigente.id !== jornada.id) {
    return {
      resultado: 'no_permitido',
      mensaje: mensajeJornadaEquivocada(parametros.jornadaVigente, jornada.nombre),
      asistente: aResumen(asistente),
      existente: null,
      requiereBusquedaManual: false,
    };
  }

  const dentroDeVentana =
    ahora.getTime() >= jornada.ventanaCheckinInicio.getTime() &&
    ahora.getTime() <= jornada.ventanaCheckinFin.getTime();

  if (!dentroDeVentana) {
    const config = await obtenerConfig();
    if (!config.permitirRegistroFueraDeVentana) {
      const ventana = `${jornada.ventanaCheckinInicio.toLocaleString('es-CO', {
        timeZone: 'America/Bogota',
      })} a ${jornada.ventanaCheckinFin.toLocaleString('es-CO', { timeZone: 'America/Bogota' })}`;
      return {
        resultado: 'fuera_de_ventana',
        mensaje: `Esta jornada no tiene abierta la ventana de registro (${ventana}). Contacte al administrador.`,
        asistente: aResumen(asistente),
        existente: null,
        requiereBusquedaManual: false,
      };
    }
  }

  const insertado = await db
    .insert(asistencias)
    .values({
      asistenteId: asistente.id,
      jornadaId: jornada.id,
      horaIngreso: ahora,
      registradoPor: parametros.usuarioId,
      dispositivo: parametros.dispositivo ?? null,
      idempotencyKey: parametros.idempotencyKey ?? null,
    })
    .onConflictDoNothing({ target: [asistencias.asistenteId, asistencias.jornadaId] })
    .returning({ id: asistencias.id });

  if (insertado.length > 0) {
    return {
      resultado: 'exito',
      mensaje: 'Ingreso registrado correctamente.',
      asistente: aResumen(asistente),
      existente: {
        id: asistente.id,
        jornadaId: jornada.id,
        jornadaNombre: jornada.nombre,
        horaIngreso: ahora.toISOString(),
        horaSalida: null,
        registradoPor: parametros.usuarioNombre,
        dispositivo: parametros.dispositivo ?? null,
      },
      requiereBusquedaManual: false,
    };
  }

  const existente = await db
    .select({
      id: asistencias.id,
      jornadaId: asistencias.jornadaId,
      jornadaNombre: jornadas.nombre,
      horaIngreso: asistencias.horaIngreso,
      horaSalida: asistencias.horaSalida,
      registradoPor: usuariosSistema.nombre,
      dispositivo: asistencias.dispositivo,
    })
    .from(asistencias)
    .leftJoin(usuariosSistema, eq(usuariosSistema.id, asistencias.registradoPor))
    .innerJoin(jornadas, eq(jornadas.id, asistencias.jornadaId))
    .where(and(eq(asistencias.asistenteId, asistente.id), eq(asistencias.jornadaId, jornada.id)))
    .limit(1);

  const original = existente[0];
  return {
    resultado: 'duplicado',
    mensaje: 'Asistencia ya registrada para esta jornada.',
    asistente: aResumen(asistente),
    existente: original
      ? {
          id: String(original.id),
          jornadaId: original.jornadaId,
          jornadaNombre: original.jornadaNombre,
          horaIngreso: original.horaIngreso.toISOString(),
          horaSalida: original.horaSalida ? original.horaSalida.toISOString() : null,
          registradoPor: original.registradoPor ?? 'Operador no identificado',
          dispositivo: original.dispositivo,
        }
      : null,
    requiereBusquedaManual: false,
  };
}

/**
 * Registra la salida (cierre) de un asistente.
 * Solo es posible si existe un ingreso registrado en la misma jornada.
 */
export async function registrarSalida(
  parametros: {
    asistenteId: string;
    jornadaId: number;
  } & ContextoOperador,
): Promise<RespuestaRegistro> {
  const ahora = parametros.ahora ?? new Date();
  const asistente = await buscarAsistentePorIdentificador(parametros.asistenteId);

  if (!asistente) {
    return {
      resultado: 'no_encontrado',
      mensaje: 'ID no encontrado. Verifique el codigo o use la busqueda manual por nombre.',
      asistente: null,
      existente: null,
      requiereBusquedaManual: true,
    };
  }

  const jornada = await obtenerJornada(parametros.jornadaId);
  if (!jornada) {
    return {
      resultado: 'no_permitido',
      mensaje: 'La jornada indicada no existe.',
      asistente: aResumen(asistente),
      existente: null,
      requiereBusquedaManual: false,
    };
  }

  if (parametros.jornadaVigente && parametros.jornadaVigente.id !== jornada.id) {
    return {
      resultado: 'no_permitido',
      mensaje: mensajeJornadaEquivocada(parametros.jornadaVigente, jornada.nombre),
      asistente: aResumen(asistente),
      existente: null,
      requiereBusquedaManual: false,
    };
  }

  const actualizadas = await db
    .update(asistencias)
    .set({
      horaSalida: ahora,
      registradoSalidaPor: parametros.usuarioId,
    })
    .where(
      and(
        eq(asistencias.asistenteId, asistente.id),
        eq(asistencias.jornadaId, jornada.id),
        sql`${asistencias.horaSalida} IS NULL`,
      ),
    )
    .returning({ id: asistencias.id });

  if (actualizadas.length > 0) {
    return {
      resultado: 'exito',
      mensaje: 'Salida registrada correctamente.',
      asistente: aResumen(asistente),
      existente: {
        id: asistente.id,
        jornadaId: jornada.id,
        jornadaNombre: jornada.nombre,
        horaIngreso: ahora.toISOString(),
        horaSalida: ahora.toISOString(),
        registradoPor: parametros.usuarioNombre,
        dispositivo: parametros.dispositivo ?? null,
      },
      requiereBusquedaManual: false,
    };
  }

  const existente = await db
    .select({
      id: asistencias.id,
      jornadaId: asistencias.jornadaId,
      jornadaNombre: jornadas.nombre,
      horaIngreso: asistencias.horaIngreso,
      horaSalida: asistencias.horaSalida,
      registradoPor: usuariosSistema.nombre,
      dispositivo: asistencias.dispositivo,
    })
    .from(asistencias)
    .leftJoin(usuariosSistema, eq(usuariosSistema.id, asistencias.registradoPor))
    .innerJoin(jornadas, eq(jornadas.id, asistencias.jornadaId))
    .where(and(eq(asistencias.asistenteId, asistente.id), eq(asistencias.jornadaId, jornada.id)))
    .limit(1);

  const original = existente[0];
  if (!original) {
    return {
      resultado: 'no_permitido',
      mensaje: 'No hay un ingreso registrado en esta jornada, no se puede registrar la salida.',
      asistente: aResumen(asistente),
      existente: null,
      requiereBusquedaManual: false,
    };
  }

  return {
    resultado: 'duplicado',
    mensaje: 'La salida ya estaba registrada para esta jornada.',
    asistente: aResumen(asistente),
    existente: {
      id: String(original.id),
      jornadaId: original.jornadaId,
      jornadaNombre: original.jornadaNombre,
      horaIngreso: original.horaIngreso.toISOString(),
      horaSalida: original.horaSalida ? original.horaSalida.toISOString() : null,
      registradoPor: original.registradoPor ?? 'Operador no identificado',
      dispositivo: original.dispositivo,
    },
    requiereBusquedaManual: false,
  };
}

/**
 * Entrega un refrigerio. Solo es posible si el asistente tiene asistencia registrada
 * en la jornada a la que pertenece el refrigerio. La unicidad la garantiza el
 * constraint UNIQUE (asistente_id, tipo_refrigerio_id).
 */
export async function entregarRefrigerio(
  parametros: {
    asistenteId: string;
    tipoRefrigerioId: number;
  } & ContextoOperador,
): Promise<RespuestaRegistro> {
  const ahora = parametros.ahora ?? new Date();
  const asistente = await buscarAsistentePorIdentificador(parametros.asistenteId);

  if (!asistente) {
    return {
      resultado: 'no_encontrado',
      mensaje: 'ID no encontrado. Verifique el codigo o use la busqueda manual por nombre.',
      asistente: null,
      existente: null,
      requiereBusquedaManual: true,
    };
  }

  const tipos = await db
    .select()
    .from(tiposRefrigerio)
    .where(eq(tiposRefrigerio.id, parametros.tipoRefrigerioId))
    .limit(1);
  const tipo = tipos[0];

  if (!tipo || !tipo.activo) {
    return {
      resultado: 'no_permitido',
      mensaje: 'El refrigerio no existe o no esta activo.',
      asistente: aResumen(asistente),
      existente: null,
      requiereBusquedaManual: false,
    };
  }

  if (parametros.jornadaVigente && parametros.jornadaVigente.id !== tipo.jornadaId) {
    const jornadaDelTipo = await obtenerJornada(tipo.jornadaId);
    return {
      resultado: 'no_permitido',
      mensaje: mensajeJornadaEquivocada(
        parametros.jornadaVigente,
        jornadaDelTipo?.nombre ?? 'otra jornada',
      ),
      asistente: aResumen(asistente),
      existente: null,
      requiereBusquedaManual: false,
    };
  }

  const asistencia = await db
    .select({ id: asistencias.id })
    .from(asistencias)
    .where(
      and(eq(asistencias.asistenteId, asistente.id), eq(asistencias.jornadaId, tipo.jornadaId)),
    )
    .limit(1);

  if (asistencia.length === 0) {
    return {
      resultado: 'no_permitido',
      mensaje: 'El asistente no tiene asistencia registrada en la jornada de este refrigerio.',
      asistente: aResumen(asistente),
      existente: null,
      requiereBusquedaManual: false,
    };
  }

  const insertada = await db
    .insert(entregasRefrigerio)
    .values({
      asistenteId: asistente.id,
      tipoRefrigerioId: tipo.id,
      entregadoAt: ahora,
      entregadoPor: parametros.usuarioId,
      dispositivo: parametros.dispositivo ?? null,
      idempotencyKey: parametros.idempotencyKey ?? null,
    })
    .onConflictDoNothing({
      target: [entregasRefrigerio.asistenteId, entregasRefrigerio.tipoRefrigerioId],
    })
    .returning({ id: entregasRefrigerio.id });

  if (insertada.length > 0) {
    return {
      resultado: 'exito',
      mensaje: 'Refrigerio entregado correctamente.',
      asistente: aResumen(asistente),
      existente: {
        id: String(insertada[0]!.id),
        tipoRefrigerioId: tipo.id,
        tipoRefrigerioNombre: tipo.nombre,
        entregadoAt: ahora.toISOString(),
        entregadoPor: parametros.usuarioNombre,
      },
      requiereBusquedaManual: false,
    };
  }

  const previa = await db
    .select({
      id: entregasRefrigerio.id,
      tipoRefrigerioId: entregasRefrigerio.tipoRefrigerioId,
      tipoRefrigerioNombre: tiposRefrigerio.nombre,
      entregadoAt: entregasRefrigerio.entregadoAt,
      entregadoPor: usuariosSistema.nombre,
    })
    .from(entregasRefrigerio)
    .leftJoin(usuariosSistema, eq(usuariosSistema.id, entregasRefrigerio.entregadoPor))
    .innerJoin(tiposRefrigerio, eq(tiposRefrigerio.id, entregasRefrigerio.tipoRefrigerioId))
    .where(
      and(
        eq(entregasRefrigerio.asistenteId, asistente.id),
        eq(entregasRefrigerio.tipoRefrigerioId, tipo.id),
      ),
    )
    .limit(1);

  const original = previa[0];
  return {
    resultado: 'duplicado',
    mensaje: 'El refrigerio ya fue entregado a este asistente.',
    asistente: aResumen(asistente),
    existente: original
      ? {
          id: String(original.id),
          tipoRefrigerioId: original.tipoRefrigerioId,
          tipoRefrigerioNombre: original.tipoRefrigerioNombre,
          entregadoAt: original.entregadoAt.toISOString(),
          entregadoPor: original.entregadoPor ?? 'Operador no identificado',
        }
      : null,
    requiereBusquedaManual: false,
  };
}

/**
 * Entrega un souvenir o regalo. Se controla una sola vez por asistente y tipo,
 * sin importar la jornada: el souvenir es del evento.
 *
 * Requisito de negocio: solo se entrega a quien registro su **ingreso en la
 * primera jornada** (la de menor `orden`). La entrega se hace en la manana, y
 * con esta regla quien solo llego en la tarde no lo recibe. La unicidad la
 * garantiza el indice unico (asistente_id, tipo_souvenir_id).
 */
export async function entregarSouvenir(
  parametros: {
    asistenteId: string;
    tipoSouvenirId: number;
    /** El rol decide si puede aplicar la excepcion manual. */
    rolUsuario: 'admin' | 'operador';
    forzar?: boolean;
    motivo?: string;
  } & ContextoOperador,
): Promise<RespuestaRegistro> {
  const ahora = parametros.ahora ?? new Date();
  const asistente = await buscarAsistentePorIdentificador(parametros.asistenteId);

  if (!asistente) {
    return {
      resultado: 'no_encontrado',
      mensaje: 'ID no encontrado. Verifique el codigo o use la busqueda manual por nombre.',
      asistente: null,
      existente: null,
      requiereBusquedaManual: true,
    };
  }

  const tipos = await db
    .select()
    .from(tiposSouvenir)
    .where(eq(tiposSouvenir.id, parametros.tipoSouvenirId))
    .limit(1);
  const tipo = tipos[0];

  if (!tipo || !tipo.activo) {
    return {
      resultado: 'no_permitido',
      mensaje: 'El souvenir no existe o no esta activo.',
      asistente: aResumen(asistente),
      existente: null,
      requiereBusquedaManual: false,
    };
  }

  const primeraJornada = (
    await db
      .select({ id: jornadas.id, nombre: jornadas.nombre })
      .from(jornadas)
      .orderBy(asc(jornadas.orden), asc(jornadas.inicio))
      .limit(1)
  )[0];

  if (!primeraJornada) {
    return {
      resultado: 'no_permitido',
      mensaje: 'No hay jornadas configuradas: no se puede validar la entrega del souvenir.',
      asistente: aResumen(asistente),
      existente: null,
      requiereBusquedaManual: false,
    };
  }

  // Una fila de asistencias existe cuando se registro el ingreso: se exige la
  // de la primera jornada, no una asistencia cualquiera del evento.
  const asistencia = await db
    .select({ id: asistencias.id })
    .from(asistencias)
    .where(
      and(
        eq(asistencias.asistenteId, asistente.id),
        eq(asistencias.jornadaId, primeraJornada.id),
      ),
    )
    .limit(1);

  let excepcionManual = false;
  let motivoExcepcion: string | null = null;

  if (asistencia.length === 0) {
    const esAdmin = parametros.rolUsuario === 'admin';
    const mensajeCondicion =
      `El souvenir se entrega a quienes registraron su ingreso en la primera jornada ` +
      `(${primeraJornada.nombre}). Este asistente no tiene ese ingreso.`;

    if (!esAdmin || parametros.forzar !== true) {
      return {
        resultado: 'no_permitido',
        mensaje: esAdmin
          ? `${mensajeCondicion} Como administrador puede entregarlo como excepcion manual, con motivo.`
          : `${mensajeCondicion} Si es un caso especial, avise al administrador.`,
        asistente: aResumen(asistente),
        existente: null,
        requiereBusquedaManual: false,
        puedeForzar: esAdmin,
      };
    }

    const motivo = (parametros.motivo ?? '').trim();
    if (motivo.length < 10) {
      return {
        resultado: 'no_permitido',
        mensaje:
          'Para entregar el souvenir como excepcion escriba el motivo (minimo 10 caracteres).',
        asistente: aResumen(asistente),
        existente: null,
        requiereBusquedaManual: false,
        puedeForzar: true,
      };
    }

    excepcionManual = true;
    motivoExcepcion = motivo;
  }

  const insertada = await db
    .insert(entregasSouvenir)
    .values({
      asistenteId: asistente.id,
      tipoSouvenirId: tipo.id,
      entregadoAt: ahora,
      entregadoPor: parametros.usuarioId,
      dispositivo: parametros.dispositivo ?? null,
      idempotencyKey: parametros.idempotencyKey ?? null,
      excepcionManual,
      motivoExcepcion,
    })
    .onConflictDoNothing({
      target: [entregasSouvenir.asistenteId, entregasSouvenir.tipoSouvenirId],
    })
    .returning({ id: entregasSouvenir.id });

  if (insertada.length > 0) {
    return {
      resultado: 'exito',
      mensaje: 'Souvenir entregado correctamente.',
      asistente: aResumen(asistente),
      existente: {
        id: String(insertada[0]!.id),
        tipoSouvenirId: tipo.id,
        tipoSouvenirNombre: tipo.nombre,
        entregadoAt: ahora.toISOString(),
        entregadoPor: parametros.usuarioNombre,
      },
      requiereBusquedaManual: false,
    };
  }

  const previa = await db
    .select({
      id: entregasSouvenir.id,
      tipoSouvenirId: entregasSouvenir.tipoSouvenirId,
      tipoSouvenirNombre: tiposSouvenir.nombre,
      entregadoAt: entregasSouvenir.entregadoAt,
      entregadoPor: usuariosSistema.nombre,
    })
    .from(entregasSouvenir)
    .leftJoin(usuariosSistema, eq(usuariosSistema.id, entregasSouvenir.entregadoPor))
    .innerJoin(tiposSouvenir, eq(tiposSouvenir.id, entregasSouvenir.tipoSouvenirId))
    .where(
      and(
        eq(entregasSouvenir.asistenteId, asistente.id),
        eq(entregasSouvenir.tipoSouvenirId, tipo.id),
      ),
    )
    .limit(1);

  const original = previa[0];
  return {
    resultado: 'duplicado',
    mensaje: 'El souvenir ya fue entregado a este asistente.',
    asistente: aResumen(asistente),
    existente: original
      ? {
          id: String(original.id),
          tipoSouvenirId: original.tipoSouvenirId,
          tipoSouvenirNombre: original.tipoSouvenirNombre,
          entregadoAt: original.entregadoAt.toISOString(),
          entregadoPor: original.entregadoPor ?? 'Operador no identificado',
        }
      : null,
    requiereBusquedaManual: false,
  };
}
