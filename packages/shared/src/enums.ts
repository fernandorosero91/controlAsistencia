/**
 * Enumeraciones compartidas entre la API y la interfaz web.
 * Son la unica fuente de verdad para los roles, estados y modos de registro.
 */

export const ROLES_ASISTENTE = ['estudiante', 'docente'] as const;
export type RolAsistente = (typeof ROLES_ASISTENTE)[number];

export const ROLES_SISTEMA = ['admin', 'operador'] as const;
export type RolSistema = (typeof ROLES_SISTEMA)[number];

export const ESTADOS_CERTIFICADO = ['elegible', 'no_elegible', 'emitido', 'revocado'] as const;
export type EstadoCertificado = (typeof ESTADOS_CERTIFICADO)[number];

export const MODOS_REGISTRO = ['ingreso', 'refrigerio', 'salida'] as const;
export type ModoRegistro = (typeof MODOS_REGISTRO)[number];

export const RESULTADOS_REGISTRO = [
  'exito',
  'duplicado',
  'no_encontrado',
  'no_permitido',
  'fuera_de_ventana',
] as const;
export type ResultadoRegistro = (typeof RESULTADOS_REGISTRO)[number];

export const ESTADOS_LOTE = ['en_proceso', 'completado', 'fallido'] as const;
export type EstadoLote = (typeof ESTADOS_LOTE)[number];

export const FORMATOS_EXPORTACION = ['csv', 'xlsx', 'pdf'] as const;
export type FormatoExportacion = (typeof FORMATOS_EXPORTACION)[number];

export const ETIQUETA_ROL: Record<RolAsistente, string> = {
  estudiante: 'Estudiante',
  docente: 'Docente',
};

export const ETIQUETA_ESTADO_CERTIFICADO: Record<EstadoCertificado, string> = {
  elegible: 'Elegible',
  no_elegible: 'No elegible',
  emitido: 'Emitido',
  revocado: 'Revocado',
};
