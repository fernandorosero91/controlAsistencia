import argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { loginSchema } from '@seminario/shared';
import { db } from '../db/cliente.js';
import { refreshTokens, usuariosSistema } from '../db/esquema.js';
import { errores } from '../plugins/errores.js';
import {
  emitirRefreshToken,
  fijarCookieRefresh,
  hashToken,
  limpiarCookieRefresh,
  nombreCookieRefresh,
} from '../plugins/autenticacion.js';
import { registrarAuditoria } from '../servicios/auditoria.js';
import { validarCuerpo } from '../lib/validacion.js';
import { logger } from '../config/log.js';

const esquemaError = {
  type: 'object',
  properties: {
    codigo: { type: 'string' },
    mensaje: { type: 'string' },
  },
  required: ['codigo', 'mensaje'],
};

export async function registrarRutasAuth(app: FastifyInstance): Promise<void> {
  app.post(
    '/auth/login',
    {
      config: {
        rateLimit: { max: 10, timeWindow: '1 minute' },
      },
      schema: {
        description: 'Inicio de sesion de administradores y operadores',
        tags: ['Auth'],
        response: {
          200: {
            type: 'object',
            properties: {
              usuario: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  nombre: { type: 'string' },
                  email: { type: 'string' },
                  rol: { type: 'string' },
                  activo: { type: 'boolean' },
                },
              },
              tokenAcceso: { type: 'string' },
              expiraEn: { type: 'number' },
            },
          },
          401: esquemaError,
        },
      },
    },
    async (request, reply) => {
      const datos = validarCuerpo(loginSchema, request.body);
      const usuarios = await db
        .select()
        .from(usuariosSistema)
        .where(eq(usuariosSistema.email, datos.email))
        .limit(1);
      const usuario = usuarios[0];

      const passwordCorrecta = usuario
        ? await argon2.verify(usuario.passwordHash, datos.password).catch(() => false)
        : false;

      if (!usuario || !passwordCorrecta || !usuario.activo) {
        logger.warn(
          { email: datos.email, ip: request.ip },
          'Intento de inicio de sesion fallido',
        );
        throw errores.noAutenticado('Correo electronico o contrasena incorrectos');
      }

      const tokenAcceso = app.jwt.sign(
        { sub: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol },
        { expiresIn: '15m' },
      );

      const refreshToken = await emitirRefreshToken(usuario.id, {
        userAgent: request.headers['user-agent'],
        ip: request.ip,
      });
      fijarCookieRefresh(reply, refreshToken);

      await db
        .update(usuariosSistema)
        .set({ ultimoAccesoAt: new Date() })
        .where(eq(usuariosSistema.id, usuario.id));

      request.usuario = {
        id: usuario.id,
        nombre: usuario.nombre,
        email: usuario.email,
        rol: usuario.rol,
      };
      await registrarAuditoria(request, {
        accion: 'auth.login',
        entidad: 'usuarios_sistema',
        entidadId: usuario.id,
        datosDespues: { email: usuario.email, rol: usuario.rol },
      });

      return reply.send({
        usuario: {
          id: usuario.id,
          nombre: usuario.nombre,
          email: usuario.email,
          rol: usuario.rol,
          activo: usuario.activo,
        },
        tokenAcceso,
        expiraEn: 900,
      });
    },
  );

  app.post(
    '/auth/refresh',
    {
      schema: {
        description: 'Renueva el token de acceso usando el refresh token en cookie',
        tags: ['Auth'],
      },
    },
    async (request, reply) => {
      const cookie = request.cookies[nombreCookieRefresh()];
      if (!cookie) {
        throw errores.noAutenticado('No hay sesion activa');
      }

      const registros = await db
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, hashToken(cookie)))
        .limit(1);
      const registro = registros[0];

      if (!registro || registro.revocado || registro.expiraAt.getTime() < Date.now()) {
        limpiarCookieRefresh(reply);
        throw errores.noAutenticado('La sesion expiro, inicie sesion nuevamente');
      }

      const usuarios = await db
        .select()
        .from(usuariosSistema)
        .where(eq(usuariosSistema.id, registro.usuarioId))
        .limit(1);
      const usuario = usuarios[0];

      if (!usuario || !usuario.activo) {
        await db
          .update(refreshTokens)
          .set({ revocado: true })
          .where(eq(refreshTokens.id, registro.id));
        limpiarCookieRefresh(reply);
        throw errores.noAutenticado('La sesion ya no es valida');
      }

      // Rotacion: el refresh token usado se revoca y se emite uno nuevo.
      await db.update(refreshTokens).set({ revocado: true }).where(eq(refreshTokens.id, registro.id));
      const nuevoRefresh = await emitirRefreshToken(usuario.id, {
        userAgent: request.headers['user-agent'],
        ip: request.ip,
      });
      fijarCookieRefresh(reply, nuevoRefresh);

      const tokenAcceso = app.jwt.sign(
        { sub: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol },
        { expiresIn: '15m' },
      );

      return reply.send({
        usuario: {
          id: usuario.id,
          nombre: usuario.nombre,
          email: usuario.email,
          rol: usuario.rol,
          activo: usuario.activo,
        },
        tokenAcceso,
        expiraEn: 900,
      });
    },
  );

  app.post('/auth/logout', async (request, reply) => {
    const cookie = request.cookies[nombreCookieRefresh()];
    if (cookie) {
      await db
        .update(refreshTokens)
        .set({ revocado: true })
        .where(eq(refreshTokens.tokenHash, hashToken(cookie)));
    }
    limpiarCookieRefresh(reply);
    return reply.status(204).send();
  });

  app.get('/auth/sesion', { onRequest: [app.autenticar] }, async (request) => {
    return { usuario: request.usuario };
  });
}
