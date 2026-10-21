import ExcelJS from 'exceljs';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import {
  evaluarElegibilidad,
  sanitizarCeldaExportacion,
  type FiltrosReporte,
} from '@seminario/shared';
import { db } from '../db/cliente.js';
import {
  asistencias,
  asistentes,
  auditoria,
  certificados,
  entregasRefrigerio,
  jornadas,
  tiposRefrigerio,
  usuariosSistema,
} from '../db/esquema.js';
import { obtenerConfig } from './configuracion.js';

export type TipoReporte =
  | 'asistencia'
  | 'asistencia-parcial'
  | 'refrigerios-entregados'
  | 'refrigerios-pendientes'
  | 'elegibles'
  | 'no-elegibles'
  | 'certificados-emitidos'
  | 'auditoria';

export interface ResultadoReporte {
  titulo: string;
  columnas: string[];
  filas: string[][];
}

function fecha(valor: Date | null): string {
  if (!valor) return '';
  return valor.toLocaleString('es-CO', { timeZone: 'America/Bogota' });
}

export async function generarReporte(
  tipo: TipoReporte,
  filtros: FiltrosReporte,
): Promise<ResultadoReporte> {
  switch (tipo) {
    case 'asistencia':
      return reporteAsistencia(filtros);
    case 'asistencia-parcial':
      return reporteAsistenciaParcial(filtros);
    case 'refrigerios-entregados':
      return reporteRefrigerios(filtros, true);
    case 'refrigerios-pendientes':
      return reporteRefrigerios(filtros, false);
    case 'elegibles':
      return reporteElegibilidad(filtros, true);
    case 'no-elegibles':
      return reporteElegibilidad(filtros, false);
    case 'certificados-emitidos':
      return reporteCertificados(filtros);
    case 'auditoria':
      return reporteAuditoria(filtros);
    default:
      throw new Error(`Tipo de reporte no soportado: ${tipo}`);
  }
}

async function reporteAsistencia(filtros: FiltrosReporte): Promise<ResultadoReporte> {
  const condiciones = [];
  if (filtros.jornadaId) condiciones.push(eq(asistencias.jornadaId, filtros.jornadaId));
  if (filtros.rol) condiciones.push(eq(asistentes.rol, filtros.rol));
  if (filtros.desde) condiciones.push(sql`${asistencias.horaIngreso} >= ${filtros.desde}`);
  if (filtros.hasta) condiciones.push(sql`${asistencias.horaIngreso} <= ${filtros.hasta}`);

  const filas = await db
    .select({
      id: asistentes.id,
      nombres: asistentes.nombres,
      apellidos: asistentes.apellidos,
      rol: asistentes.rol,
      semestre: asistentes.semestre,
      jornada: jornadas.nombre,
      horaIngreso: asistencias.horaIngreso,
      horaSalida: asistencias.horaSalida,
      registradoPor: usuariosSistema.nombre,
    })
    .from(asistencias)
    .innerJoin(asistentes, eq(asistentes.id, asistencias.asistenteId))
    .innerJoin(jornadas, eq(jornadas.id, asistencias.jornadaId))
    .leftJoin(usuariosSistema, eq(usuariosSistema.id, asistencias.registradoPor))
    .where(condiciones.length > 0 ? and(...condiciones) : undefined)
    .orderBy(asc(jornadas.orden), asc(asistentes.apellidos));

  return {
    titulo: 'Asistencia por jornada',
    columnas: [
      'ID institucional',
      'Nombres',
      'Apellidos',
      'Rol',
      'Semestre',
      'Jornada',
      'Hora de ingreso',
      'Hora de salida',
      'Registrado por',
    ],
    filas: filas.map((fila) => [
      fila.id,
      fila.nombres,
      fila.apellidos,
      fila.rol,
      fila.semestre === null ? '' : String(fila.semestre),
      fila.jornada,
      fecha(fila.horaIngreso),
      fecha(fila.horaSalida),
      fila.registradoPor ?? '',
    ]),
  };
}

async function reporteAsistenciaParcial(_filtros: FiltrosReporte): Promise<ResultadoReporte> {
  const [listaJornadas, listaAsistencias] = await Promise.all([
    db.select().from(jornadas).orderBy(asc(jornadas.orden)),
    db
      .select({
        asistenteId: asistencias.asistenteId,
        jornadaId: asistencias.jornadaId,
        horaIngreso: asistencias.horaIngreso,
        horaSalida: asistencias.horaSalida,
      })
      .from(asistencias),
  ]);

  const mapa = new Map<string, typeof listaAsistencias>();
  for (const asistencia of listaAsistencias) {
    const lista = mapa.get(asistencia.asistenteId) ?? [];
    lista.push(asistencia);
    mapa.set(asistencia.asistenteId, lista);
  }

  const idsParciales = [...mapa.entries()]
    .filter(([, lista]) => lista.length < listaJornadas.length)
    .map(([id]) => id);

  if (idsParciales.length === 0) {
    return {
      titulo: 'Asistencia parcial',
      columnas: [
        'ID institucional',
        'Nombres',
        'Apellidos',
        'Jornadas registradas',
        'Total jornadas',
      ],
      filas: [],
    };
  }

  const filas = await db
    .select()
    .from(asistentes)
    .where(sql`${asistentes.id} = ANY(${idsParciales})`)
    .orderBy(asc(asistentes.apellidos));

  return {
    titulo: 'Asistencia parcial',
    columnas: [
      'ID institucional',
      'Nombres',
      'Apellidos',
      'Rol',
      'Jornadas registradas',
      'Total jornadas',
    ],
    filas: filas.map((fila) => [
      fila.id,
      fila.nombres,
      fila.apellidos,
      fila.rol,
      String(mapa.get(fila.id)?.length ?? 0),
      String(listaJornadas.length),
    ]),
  };
}

async function reporteRefrigerios(
  filtros: FiltrosReporte,
  entregados: boolean,
): Promise<ResultadoReporte> {
  const condiciones = [];
  if (entregados) {
    if (filtros.jornadaId) condiciones.push(eq(tiposRefrigerio.jornadaId, filtros.jornadaId));
  } else {
    if (filtros.jornadaId) condiciones.push(eq(tiposRefrigerio.jornadaId, filtros.jornadaId));
  }
  if (filtros.rol) condiciones.push(eq(asistentes.rol, filtros.rol));

  const entregas = await db
    .select({
      id: asistentes.id,
      nombres: asistentes.nombres,
      apellidos: asistentes.apellidos,
      rol: asistentes.rol,
      refrigerio: tiposRefrigerio.nombre,
      jornada: jornadas.nombre,
      entregadoAt: entregasRefrigerio.entregadoAt,
      entregadoPor: usuariosSistema.nombre,
    })
    .from(entregasRefrigerio)
    .innerJoin(asistentes, eq(asistentes.id, entregasRefrigerio.asistenteId))
    .innerJoin(tiposRefrigerio, eq(tiposRefrigerio.id, entregasRefrigerio.tipoRefrigerioId))
    .innerJoin(jornadas, eq(jornadas.id, tiposRefrigerio.jornadaId))
    .leftJoin(usuariosSistema, eq(usuariosSistema.id, entregasRefrigerio.entregadoPor))
    .where(condiciones.length > 0 ? and(...condiciones) : undefined)
    .orderBy(asc(asistentes.apellidos));

  const configuracion = await obtenerConfig();

  if (entregados) {
    return {
      titulo: 'Refrigerios entregados',
      columnas: [
        'ID institucional',
        'Nombres',
        'Apellidos',
        'Rol',
        'Refrigerio',
        'Jornada',
        'Fecha y hora',
        'Entregado por',
      ],
      filas: entregas.map((fila) => [
        fila.id,
        fila.nombres,
        fila.apellidos,
        fila.rol,
        fila.refrigerio,
        fila.jornada,
        fecha(fila.entregadoAt),
        fila.entregadoPor ?? '',
      ]),
    };
  }

  // Pendientes: asistentes con asistencia en la jornada que aun no recibieron el refrigerio.
  const listaTipos = await db.select().from(tiposRefrigerio).orderBy(asc(tiposRefrigerio.orden));
  const tipoFiltro = filtros.jornadaId
    ? listaTipos.filter((tipo) => tipo.jornadaId === filtros.jornadaId)
    : listaTipos;

  const filas: string[][] = [];
  for (const tipo of tipoFiltro) {
    const asistentesJornada = await db
      .select({
        id: asistentes.id,
        nombres: asistentes.nombres,
        apellidos: asistentes.apellidos,
        rol: asistentes.rol,
      })
      .from(asistencias)
      .innerJoin(asistentes, eq(asistentes.id, asistencias.asistenteId))
      .where(
        and(
          eq(asistencias.jornadaId, tipo.jornadaId),
          filtros.rol ? eq(asistentes.rol, filtros.rol) : undefined,
        ),
      );

    const yaEntregados = new Set(
      entregas.filter((entrega) => entrega.refrigerio === tipo.nombre).map((entrega) => entrega.id),
    );

    for (const asistente of asistentesJornada) {
      if (!yaEntregados.has(asistente.id)) {
        filas.push([
          asistente.id,
          asistente.nombres,
          asistente.apellidos,
          asistente.rol,
          tipo.nombre,
          tipo.jornadaId.toString(),
          configuracion.nombre,
        ]);
      }
    }
  }

  return {
    titulo: 'Refrigerios pendientes',
    columnas: [
      'ID institucional',
      'Nombres',
      'Apellidos',
      'Rol',
      'Refrigerio',
      'Jornada (id)',
      'Seminario',
    ],
    filas,
  };
}

async function reporteElegibilidad(
  filtros: FiltrosReporte,
  soloElegibles: boolean,
): Promise<ResultadoReporte> {
  const config = await obtenerConfig();
  const [listaJornadas, listaAsistencias, listaCertificados] = await Promise.all([
    db.select().from(jornadas).orderBy(asc(jornadas.orden)),
    db
      .select({
        asistenteId: asistencias.asistenteId,
        jornadaId: asistencias.jornadaId,
        horaIngreso: asistencias.horaIngreso,
        horaSalida: asistencias.horaSalida,
      })
      .from(asistencias),
    db.select().from(certificados),
  ]);

  const mapa = new Map<string, typeof listaAsistencias>();
  for (const asistencia of listaAsistencias) {
    const lista = mapa.get(asistencia.asistenteId) ?? [];
    lista.push(asistencia);
    mapa.set(asistencia.asistenteId, lista);
  }
  const mapaCertificados = new Map(listaCertificados.map((c) => [c.asistenteId, c]));

  const condiciones = [eq(asistentes.activo, true)];
  if (filtros.rol) condiciones.push(eq(asistentes.rol, filtros.rol));
  if (filtros.q) {
    condiciones.push(
      sql`(${asistentes.nombres} || ' ' || ${asistentes.apellidos}) ILIKE ${`%${filtros.q}%`}`,
    );
  }

  const filas = await db
    .select()
    .from(asistentes)
    .where(and(...condiciones))
    .orderBy(asc(asistentes.apellidos));

  const resultado: string[][] = [];
  for (const fila of filas) {
    const assists = mapa.get(fila.id) ?? [];
    const evaluacion = evaluarElegibilidad({
      exigirAmbasJornadas: config.exigirAmbasJornadas,
      horaFinSeminario: new Date(config.horaFinSeminario),
      toleranciaMinutos: config.toleranciaMinutos,
      jornadas: listaJornadas.map((jornada) => ({ id: jornada.id, fin: jornada.fin })),
      asistencias: assists.map((asistencia) => ({
        jornadaId: asistencia.jornadaId,
        horaIngreso: asistencia.horaIngreso,
        horaSalida: asistencia.horaSalida,
      })),
    });

    if (evaluacion.elegible !== soloElegibles) continue;

    const certificado = mapaCertificados.get(fila.id);
    resultado.push([
      fila.id,
      fila.nombres,
      fila.apellidos,
      fila.rol,
      fila.semestre === null ? '' : String(fila.semestre),
      evaluacion.elegible ? 'Elegible' : 'No elegible',
      evaluacion.motivos.join(', '),
      certificado?.codigoVerificacion ?? '',
      certificado ? fecha(certificado.emitidoAt) : '',
    ]);
  }

  return {
    titulo: soloElegibles ? 'Asistentes elegibles' : 'Asistentes no elegibles',
    columnas: [
      'ID institucional',
      'Nombres',
      'Apellidos',
      'Rol',
      'Semestre',
      'Estado',
      'Motivos',
      'Codigo de verificacion',
      'Fecha de emision',
    ],
    filas: resultado,
  };
}

async function reporteCertificados(filtros: FiltrosReporte): Promise<ResultadoReporte> {
  const condiciones = [eq(certificados.revocado, false)];
  if (filtros.rol) condiciones.push(eq(asistentes.rol, filtros.rol));
  if (filtros.jornadaId) {
    condiciones.push(
      sql`${certificados.asistenteId} IN (SELECT asistente_id FROM asistencias WHERE jornada_id = ${filtros.jornadaId})`,
    );
  }

  const filas = await db
    .select({
      id: asistentes.id,
      nombres: asistentes.nombres,
      apellidos: asistentes.apellidos,
      rol: asistentes.rol,
      semestre: asistentes.semestre,
      codigoVerificacion: certificados.codigoVerificacion,
      emitidoAt: certificados.emitidoAt,
      emitidoPor: usuariosSistema.nombre,
      excepcionManual: certificados.excepcionManual,
      motivoExcepcion: certificados.motivoExcepcion,
    })
    .from(certificados)
    .innerJoin(asistentes, eq(asistentes.id, certificados.asistenteId))
    .leftJoin(usuariosSistema, eq(usuariosSistema.id, certificados.emitidoPor))
    .where(and(...condiciones))
    .orderBy(asc(asistentes.apellidos));

  return {
    titulo: 'Certificados emitidos',
    columnas: [
      'ID institucional',
      'Nombres',
      'Apellidos',
      'Rol',
      'Semestre',
      'Codigo de verificacion',
      'Fecha de emision',
      'Emitido por',
      'Excepcion manual',
      'Motivo de excepcion',
    ],
    filas: filas.map((fila) => [
      fila.id,
      fila.nombres,
      fila.apellidos,
      fila.rol,
      fila.semestre === null ? '' : String(fila.semestre),
      fila.codigoVerificacion,
      fecha(fila.emitidoAt),
      fila.emitidoPor ?? '',
      fila.excepcionManual ? 'Si' : 'No',
      fila.motivoExcepcion ?? '',
    ]),
  };
}

async function reporteAuditoria(filtros: FiltrosReporte): Promise<ResultadoReporte> {
  const condiciones = [];
  if (filtros.desde) condiciones.push(sql`${auditoria.createdAt} >= ${filtros.desde}`);
  if (filtros.hasta) condiciones.push(sql`${auditoria.createdAt} <= ${filtros.hasta}`);

  const filas = await db
    .select({
      id: auditoria.id,
      usuario: auditoria.usuarioNombre,
      accion: auditoria.accion,
      entidad: auditoria.entidad,
      entidadId: auditoria.entidadId,
      ip: auditoria.ip,
      createdAt: auditoria.createdAt,
    })
    .from(auditoria)
    .where(condiciones.length > 0 ? and(...condiciones) : undefined)
    .orderBy(desc(auditoria.createdAt))
    .limit(5000);

  return {
    titulo: 'Auditoria de acciones sensibles',
    columnas: ['Id', 'Usuario', 'Accion', 'Entidad', 'Entidad (id)', 'IP', 'Fecha'],
    filas: filas.map((fila) => [
      String(fila.id),
      fila.usuario ?? '',
      fila.accion,
      fila.entidad,
      fila.entidadId ?? '',
      fila.ip ?? '',
      fecha(fila.createdAt),
    ]),
  };
}

function escaparCsv(valor: string): string {
  const saneado = sanitizarCeldaExportacion(valor);
  if (saneado.includes('"') || saneado.includes(';') || saneado.includes('\n')) {
    return `"${saneado.replace(/"/g, '""')}"`;
  }
  return saneado;
}

export function reporteComoCsv(reporte: ResultadoReporte): Buffer {
  const lineas = [reporte.columnas.map(escaparCsv).join(';')];
  for (const fila of reporte.filas) {
    lineas.push(fila.map(escaparCsv).join(';'));
  }
  // El BOM permite que Excel reconozca UTF-8 al abrir el archivo.
  return Buffer.from(`\uFEFF${lineas.join('\r\n')}`, 'utf8');
}

export async function reporteComoXlsx(reporte: ResultadoReporte): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Sistema de control de asistencia';
  libro.created = new Date();
  const hoja = libro.addWorksheet(reporte.titulo.slice(0, 30));

  hoja.addRow(reporte.columnas);
  hoja.getRow(1).font = { bold: true };
  hoja.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF12505E' },
  };
  hoja.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

  for (const fila of reporte.filas) {
    hoja.addRow(fila.map((valor) => sanitizarCeldaExportacion(valor)));
  }

  hoja.columns.forEach((columna, indice) => {
    const encabezado = reporte.columnas[indice] ?? '';
    columna.width = Math.min(Math.max(encabezado.length + 4, 14), 40);
  });
  hoja.views = [{ state: 'frozen', ySplit: 1 }];

  const buffer = await libro.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function reporteComoPdf(reporte: ResultadoReporte): Promise<Buffer> {
  const documento = await PDFDocument.create();
  const fuente = await documento.embedFont(StandardFonts.Helvetica);
  const fuenteNegrita = await documento.embedFont(StandardFonts.HelveticaBold);

  const anchoPagina = 595.28;
  const altoPagina = 841.89;
  const margen = 32;
  const anchoUtil = anchoPagina - margen * 2;
  const altoFila = 16;
  const filasPorPagina = Math.floor((altoPagina - margen * 2 - 60) / altoFila);
  const anchoColumna = anchoUtil / Math.max(reporte.columnas.length, 1);

  const totalPaginas = Math.max(1, Math.ceil((reporte.filas.length + 1) / filasPorPagina));

  for (let numeroPagina = 0; numeroPagina < totalPaginas; numeroPagina += 1) {
    const pagina = documento.addPage([anchoPagina, altoPagina]);
    let cursorY = altoPagina - margen - 18;

    if (numeroPagina === 0) {
      pagina.drawText(reporte.titulo, {
        x: margen,
        y: cursorY,
        size: 15,
        font: fuenteNegrita,
        color: rgb(0.043, 0.169, 0.2),
      });
      cursorY -= 16;
      pagina.drawText(
        `Generado el ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })} - ${
          reporte.filas.length
        } registros`,
        { x: margen, y: cursorY, size: 9, font: fuente, color: rgb(0.42, 0.46, 0.49) },
      );
      cursorY -= 24;
    }

    const inicio = numeroPagina * filasPorPagina;
    const fin = Math.min(inicio + filasPorPagina, reporte.filas.length);

    reporte.columnas.forEach((columna, indice) => {
      pagina.drawText(columna.slice(0, 26), {
        x: margen + indice * anchoColumna,
        y: cursorY,
        size: 8,
        font: fuenteNegrita,
        color: rgb(0.071, 0.314, 0.369),
        maxWidth: anchoColumna - 4,
      });
    });
    cursorY -= 4;
    pagina.drawLine({
      start: { x: margen, y: cursorY },
      end: { x: anchoPagina - margen, y: cursorY },
      thickness: 0.75,
      color: rgb(0.776, 0.804, 0.824),
    });
    cursorY -= 14;

    for (let indice = inicio; indice < fin; indice += 1) {
      const fila = reporte.filas[indice]!;
      fila.forEach((valor, indiceColumna) => {
        pagina.drawText(sanitizarCeldaExportacion(valor).slice(0, 30), {
          x: margen + indiceColumna * anchoColumna,
          y: cursorY,
          size: 8,
          font: fuente,
          color: rgb(0.086, 0.098, 0.11),
          maxWidth: anchoColumna - 4,
        });
      });
      cursorY -= altoFila;
    }

    pagina.drawText(`Pagina ${numeroPagina + 1} de ${totalPaginas}`, {
      x: margen,
      y: 18,
      size: 8,
      font: fuente,
      color: rgb(0.42, 0.46, 0.49),
    });
  }

  const pdf = await documento.save();
  return Buffer.from(pdf);
}
