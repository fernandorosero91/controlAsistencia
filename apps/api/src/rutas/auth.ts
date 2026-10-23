import argon2 from 'argon2';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
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
import { limiteLogin } from '../config/limites.js';
import { validarCuerpo } from '../lib/validacion.js';
import { cargarEntorno } from '../config/entorno.js';
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
        rateLimit: {
          ...limiteLogin(),
          // En el sede del evento todos los operadores comparten la misma IP:
          // el limite se aplica por cuenta, no solo por direccion de red.
          keyGenerator: (request: FastifyRequest) => {
            const cuerpo = request.body as { email?: string } | undefined;
            return `${request.ip}:${(cuerpo?.email ?? '').toLowerCase()}`;
          },
        },
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
        logger.warn({ email: datos.email, ip: request.ip }, 'Intento de inicio de sesion fallido');
        throw errores.noAutenticado('Correo electronico o contrasena incorrectos');
      }

      const entorno = cargarEntorno();
      const tokenAcceso = app.jwt.sign(
        { sub: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol },
        { expiresIn: entorno.JWT_ACCESS_TTL_SEGUNDOS },
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
        expiraEn: entorno.JWT_ACCESS_TTL_SEGUNDOS,
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
        request.log.warn({ motivo: 'sin_cookie' }, 'Renovacion rechazada: no llego la cookie');
        throw errores.noAutenticado('No hay sesion activa');
      }

      // Rotacion atomica: el refresh token es de un solo uso. La actualizacion
      // condicional (revocado = false) hace que dos peticiones simultaneas con
      // la misma cookie (por ejemplo, dos pestanas del panel) no renueven la
      // sesion dos veces ni invaliden la cookie de la otra.
      const consumidos = await db
        .update(refreshTokens)
        .set({ revocado: true })
        .where(
          and(eq(refreshTokens.tokenHash, hashToken(cookie)), eq(refreshTokens.revocado, false)),
        )
        .returning({
          id: refreshTokens.id,
          usuarioId: refreshTokens.usuarioId,
          expiraAt: refreshTokens.expiraAt,
        });

      const registro = consumidos[0];
      if (!registro) {
        // El token no existe o ya se uso en otra renovacion. No se borra la
        // cookie: otra pestana puede haberla actualizado ya con la rotacion.
        request.log.warn(
          { motivo: 'token_desconocido' },
          'Renovacion rechazada: el refresh token no existe o ya se uso',
        );
        throw errores.noAutenticado('La sesion expiro, inicie sesion nuevamente');
      }

      if (registro.expiraAt.getTime() < Date.now()) {
        request.log.warn(
          { motivo: 'token_expirado', expiraAt: registro.expiraAt.toISOString() },
          'Renovacion rechazada: el refresh token vencio',
        );
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
        request.log.warn(
          { motivo: 'usuario_inactivo', usuarioId: registro.usuarioId },
          'Renovacion rechazada: el usuario no existe o esta inactivo',
        );
        limpiarCookieRefresh(reply);
        throw errores.noAutenticado('La sesion ya no es valida');
      }

      const nuevoRefresh = await emitirRefreshToken(usuario.id, {
        userAgent: request.headers['user-agent'],
        ip: request.ip,
      });
      fijarCookieRefresh(reply, nuevoRefresh);

      const entorno = cargarEntorno();
      const tokenAcceso = app.jwt.sign(
        { sub: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol },
        { expiresIn: entorno.JWT_ACCESS_TTL_SEGUNDOS },
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
        expiraEn: entorno.JWT_ACCESS_TTL_SEGUNDOS,
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
