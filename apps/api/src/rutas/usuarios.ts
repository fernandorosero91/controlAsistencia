import { and, eq, ne, sql } from 'drizzle-orm';
import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actualizarUsuarioSchema, crearUsuarioSchema, paginacionSchema } from '@seminario/shared';
import { db } from '../db/cliente.js';
import { refreshTokens, usuariosSistema } from '../db/esquema.js';
import { errores } from '../plugins/errores.js';
import { registrarAuditoria } from '../servicios/auditoria.js';
import { validarCuerpo, validarConsulta, validarParametros } from '../lib/validacion.js';

const parametrosUsuario = z.object({ id: z.string().uuid('El identificador no es valido') });

/**
 * Cuenta los administradores activos distintos del indicado.
 *
 * El sistema no puede quedarse sin ningun administrador activo: nadie podria
 * volver a entrar al panel ni recuperar la cuenta. Por eso cada operacion que
 * desactiva, degrada o elimina una cuenta comprueba este numero antes de
 * escribir.
 */
async function contarOtrosAdminsActivos(exceptoId: string): Promise<number> {
  const filas = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(usuariosSistema)
    .where(
      and(
        eq(usuariosSistema.rol, 'admin'),
        eq(usuariosSistema.activo, true),
        ne(usuariosSistema.id, exceptoId),
      ),
    );
  return filas[0]?.total ?? 0;
}

export async function registrarRutasUsuarios(app: FastifyInstance): Promise<void> {
  app.get(
    '/usuarios',
    {
      onRequest: [app.autorizar(['admin'])],
      schema: { tags: ['Usuarios'], description: 'Lista de administradores y operadores' },
    },
    async (request) => {
      const paginacion = validarConsulta(paginacionSchema, request.query);
      const condicion = sql`1 = 1`;
      const usuarios = await db
        .select({
          id: usuariosSistema.id,
          nombre: usuariosSistema.nombre,
          email: usuariosSistema.email,
          rol: usuariosSistema.rol,
          activo: usuariosSistema.activo,
          ultimoAccesoAt: usuariosSistema.ultimoAccesoAt,
          createdAt: usuariosSistema.createdAt,
        })
        .from(usuariosSistema)
        .where(condicion)
        .limit(paginacion.porPagina)
        .offset((paginacion.pagina - 1) * paginacion.porPagina);

      const conteo = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(usuariosSistema)
        .where(condicion);
      const total = conteo[0]?.total ?? 0;

      return {
        datos: usuarios.map((usuario) => ({
          ...usuario,
          ultimoAccesoAt: usuario.ultimoAccesoAt?.toISOString() ?? null,
          createdAt: usuario.createdAt.toISOString(),
        })),
        pagina: paginacion.pagina,
        porPagina: paginacion.porPagina,
        total,
        totalPaginas: Math.ceil(total / paginacion.porPagina),
      };
    },
  );

  app.post(
    '/usuarios',
    {
      onRequest: [app.autorizar(['admin'])],
      schema: { tags: ['Usuarios'], description: 'Crea un administrador u operador' },
    },
    async (request, reply) => {
      const datos = validarCuerpo(crearUsuarioSchema, request.body);
      const existe = await db
        .select({ id: usuariosSistema.id })
        .from(usuariosSistema)
        .where(eq(sql`lower(${usuariosSistema.email})`, datos.email))
        .limit(1);
      if (existe.length > 0) {
        throw errores.conflicto('Ya existe un usuario con ese correo electronico', [
          { campo: 'email', mensaje: 'Correo electronico ya registrado' },
        ]);
      }

      const passwordHash = await argon2.hash(datos.password, { type: argon2.argon2id });
      const insertados = await db
        .insert(usuariosSistema)
        .values({
          nombre: datos.nombre,
          email: datos.email,
          passwordHash,
          rol: datos.rol,
          creadoPor: request.usuario?.id ?? null,
        })
        .returning({
          id: usuariosSistema.id,
          nombre: usuariosSistema.nombre,
          email: usuariosSistema.email,
          rol: usuariosSistema.rol,
          activo: usuariosSistema.activo,
        });

      await registrarAuditoria(request, {
        accion: 'usuario.creado',
        entidad: 'usuarios_sistema',
        entidadId: insertados[0]!.id,
        datosDespues: { email: datos.email, rol: datos.rol },
      });

      return reply.status(201).send(insertados[0]);
    },
  );

  app.patch(
    '/usuarios/:id',
    {
      onRequest: [app.autorizar(['admin'])],
      schema: { tags: ['Usuarios'], description: 'Actualiza un usuario del sistema' },
    },
    async (request) => {
      const { id } = validarParametros(parametrosUsuario, request.params);
      const datos = validarCuerpo(actualizarUsuarioSchema, request.body);

      const actuales = await db
        .select()
        .from(usuariosSistema)
        .where(eq(usuariosSistema.id, id))
        .limit(1);
      const actual = actuales[0];
      if (!actual) throw errores.noEncontrado('El usuario no existe');

      const esUnoMismo = id === request.usuario?.id;
      if (esUnoMismo && datos.activo === false) {
        throw errores.conflicto('No puede desactivar su propia cuenta.');
      }

      // Desactivar o quitar el rol de administrador a la ultima cuenta activa
      // dejaria el sistema sin quien lo administre.
      const quedaInactivo = datos.activo === false;
      const dejaDeSerAdmin = datos.rol !== undefined && datos.rol !== 'admin';
      if (actual.rol === 'admin' && actual.activo && (quedaInactivo || dejaDeSerAdmin)) {
        if ((await contarOtrosAdminsActivos(id)) === 0) {
          throw errores.conflicto(
            'Debe quedar al menos un administrador activo. Cree o active otra cuenta de administrador antes de hacer este cambio.',
          );
        }
      }

      if (datos.email && datos.email !== actual.email) {
        const existe = await db
          .select({ id: usuariosSistema.id })
          .from(usuariosSistema)
          .where(eq(sql`lower(${usuariosSistema.email})`, datos.email))
          .limit(1);
        if (existe.length > 0) {
          throw errores.conflicto('Ya existe un usuario con ese correo electronico');
        }
      }

      const passwordHash = datos.password
        ? await argon2.hash(datos.password, { type: argon2.argon2id })
        : undefined;

      const actualizados = await db
        .update(usuariosSistema)
        .set({
          ...(datos.nombre !== undefined ? { nombre: datos.nombre } : {}),
          ...(datos.email !== undefined ? { email: datos.email } : {}),
          ...(datos.rol !== undefined ? { rol: datos.rol } : {}),
          ...(datos.activo !== undefined ? { activo: datos.activo } : {}),
          ...(passwordHash ? { passwordHash } : {}),
        })
        .where(eq(usuariosSistema.id, id))
        .returning({
          id: usuariosSistema.id,
          nombre: usuariosSistema.nombre,
          email: usuariosSistema.email,
          rol: usuariosSistema.rol,
          activo: usuariosSistema.activo,
        });

      if (datos.activo === false) {
        await db
          .update(refreshTokens)
          .set({ revocado: true })
          .where(and(eq(refreshTokens.usuarioId, id), eq(refreshTokens.revocado, false)));
      }

      await registrarAuditoria(request, {
        accion: 'usuario.actualizado',
        entidad: 'usuarios_sistema',
        entidadId: id,
        datosAntes: {
          nombre: actual.nombre,
          email: actual.email,
          rol: actual.rol,
          activo: actual.activo,
        },
        datosDespues: {
          nombre: datos.nombre ?? actual.nombre,
          email: datos.email ?? actual.email,
          rol: datos.rol ?? actual.rol,
          activo: datos.activo ?? actual.activo,
        },
      });

      return actualizados[0];
    },
  );

  app.delete(
    '/usuarios/:id',
    {
      onRequest: [app.autorizar(['admin'])],
      schema: { tags: ['Usuarios'], description: 'Elimina un administrador u operador' },
    },
    async (request, reply) => {
      const { id } = validarParametros(parametrosUsuario, request.params);

      const filas = await db
        .select()
        .from(usuariosSistema)
        .where(eq(usuariosSistema.id, id))
        .limit(1);
      const actual = filas[0];
      if (!actual) throw errores.noEncontrado('El usuario no existe');

      if (id === request.usuario?.id) {
        throw errores.conflicto('No puede eliminar su propia cuenta.');
      }

      if (
        actual.rol === 'admin' &&
        actual.activo &&
        (await contarOtrosAdminsActivos(id)) === 0
      ) {
        throw errores.conflicto(
          'Debe quedar al menos un administrador activo. Cree o active otra cuenta de administrador antes de eliminar esta.',
        );
      }

      // El historial no se pierde: las asistencias y entregas guardan el
      // usuario como SET NULL y el nombre queda en la auditoria. Los refresh
      // tokens de la cuenta se eliminan en cascada.
      await db.delete(usuariosSistema).where(eq(usuariosSistema.id, id));

      await registrarAuditoria(request, {
        accion: 'usuario.eliminado',
        entidad: 'usuarios_sistema',
        entidadId: id,
        datosAntes: {
          nombre: actual.nombre,
          email: actual.email,
          rol: actual.rol,
          activo: actual.activo,
        },
      });

      return reply.status(204).send();
    },
  );
}
