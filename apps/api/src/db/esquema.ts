import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  inet,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Esquema Drizzle. Es la fuente de verdad para los tipos en el codigo de aplicacion.
 * El SQL equivalente, versionado y reversible, esta en drizzle/*.sql.
 */

export const rolAsistenteEnum = pgEnum('rol_asistente', ['estudiante', 'docente']);
export const rolSistemaEnum = pgEnum('rol_sistema', ['admin', 'operador']);
export const estadoLoteEnum = pgEnum('estado_lote', ['en_proceso', 'completado', 'fallido']);

const creadoEn = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const actualizadoEn = timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const usuariosSistema = pgTable(
  'usuarios_sistema',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    nombre: text('nombre').notNull(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    rol: rolSistemaEnum('rol').notNull(),
    activo: boolean('activo').notNull().default(true),
    ultimoAccesoAt: timestamp('ultimo_acceso_at', { withTimezone: true }),
    creadoPor: uuid('creado_por'),
    createdAt: creadoEn,
    updatedAt: actualizadoEn,
  },
  (tabla) => [
    uniqueIndex('usuarios_sistema_email_idx').on(sql`lower(${tabla.email})`),
    index('usuarios_sistema_rol_idx').on(tabla.rol),
  ],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    usuarioId: uuid('usuario_id')
      .notNull()
      .references(() => usuariosSistema.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiraAt: timestamp('expira_at', { withTimezone: true }).notNull(),
    revocado: boolean('revocado').notNull().default(false),
    userAgent: text('user_agent'),
    ip: inet('ip'),
    createdAt: creadoEn,
  },
  (tabla) => [index('refresh_tokens_usuario_idx').on(tabla.usuarioId, tabla.revocado)],
);

export const seminarioConfig = pgTable(
  'seminario_config',
  {
    id: smallint('id').primaryKey().default(1),
    nombre: text('nombre').notNull(),
    fecha: date('fecha').notNull(),
    horaFinSeminario: timestamp('hora_fin_seminario', { withTimezone: true }).notNull(),
    toleranciaMinutos: integer('tolerancia_minutos').notNull().default(0),
    exigirAmbasJornadas: boolean('exigir_ambas_jornadas').notNull().default(true),
    intensidadHoraria: integer('intensidad_horaria').notNull().default(8),
    permitirRegistroFueraDeVentana: boolean('permitir_registro_fuera_de_ventana')
      .notNull()
      .default(false),
    textoEncabezado: text('texto_encabezado'),
    textoCierre: text('texto_cierre'),
    lugar: text('lugar'),
    facultad: text('facultad'),
    contacto: text('contacto'),
    firmaNombre: text('firma_nombre'),
    firmaCargo: text('firma_cargo'),
    firmas: jsonb('firmas').notNull().default([]),
    idRegex: text('id_regex').notNull().default('^[A-Z0-9]{4,20}$'),
    urlPublica: text('url_publica'),
    creadoPor: uuid('creado_por'),
    createdAt: creadoEn,
    updatedAt: actualizadoEn,
  },
  (tabla) => [check('seminario_config_id_unico', sql`${tabla.id} = 1`)],
);

export const jornadas = pgTable(
  'jornadas',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    nombre: text('nombre').notNull(),
    inicio: timestamp('inicio', { withTimezone: true }).notNull(),
    fin: timestamp('fin', { withTimezone: true }).notNull(),
    ventanaCheckinInicio: timestamp('ventana_checkin_inicio', { withTimezone: true }).notNull(),
    ventanaCheckinFin: timestamp('ventana_checkin_fin', { withTimezone: true }).notNull(),
    orden: integer('orden').notNull().default(0),
    createdAt: creadoEn,
    updatedAt: actualizadoEn,
  },
  (tabla) => [
    check('jornadas_fin_posterior', sql`${tabla.fin} > ${tabla.inicio}`),
    check(
      'jornadas_ventana_valida',
      sql`${tabla.ventanaCheckinFin} > ${tabla.ventanaCheckinInicio}`,
    ),
  ],
);

export const asistentes = pgTable(
  'asistentes',
  {
    id: text('id').primaryKey(),
    codigoRegistro: text('codigo_registro'),
    email: text('email'),
    nombres: text('nombres').notNull(),
    apellidos: text('apellidos').notNull(),
    semestre: integer('semestre'),
    rol: rolAsistenteEnum('rol').notNull(),
    activo: boolean('activo').notNull().default(true),
    createdAt: creadoEn,
    updatedAt: actualizadoEn,
  },
  (tabla) => [
    index('asistentes_apellidos_idx').on(sql`lower(${tabla.apellidos})`),
    index('asistentes_nombres_idx').on(sql`lower(${tabla.nombres})`),
    index('asistentes_rol_idx').on(tabla.rol),
    index('asistentes_semestre_idx').on(tabla.semestre),
    uniqueIndex('asistentes_codigo_registro_idx')
      .on(tabla.codigoRegistro)
      .where(sql`${tabla.codigoRegistro} IS NOT NULL`),
    index('asistentes_email_idx')
      .on(sql`lower(${tabla.email})`)
      .where(sql`${tabla.email} IS NOT NULL`),
    check(
      'asistentes_semestre_rol',
      sql`(${tabla.rol} = 'estudiante') = (${tabla.semestre} IS NOT NULL)`,
    ),
    check(
      'asistentes_semestre_rango',
      sql`${tabla.semestre} IS NULL OR ${tabla.semestre} BETWEEN 1 AND 30`,
    ),
  ],
);

export const asistencias = pgTable(
  'asistencias',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    asistenteId: text('asistente_id')
      .notNull()
      .references(() => asistentes.id, { onDelete: 'restrict' }),
    jornadaId: integer('jornada_id')
      .notNull()
      .references(() => jornadas.id, { onDelete: 'restrict' }),
    horaIngreso: timestamp('hora_ingreso', { withTimezone: true }).notNull().defaultNow(),
    horaSalida: timestamp('hora_salida', { withTimezone: true }),
    registradoPor: uuid('registrado_por').references(() => usuariosSistema.id, {
      onDelete: 'set null',
    }),
    registradoSalidaPor: uuid('registrado_salida_por').references(() => usuariosSistema.id, {
      onDelete: 'set null',
    }),
    dispositivo: text('dispositivo'),
    idempotencyKey: text('idempotency_key'),
    excepcionManual: boolean('excepcion_manual').notNull().default(false),
    motivoExcepcion: text('motivo_excepcion'),
    createdAt: creadoEn,
    updatedAt: actualizadoEn,
  },
  (tabla) => [
    uniqueIndex('asistencias_unico_asistente_jornada').on(tabla.asistenteId, tabla.jornadaId),
    index('asistencias_jornada_hora_idx').on(tabla.jornadaId, tabla.horaIngreso),
    index('asistencias_hora_ingreso_idx').on(tabla.horaIngreso),
    index('asistencias_idempotency_idx').on(tabla.idempotencyKey),
  ],
);

export const tiposRefrigerio = pgTable(
  'tipos_refrigerio',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    nombre: text('nombre').notNull(),
    jornadaId: integer('jornada_id')
      .notNull()
      .references(() => jornadas.id, { onDelete: 'restrict' }),
    activo: boolean('activo').notNull().default(true),
    orden: integer('orden').notNull().default(0),
    createdAt: creadoEn,
    updatedAt: actualizadoEn,
  },
  (tabla) => [
    uniqueIndex('tipos_refrigerio_nombre_jornada_idx').on(
      sql`lower(${tabla.nombre})`,
      tabla.jornadaId,
    ),
  ],
);

export const entregasRefrigerio = pgTable(
  'entregas_refrigerio',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    asistenteId: text('asistente_id')
      .notNull()
      .references(() => asistentes.id, { onDelete: 'restrict' }),
    tipoRefrigerioId: integer('tipo_refrigerio_id')
      .notNull()
      .references(() => tiposRefrigerio.id, { onDelete: 'restrict' }),
    entregadoAt: timestamp('entregado_at', { withTimezone: true }).notNull().defaultNow(),
    entregadoPor: uuid('entregado_por').references(() => usuariosSistema.id, {
      onDelete: 'set null',
    }),
    dispositivo: text('dispositivo'),
    idempotencyKey: text('idempotency_key'),
    createdAt: creadoEn,
  },
  (tabla) => [
    uniqueIndex('entregas_unico_asistente_tipo').on(tabla.asistenteId, tabla.tipoRefrigerioId),
    index('entregas_tipo_idx').on(tabla.tipoRefrigerioId, tabla.entregadoAt),
    index('entregas_hora_idx').on(tabla.entregadoAt),
  ],
);

export const certificadosLotes = pgTable(
  'certificados_lotes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    solicitadoPor: uuid('solicitado_por').references(() => usuariosSistema.id, {
      onDelete: 'set null',
    }),
    estado: estadoLoteEnum('estado').notNull().default('en_proceso'),
    total: integer('total').notNull().default(0),
    procesados: integer('procesados').notNull().default(0),
    exitosos: integer('exitosos').notNull().default(0),
    fallidos: integer('fallidos').notNull().default(0),
    errores: jsonb('errores').notNull().default([]),
    motivo: text('motivo'),
    iniciadoAt: timestamp('iniciado_at', { withTimezone: true }).notNull().defaultNow(),
    finalizadoAt: timestamp('finalizado_at', { withTimezone: true }),
  },
  (tabla) => [index('certificados_lotes_estado_idx').on(tabla.estado, tabla.iniciadoAt)],
);

export const certificados = pgTable(
  'certificados',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    asistenteId: text('asistente_id')
      .notNull()
      .unique()
      .references(() => asistentes.id, { onDelete: 'restrict' }),
    codigoVerificacion: text('codigo_verificacion').notNull().unique(),
    emitidoAt: timestamp('emitido_at', { withTimezone: true }).notNull().defaultNow(),
    emitidoPor: uuid('emitido_por').references(() => usuariosSistema.id, { onDelete: 'set null' }),
    hashPdf: text('hash_pdf').notNull(),
    revocado: boolean('revocado').notNull().default(false),
    motivoRevocacion: text('motivo_revocacion'),
    excepcionManual: boolean('excepcion_manual').notNull().default(false),
    motivoExcepcion: text('motivo_excepcion'),
    loteId: uuid('lote_id').references(() => certificadosLotes.id, { onDelete: 'set null' }),
    createdAt: creadoEn,
    updatedAt: actualizadoEn,
  },
  (tabla) => [index('certificados_lote_idx').on(tabla.loteId)],
);

export const auditoria = pgTable(
  'auditoria',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    usuarioId: uuid('usuario_id').references(() => usuariosSistema.id, { onDelete: 'set null' }),
    usuarioNombre: text('usuario_nombre'),
    accion: text('accion').notNull(),
    entidad: text('entidad').notNull(),
    entidadId: text('entidad_id'),
    datosAntes: jsonb('datos_antes'),
    datosDespues: jsonb('datos_despues'),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    createdAt: creadoEn,
  },
  (tabla) => [
    index('auditoria_created_at_idx').on(tabla.createdAt),
    index('auditoria_entidad_idx').on(tabla.entidad, tabla.entidadId),
    index('auditoria_usuario_idx').on(tabla.usuarioId),
  ],
);

export const idempotencia = pgTable(
  'idempotencia',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    usuarioId: uuid('usuario_id').references(() => usuariosSistema.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    clave: text('clave').notNull(),
    codigoHttp: integer('codigo_http').notNull(),
    cuerpo: jsonb('cuerpo').notNull(),
    createdAt: creadoEn,
  },
  (tabla) => [uniqueIndex('idempotencia_unica').on(tabla.usuarioId, tabla.endpoint, tabla.clave)],
);

export type Asistente = typeof asistentes.$inferSelect;
export type NuevaAsistencia = typeof asistencias.$inferInsert;
export type NuevaEntregaRefrigerio = typeof entregasRefrigerio.$inferInsert;
export type UsuarioSistema = typeof usuariosSistema.$inferSelect;
export type Jornada = typeof jornadas.$inferSelect;
export type SeminarioConfig = typeof seminarioConfig.$inferSelect;
export type TipoRefrigerio = typeof tiposRefrigerio.$inferSelect;
export type Certificado = typeof certificados.$inferSelect;
export type LoteCertificados = typeof certificadosLotes.$inferSelect;
