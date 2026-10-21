import { createHash, randomBytes } from 'node:crypto';
import fastifyCookie from '@fastify/cookie';
import fastifyJwt from '@fastify/jwt';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { RolSistema } from '@seminario/shared';
import { cargarEntorno, usarCookieSegura } from '../config/entorno.js';
import { db } from '../db/cliente.js';
import { refreshTokens, usuariosSistema } from '../db/esquema.js';
import { errores } from './errores.js';
import type { UsuarioAutenticado } from '../tipos.js';

const REFRESH_COOKIE = 'seminario_refresh';

const payloadJwt = z.object({
  sub: z.string().uuid(),
  nombre: z.string(),
  email: z.string(),
  rol: z.enum(['admin', 'operador']),
});

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generarRefreshToken(): string {
  return randomBytes(48).toString('hex');
}

export function nombreCookieRefresh(): string {
  return REFRESH_COOKIE;
}

export async function emitirRefreshToken(
  usuarioId: string,
  meta: { userAgent?: string; ip?: string },
): Promise<string> {
  const entorno = cargarEntorno();
  const token = generarRefreshToken();
  const expiraEn = new Date(Date.now() + entorno.JWT_REFRESH_TTL_SEGUNDOS * 1000);
  await db.insert(refreshTokens).values({
    usuarioId,
    tokenHash: hashToken(token),
    expiraAt: expiraEn,
    userAgent: meta.userAgent ?? null,
    ip: meta.ip ?? null,
  });
  return token;
}

export function fijarCookieRefresh(reply: FastifyReply, token: string): void {
  const entorno = cargarEntorno();
  reply.setCookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: usarCookieSegura(entorno),
    path: '/',
    maxAge: entorno.JWT_REFRESH_TTL_SEGUNDOS,
    ...(entorno.COOKIE_DOMAIN ? { domain: entorno.COOKIE_DOMAIN } : {}),
  });
}

export function limpiarCookieRefresh(reply: FastifyReply): void {
  const entorno = cargarEntorno();
  reply.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: usarCookieSegura(entorno),
    path: '/',
    ...(entorno.COOKIE_DOMAIN ? { domain: entorno.COOKIE_DOMAIN } : {}),
  });
}

export async function registrarPluginAutenticacion(app: FastifyInstance): Promise<void> {
  const entorno = cargarEntorno();

  await app.register(fastifyCookie);
  await app.register(fastifyJwt, {
    secret: entorno.JWT_SECRET,
    sign: { expiresIn: entorno.JWT_ACCESS_TTL_SEGUNDOS },
  });

  app.decorate('autenticar', async (request: FastifyRequest, _reply: FastifyReply) => {
    try {
      const payload = payloadJwt.parse(await request.jwtVerify());
      const usuario = await db
        .select({
          id: usuariosSistema.id,
          nombre: usuariosSistema.nombre,
          email: usuariosSistema.email,
          rol: usuariosSistema.rol,
          activo: usuariosSistema.activo,
        })
        .from(usuariosSistema)
        .where(eq(usuariosSistema.id, payload.sub))
        .limit(1);

      const encontrado = usuario[0];
      if (!encontrado || !encontrado.activo) {
        throw errores.noAutenticado('La sesion ya no es valida');
      }

      request.usuario = {
        id: encontrado.id,
        nombre: encontrado.nombre,
        email: encontrado.email,
        rol: encontrado.rol,
      } satisfies UsuarioAutenticado;
    } catch (error) {
      if (error instanceof Error && error.name === 'ErrorApi') throw error;
      throw errores.noAutenticado();
    }
  });

  app.decorate('autorizar', (roles: RolSistema[]) => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      await app.autenticar(request, reply);
      const usuario = request.usuario;
      if (!usuario) {
        throw errores.noAutenticado();
      }
      if (roles.length > 0 && !roles.includes(usuario.rol)) {
        throw errores.noAutorizado(
          'Esta operacion esta reservada al administrador del seminario',
        );
      }
    };
  });
}
