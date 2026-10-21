import type { RolSistema } from '@seminario/shared';

/** Usuario autenticado disponible en la peticion. */
export interface UsuarioAutenticado {
  id: string;
  nombre: string;
  email: string;
  rol: RolSistema;
}

declare module 'fastify' {
  interface FastifyRequest {
    usuario?: UsuarioAutenticado;
  }

  interface FastifyInstance {
    /** Verifica el token de acceso y carga request.usuario. */
    autenticar: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Exige una sesion valida y, opcionalmente, un rol especifico. */
    autorizar: (
      roles: RolSistema[],
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export {};
