import type { FastifyReply, FastifyRequest } from 'fastify';
import type { RolSistema } from '@seminario/shared';

/** Usuario autenticado disponible en la peticion. */
export interface UsuarioAutenticado {
  id: string;
  nombre: string;
  email: string;
  rol: RolSistema;
}

/**
 * Hook de autorizacion. Carry los roles exigidos para que el hook `onRoute`
 * pueda aplicarle el limite de tasa de administracion sin tener que repetirlo
 * en cada ruta.
 */
export type HookAutorizacion = ((request: FastifyRequest, reply: FastifyReply) => Promise<void>) & {
  roles?: RolSistema[];
};

declare module 'fastify' {
  interface FastifyRequest {
    usuario?: UsuarioAutenticado;
  }

  interface FastifyInstance {
    /** Verifica el token de acceso y carga request.usuario. */
    autenticar: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Exige una sesion valida y, opcionalmente, un rol especifico. */
    autorizar: (roles: RolSistema[]) => HookAutorizacion;
  }
}

export {};
