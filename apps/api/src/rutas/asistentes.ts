import { and, asc, count, eq, ilike, inArray, ne, or } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  asistenteCreateSchema,
  asistenteUpdateSchema,
  busquedaManualSchema,
  filtrosAsistentesSchema,
  normalizarCedula,
  normalizarId,
  type AsistenteLectura,
} from '@seminario/shared';
import { db } from '../db/cliente.js';
import { asistentes } from '../db/esquema.js';
import { errores } from '../plugins/errores.js';
import { registrarAuditoria } from '../servicios/auditoria.js';
import { obtenerConfig } from '../servicios/configuracion.js';
import {
  crearAsistente,
  crearAsistentesLote,
  listarConCorreo,
  verificarAsistente,
  type DatosCrearAsistente,
} from '../servicios/asistentes.js';
import { correoConfigurado, enviarQrPorCorreo } from '../servicios/correo.js';
import { generarCartaQrPDF, generarCarnetsPDF } from '../servicios/pdf.js';
import {
  construirVistaPrevia,
  parsearCsv,
  parsearXlsx,
  validarFila,
  type FormatoImportacion,
  type ValidacionFila,
} from '../servicios/importacion.js';
import { validarCuerpo, validarConsulta, validarParametros } from '../lib/validacion.js';
import { limiteEscaneo } from '../config/limites.js';
import { cargarEntorno } from '../config/entorno.js';

const parametrosAsistente = z.object({ id: z.string().min(1).max(32) });

/**
 * La cedula de ciudadania identifica a una persona: no puede repetirse en el
 * padron. Se avisa con un conflicto claro en vez de dejar que el indice unico
 * de la base de datos reventes la peticion con un error 500.
 */
async function verificarCedulaDisponible(cedula: string | null, exceptoId?: string): Promise<void> {
  const normalizada = cedula ? normalizarCedula(cedula) : '';
  if (normalizada.length === 0) return;

  const condiciones = [eq(asistentes.cedulaCiudadania, normalizada)];
  if (exceptoId) condiciones.push(ne(asistentes.id, exceptoId));

  const existentes = await db
    .select({ id: asistentes.id })
    .from(asistentes)
    .where(and(...condiciones))
    .limit(1);

  if (existentes.length > 0) {
    throw errores.conflicto('Ya existe un asistente con esa cedula de ciudadania', [
      { campo: 'cedulaCiudadania', mensaje: 'La cedula ya esta registrada en el padron' },
    ]);
  }
}

/**
 * Marca las filas cuya cedula de ciudadania choca con otra: ya esta en el
 * padron (y no es el mismo asistente) o se repite dentro del archivo. La fila
 * queda con error y no se importa.
 */
async function marcarCedulasRepetidas(validaciones: ValidacionFila[]): Promise<void> {
  const cedulas = validaciones
    .map((validacion) => validacion.datos.cedulaCiudadania)
    .filter((cedula): cedula is string => Boolean(cedula));
  if (cedulas.length === 0) return;

  const conteo = new Map<string, number>();
  for (const cedula of cedulas) conteo.set(cedula, (conteo.get(cedula) ?? 0) + 1);
  const repetidas = new Set(
    [...conteo.entries()].filter(([, total]) => total > 1).map(([cedula]) => cedula),
  );

  const existentes = await db
    .select({ id: asistentes.id, cedula: asistentes.cedulaCiudadania })
    .from(asistentes)
    .where(inArray(asistentes.cedulaCiudadania, [...new Set(cedulas)]));
  const duena = new Map(existentes.map((fila) => [fila.cedula, fila.id]));

  for (const validacion of validaciones) {
    const cedula = validacion.datos.cedulaCiudadania;
    if (!cedula) continue;

    if (repetidas.has(cedula)) {
      validacion.errores.push({
        fila: validacion.fila,
        campo: 'cedula',
        mensaje: 'La cedula esta repetida en el archivo',
        valor: cedula,
      });
      validacion.valida = false;
      continue;
    }

    const dueno = duena.get(cedula);
    if (dueno && dueno !== validacion.datos.id) {
      validacion.errores.push({
        fila: validacion.fila,
        campo: 'cedula',
        mensaje: 'La cedula ya esta registrada en el padron',
        valor: cedula,
      });
      validacion.valida = false;
    }
  }
}

function aLectura(fila: typeof asistentes.$inferSelect): AsistenteLectura {
  return {
    id: fila.id,
    codigoRegistro: fila.codigoRegistro,
    cedulaCiudadania: fila.cedulaCiudadania,
    nombres: fila.nombres,
    apellidos: fila.apellidos,
    email: fila.email,
    rol: fila.rol,
    semestre: fila.semestre,
    activo: fila.activo,
    createdAt: fila.createdAt.toISOString(),
    updatedAt: fila.updatedAt.toISOString(),
  };
}

export async function registrarRutasAsistentes(app: FastifyInstance): Promise<void> {
  app.get(
    '/asistentes',
    {
      onRequest: [app.autorizar(['admin', 'operador'])],
      schema: {
        tags: ['Asistentes'],
        description: 'Lista paginada de asistentes con filtros y busqueda',
      },
    },
    async (request) => {
      const filtros = validarConsulta(filtrosAsistentesSchema, request.query);
      const condiciones = [];

      if (filtros.rol) condiciones.push(eq(asistentes.rol, filtros.rol));
      if (filtros.semestre) condiciones.push(eq(asistentes.semestre, filtros.semestre));
      if (filtros.activo !== undefined) condiciones.push(eq(asistentes.activo, filtros.activo));
      if (filtros.q) {
        const busqueda = `%${filtros.q.toLowerCase()}%`;
        condiciones.push(
          or(
            ilike(asistentes.nombres, busqueda),
            ilike(asistentes.apellidos, busqueda),
            ilike(asistentes.id, busqueda),
            ilike(asistentes.cedulaCiudadania, busqueda),
          )!,
        );
      }

      const where = condiciones.length > 0 ? and(...condiciones) : undefined;

      const [filas, conteo] = await Promise.all([
        db
          .select()
          .from(asistentes)
          .where(where)
          .orderBy(asc(asistentes.apellidos), asc(asistentes.nombres))
          .limit(filtros.porPagina)
          .offset((filtros.pagina - 1) * filtros.porPagina),
        db.select({ total: count() }).from(asistentes).where(where),
      ]);
      const total = conteo[0]?.total ?? 0;

      return {
        datos: filas.map(aLectura),
        pagina: filtros.pagina,
        porPagina: filtros.porPagina,
        total,
        totalPaginas: Math.ceil(total / filtros.porPagina),
      };
    },
  );

  app.get(
    '/asistentes/buscar',
    {
      onRequest: [app.autorizar(['admin', 'operador'])],
      schema: {
        tags: ['Asistentes'],
        description: 'Busqueda manual por nombre o apellido para el operador',
      },
    },
    async (request) => {
      const filtros = validarConsulta(busquedaManualSchema, request.query);
      const busqueda = `%${filtros.q.toLowerCase()}%`;
      const filas = await db
        .select()
        .from(asistentes)
        .where(
          and(
            eq(asistentes.activo, true),
            or(
              ilike(asistentes.nombres, busqueda),
              ilike(asistentes.apellidos, busqueda),
              ilike(asistentes.id, busqueda),
            )!,
          ),
        )
        .orderBy(asc(asistentes.apellidos))
        .limit(filtros.porPagina)
        .offset((filtros.pagina - 1) * filtros.porPagina);

      return {
        datos: filas.map(aLectura),
        pagina: filtros.pagina,
        porPagina: filtros.porPagina,
      };
    },
  );

  app.get(
    '/asistentes/carnets',
    {
      onRequest: [app.autorizar(['admin'])],
      schema: {
        tags: ['Asistentes'],
        description: 'Genera los carnets con codigo QR en un PDF descargable',
      },
    },
    async (request, reply) => {
      const consulta = request.query as { rol?: string; semestre?: string; limite?: string };
      const condiciones = [eq(asistentes.activo, true)];
      if (consulta.rol === 'estudiante' || consulta.rol === 'docente') {
        condiciones.push(eq(asistentes.rol, consulta.rol));
      }
      if (consulta.semestre) {
        const semestre = Number(consulta.semestre);
        if (Number.isInteger(semestre)) condiciones.push(eq(asistentes.semestre, semestre));
      }
      const limite = Math.min(Number(consulta.limite ?? 600) || 600, 1200);

      const filas = await db
        .select()
        .from(asistentes)
        .where(and(...condiciones))
        .orderBy(asc(asistentes.apellidos), asc(asistentes.nombres))
        .limit(limite);

      const config = await obtenerConfig();

      const pdf = await generarCarnetsPDF(
        filas.map((fila) => ({
          asistente: {
            id: fila.id,
            nombres: fila.nombres,
            apellidos: fila.apellidos,
            rol: fila.rol,
            semestre: fila.semestre,
          },
          codigoRegistro: fila.codigoRegistro ?? fila.id,
          email: fila.email,
        })),
        config.nombre,
      );

      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', 'attachment; filename="carnets-asistentes.pdf"')
        .send(Buffer.from(pdf));
    },
  );

  app.get(
    '/asistentes/plantilla',
    {
      onRequest: [app.autorizar(['admin'])],
      schema: {
        tags: ['Asistentes'],
        description: 'Plantilla de importacion en formato XLSX con las columnas esperadas',
      },
    },
    async (request, reply) => {
      const libro = new ExcelJS.Workbook();
      libro.creator = 'Sistema de control de asistencia';
      const hoja = libro.addWorksheet('Asistentes');

      hoja.addRow(['id', 'nombres', 'apellidos', 'rol', 'semestre', 'cedula', 'email']);
      hoja.addRow([
        'EST00001',
        'Ana',
        'Acosta Lopez',
        'estudiante',
        3,
        '1094867245',
        'ana@example.edu',
      ]);
      hoja.addRow(['DOC0001', 'Luis', 'Perez Diaz', 'docente', '', '80123456', 'luis@example.edu']);

      hoja.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      hoja.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D31D4' } };
      hoja.columns.forEach((columna, indice) => {
        columna.width = [16, 24, 24, 14, 12, 16, 30][indice] ?? 18;
      });
      hoja.views = [{ state: 'frozen', ySplit: 1 }];

      const ayuda = libro.addWorksheet('Instrucciones');
      ayuda.addRow(['Columna', 'Obligatoria', 'Descripcion']);
      ayuda.addRow([
        'id',
        'Si',
        'ID institucional (cedula o codigo estudiantil). Se normaliza a mayusculas.',
      ]);
      ayuda.addRow(['nombres', 'Si', 'Nombres del asistente.']);
      ayuda.addRow(['apellidos', 'Si', 'Apellidos del asistente.']);
      ayuda.addRow(['rol', 'Si', 'estudiante o docente (en minusculas).']);
      ayuda.addRow([
        'semestre',
        'Solo estudiantes',
        'Numero entre 1 y 30. Dejar vacio para docentes.',
      ]);
      ayuda.addRow([
        'cedula',
        'No',
        'Cedula de ciudadania. No puede repetirse en el padron. El operador tambien puede registrar a la persona escribiendo su cedula.',
      ]);
      ayuda.addRow([
        'email',
        'No',
        'Correo donde se envia el codigo de registro y el QR. Si se omite, se entrega la carta de QR en papel.',
      ]);
      ayuda.addRow([]);
      ayuda.addRow([
        'Nota',
        '',
        'El codigo de registro y el QR los genera el sistema: no se importan.',
      ]);
      ayuda.getRow(1).font = { bold: true };
      ayuda.columns.forEach((columna, indice) => {
        columna.width = [16, 18, 80][indice] ?? 20;
      });

      const contenido = await libro.xlsx.writeBuffer();
      return reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('Content-Disposition', 'attachment; filename="plantilla-asistentes.xlsx"')
        .send(Buffer.from(contenido));
    },
  );

  app.get(
    '/asistentes/carta-qr',
    {
      onRequest: [app.autorizar(['admin'])],
      schema: {
        tags: ['Asistentes'],
        description:
          'Carta de QR con el codigo de registro de cada asistente (para entregar a mano)',
      },
    },
    async (request, reply) => {
      const consulta = request.query as { rol?: string; limite?: string };
      const condiciones = [eq(asistentes.activo, true)];
      if (consulta.rol === 'estudiante' || consulta.rol === 'docente') {
        condiciones.push(eq(asistentes.rol, consulta.rol));
      }
      const limite = Math.min(Number(consulta.limite ?? 1200) || 1200, 3000);

      const filas = await db
        .select()
        .from(asistentes)
        .where(and(...condiciones))
        .orderBy(asc(asistentes.apellidos), asc(asistentes.nombres))
        .limit(limite);

      const config = await obtenerConfig();
      const pdf = await generarCartaQrPDF(
        filas.map((fila) => ({
          asistente: {
            id: fila.id,
            nombres: fila.nombres,
            apellidos: fila.apellidos,
            rol: fila.rol,
            semestre: fila.semestre,
          },
          codigoRegistro: fila.codigoRegistro ?? fila.id,
          idInstitucional: fila.id,
          cedulaCiudadania: fila.cedulaCiudadania,
          email: fila.email,
          nombreSeminario: config.nombre,
          facultad: config.facultad,
          fecha: config.fecha,
          lugar: config.lugar,
        })),
      );

      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', 'attachment; filename="carta-qr-asistentes.pdf"')
        .send(Buffer.from(pdf));
    },
  );

  app.post(
    '/asistentes/enviar-qr',
    {
      onRequest: [app.autorizar(['admin'])],
      schema: {
        tags: ['Asistentes'],
        description: 'Envia por correo el codigo de registro y el QR a uno o varios asistentes',
      },
    },
    async (request) => {
      const cuerpo = request.body as { asistenteId?: string; todos?: boolean };
      const config = await obtenerConfig();

      const destinatarios = cuerpo.todos
        ? await listarConCorreo()
        : cuerpo.asistenteId
          ? await (async () => {
              const filas = await db
                .select()
                .from(asistentes)
                .where(eq(asistentes.id, cuerpo.asistenteId!))
                .limit(1);
              return filas;
            })()
          : [];

      if (destinatarios.length === 0) {
        throw errores.validacion(
          'No hay asistentes seleccionados. Indique un asistente o active el envio a todos.',
        );
      }

      const sinCorreo = destinatarios.filter((fila) => !fila.email);
      if (sinCorreo.length === destinatarios.length) {
        throw errores.validacion(
          'Ninguno de los asistentes seleccionados tiene correo electronico registrado.',
        );
      }

      const resultados: { asistenteId: string; enviado: boolean; mensaje: string }[] = [];
      for (const fila of destinatarios) {
        if (!fila.email) {
          resultados.push({
            asistenteId: fila.id,
            enviado: false,
            mensaje: 'Sin correo electronico registrado',
          });
          continue;
        }
        let pdfEscarapela: Buffer | undefined;
        try {
          const pdfUint8 = await generarCartaQrPDF([
            {
              asistente: {
                id: fila.id,
                nombres: fila.nombres,
                apellidos: fila.apellidos,
                rol: fila.rol,
                semestre: fila.semestre,
              },
              codigoRegistro: fila.codigoRegistro ?? fila.id,
              idInstitucional: fila.id,
              cedulaCiudadania: fila.cedulaCiudadania ?? null,
              email: fila.email,
              nombreSeminario: config.nombre,
              facultad: config.facultad,
              fecha: config.fecha,
              lugar: config.lugar,
            },
          ]);
          pdfEscarapela = Buffer.from(pdfUint8);
        } catch (errorPdf) {
          request.log.warn(
            { error: errorPdf instanceof Error ? errorPdf.message : String(errorPdf) },
            'No se pudo generar la escarapela en PDF para adjuntar al correo',
          );
        }

        const resultado = await enviarQrPorCorreo({
          destinatario: fila.email,
          nombre: `${fila.nombres} ${fila.apellidos}`,
          codigoRegistro: fila.codigoRegistro ?? fila.id,
          idInstitucional: fila.id,
          nombreSeminario: config.nombre,
          pdfEscarapela,
        });
        resultados.push({ asistenteId: fila.id, ...resultado });
      }

      await registrarAuditoria(request, {
        accion: 'asistente.importado',
        entidad: 'asistentes',
        datosDespues: {
          operacion: 'envio_qr',
          destinatarios: resultados.length,
          enviados: resultados.filter((r) => r.enviado).length,
        },
      });

      return {
        correoConfigurado: correoConfigurado(),
        total: resultados.length,
        enviados: resultados.filter((r) => r.enviado).length,
        fallidos: resultados.filter((r) => !r.enviado).length,
        resultados,
      };
    },
  );

  app.get(
    '/asistentes/verificar',
    {
      onRequest: [app.autorizar(['admin', 'operador'])],
      // Forma parte del flujo de escaneo: se limita por usuario como las
      // registraciones, pero en su propio contador.
      config: { rateLimit: limiteEscaneo() },
      schema: {
        tags: ['Asistentes'],
        description:
          'Verifica un ID o codigo de registro y devuelve el nombre del asistente ' +
          'para compararlo con la escarapela antes de registrar',
      },
    },
    async (request) => {
      const consulta = request.query as { codigo?: string };
      const codigo = (consulta.codigo ?? '').trim();
      if (codigo.length === 0) {
        throw errores.validacion('Indique el ID o el codigo de registro a verificar');
      }
      return verificarAsistente(codigo);
    },
  );

  app.get(
    '/asistentes/:id',
    {
      onRequest: [app.autorizar(['admin', 'operador'])],
      schema: { tags: ['Asistentes'], description: 'Detalle de un asistente' },
    },
    async (request) => {
      const { id } = validarParametros(parametrosAsistente, request.params);
      const filas = await db
        .select()
        .from(asistentes)
        .where(eq(asistentes.id, normalizarId(id)))
        .limit(1);
      if (!filas[0]) throw errores.noEncontrado('El asistente no existe');
      return aLectura(filas[0]);
    },
  );

  app.post(
    '/asistentes',
    {
      onRequest: [app.autorizar(['admin'])],
      schema: { tags: ['Asistentes'], description: 'Crea un asistente' },
    },
    async (request, reply) => {
      const datos = validarCuerpo(asistenteCreateSchema, request.body);
      const id = normalizarId(datos.id);

      const existente = await db
        .select({ id: asistentes.id })
        .from(asistentes)
        .where(eq(asistentes.id, id))
        .limit(1);
      if (existente.length > 0) {
        throw errores.conflicto('Ya existe un asistente con ese ID institucional', [
          { campo: 'id', mensaje: 'ID institucional ya registrado' },
        ]);
      }

      await verificarCedulaDisponible(datos.cedulaCiudadania ?? null);

      const creado = await crearAsistente({
        id,
        nombres: datos.nombres,
        apellidos: datos.apellidos,
        rol: datos.rol,
        semestre: datos.semestre ?? null,
        cedulaCiudadania: datos.cedulaCiudadania ? datos.cedulaCiudadania : null,
        email: datos.email ? datos.email : null,
        activo: datos.activo,
      });
      await registrarAuditoria(request, {
        accion: 'asistente.creado',
        entidad: 'asistentes',
        entidadId: id,
        datosDespues: {
          id,
          codigoRegistro: creado.codigoRegistro,
          nombres: datos.nombres,
          apellidos: datos.apellidos,
          rol: datos.rol,
        },
      });

      return reply.status(201).send(aLectura(creado));
    },
  );

  app.patch(
    '/asistentes/:id',
    {
      onRequest: [app.autorizar(['admin'])],
      schema: { tags: ['Asistentes'], description: 'Actualiza los datos de un asistente' },
    },
    async (request) => {
      const { id } = validarParametros(parametrosAsistente, request.params);
      const datos = validarCuerpo(asistenteUpdateSchema, request.body);
      const idNormalizado = normalizarId(id);

      const actuales = await db
        .select()
        .from(asistentes)
        .where(eq(asistentes.id, idNormalizado))
        .limit(1);
      const actual = actuales[0];
      if (!actual) throw errores.noEncontrado('El asistente no existe');

      const rolNuevo = datos.rol ?? actual.rol;
      const semestreNuevo =
        datos.semestre !== undefined
          ? datos.semestre
          : rolNuevo === 'docente'
            ? null
            : actual.semestre;

      if (rolNuevo === 'estudiante' && semestreNuevo === null) {
        throw errores.validacion('El semestre es obligatorio para estudiantes', [
          { campo: 'semestre', mensaje: 'El semestre es obligatorio para estudiantes' },
        ]);
      }
      if (rolNuevo === 'docente' && semestreNuevo !== null) {
        throw errores.validacion('El semestre no aplica para docentes', [
          { campo: 'semestre', mensaje: 'El semestre no aplica para docentes' },
        ]);
      }

      if (datos.cedulaCiudadania !== undefined) {
        await verificarCedulaDisponible(datos.cedulaCiudadania, idNormalizado);
      }

      const actualizados = await db
        .update(asistentes)
        .set({
          ...(datos.nombres !== undefined ? { nombres: datos.nombres } : {}),
          ...(datos.apellidos !== undefined ? { apellidos: datos.apellidos } : {}),
          ...(datos.rol !== undefined ? { rol: datos.rol } : {}),
          ...(datos.semestre !== undefined ? { semestre: datos.semestre } : {}),
          ...(datos.cedulaCiudadania !== undefined
            ? { cedulaCiudadania: datos.cedulaCiudadania ? datos.cedulaCiudadania : null }
            : {}),
          ...(datos.email !== undefined ? { email: datos.email ? datos.email : null } : {}),
          ...(datos.activo !== undefined ? { activo: datos.activo } : {}),
        })
        .where(eq(asistentes.id, idNormalizado))
        .returning();

      await registrarAuditoria(request, {
        accion: 'asistente.actualizado',
        entidad: 'asistentes',
        entidadId: idNormalizado,
        datosAntes: aLectura(actual),
        datosDespues: aLectura(actualizados[0]!),
      });

      return aLectura(actualizados[0]!);
    },
  );

  app.post(
    '/asistentes/importar/previa',
    {
      onRequest: [app.autorizar(['admin'])],
      schema: {
        tags: ['Asistentes'],
        description: 'Valida un archivo CSV o XLSX y devuelve la vista previa con errores',
      },
    },
    async (request) => {
      const entorno = cargarEntorno();
      const archivo = await request.file({ limits: { fileSize: entorno.UPLOAD_MAX_BYTES } });
      if (!archivo) {
        throw errores.validacion('Debe adjuntar un archivo CSV o XLSX');
      }

      const extension = archivo.filename.toLowerCase().split('.').pop();
      const formato: FormatoImportacion = extension === 'xlsx' ? 'xlsx' : 'csv';
      const buffer = await archivo.toBuffer();
      if (buffer.length === 0) {
        throw errores.validacion('El archivo esta vacio');
      }

      const parseo =
        formato === 'xlsx' ? await parsearXlsx(buffer) : parsearCsv(buffer.toString('utf8'));
      if (parseo.errorLectura) {
        throw errores.validacion(parseo.errorLectura);
      }
      if (parseo.filas.length > 5000) {
        throw errores.validacion(
          `El archivo tiene ${parseo.filas.length} filas y el maximo por importacion es 5000. ` +
            'Divida el padron en varios archivos.',
        );
      }

      const config = await obtenerConfig();
      const validaciones = parseo.filas.map((fila) =>
        validarFila(fila.fila, fila.datos, config.idRegex),
      );

      const idsValidos = validaciones.filter((v) => v.valida).map((v) => v.datos.id!);
      const unicos = new Set(idsValidos);
      const duplicados = idsValidos.length - unicos.size;

      const existentes = idsValidos.length
        ? await db
            .select({ id: asistentes.id })
            .from(asistentes)
            .where(inArray(asistentes.id, idsValidos))
        : [];
      const existentesSet = new Set(existentes.map((fila) => fila.id));

      // La cedula no puede repetirse: se marca la fila que choca, ya sea porque
      // la cedula ya esta en el padron o porque se repite dentro del archivo.
      await marcarCedulasRepetidas(validaciones);

      const nuevos = [...unicos].filter((id) => !existentesSet.has(id)).length;
      const actualizados = [...unicos].filter((id) => existentesSet.has(id)).length;

      return construirVistaPrevia(
        validaciones,
        nuevos,
        actualizados,
        duplicados,
        validaciones.length,
      );
    },
  );

  app.post(
    '/asistentes/importar/confirmar',
    {
      onRequest: [app.autorizar(['admin'])],
      schema: {
        tags: ['Asistentes'],
        description: 'Aplica las filas validadas de una importacion',
      },
    },
    async (request) => {
      const cuerpo = request.body as {
        filas?: {
          fila: number;
          id: string;
          nombres: string;
          apellidos: string;
          rol: string;
          semestre?: number | null;
          cedulaCiudadania?: string;
          email?: string;
        }[];
        modo?: 'crear_actualizar' | 'solo_nuevos';
      };
      if (!Array.isArray(cuerpo.filas) || cuerpo.filas.length === 0) {
        throw errores.validacion('No se recibieron filas para importar');
      }
      if (cuerpo.filas.length > 5000) {
        throw errores.validacion('La importacion supera el maximo de 5000 filas por lote');
      }

      const config = await obtenerConfig();
      const validaciones = cuerpo.filas.map((fila) =>
        validarFila(
          fila.fila ?? 0,
          {
            id: fila.id,
            nombres: fila.nombres,
            apellidos: fila.apellidos,
            rol: fila.rol,
            semestre:
              fila.semestre === null || fila.semestre === undefined ? '' : String(fila.semestre),
            cedula: fila.cedulaCiudadania ?? '',
            email: fila.email ?? '',
          },
          config.idRegex,
        ),
      );

      const conError = validaciones.filter((v) => !v.valida);
      if (conError.length > 0) {
        throw errores.validacion(
          'Algunas filas no son validas',
          conError[0]!.errores.map((detalle) => ({
            campo: detalle.campo ?? '(general)',
            mensaje: detalle.mensaje,
          })),
        );
      }

      const modo = cuerpo.modo ?? 'crear_actualizar';
      const ids = validaciones.map((v) => v.datos.id!);
      const existentes = await db
        .select({ id: asistentes.id })
        .from(asistentes)
        .where(inArray(asistentes.id, ids));
      const existentesSet = new Set(existentes.map((fila) => fila.id));

      const nuevos: DatosCrearAsistente[] = [];
      let actualizados = 0;
      let omitidos = 0;

      for (const validacion of validaciones) {
        const datos = validacion.datos;
        const id = datos.id!;
        const yaExiste = existentesSet.has(id);

        if (yaExiste && modo === 'solo_nuevos') {
          omitidos += 1;
          continue;
        }

        const valores = {
          nombres: datos.nombres!,
          apellidos: datos.apellidos!,
          rol: datos.rol!,
          semestre: datos.rol === 'docente' ? null : (datos.semestre ?? null),
          cedulaCiudadania: datos.cedulaCiudadania ? datos.cedulaCiudadania : null,
          email: datos.email ? datos.email : null,
        };

        if (yaExiste) {
          await db.update(asistentes).set(valores).where(eq(asistentes.id, id));
          actualizados += 1;
        } else {
          nuevos.push({
            id,
            nombres: valores.nombres,
            apellidos: valores.apellidos,
            rol: valores.rol,
            semestre: valores.semestre,
            cedulaCiudadania: valores.cedulaCiudadania,
            email: valores.email,
            activo: true,
          });
        }
      }

      // Los asistentes nuevos se insertan en bloque: 600 filas no pueden
      // significar 600 viajes de ida y vuelta a la base de datos.
      const lote = await crearAsistentesLote(nuevos);
      const creados = lote.insertados;
      omitidos += lote.fallidos;

      await registrarAuditoria(request, {
        accion: 'asistente.importado',
        entidad: 'asistentes',
        datosDespues: { creados, actualizados, omitidos, total: validaciones.length },
      });

      return { creados, actualizados, omitidos, total: validaciones.length };
    },
  );
}
