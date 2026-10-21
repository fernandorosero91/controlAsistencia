import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { codigoVerificacionSchema } from '@seminario/shared';
import { verificarCodigoPublico } from '../servicios/certificados.js';
import { validarParametros } from '../lib/validacion.js';

const parametrosCodigo = z.object({
  codigo: z.string().trim().min(4).max(20),
});

/**
 * Superficie publica del sistema. Solo permite verificar la autenticidad de un
 * certificado. No expone datos de asistentes ni de operaciones internas.
 */
export async function registrarRutasPublico(app: FastifyInstance): Promise<void> {
  app.get(
    '/publico/verificar/:codigo',
    {
      config: {
        rateLimit: { max: 20, timeWindow: '1 minute' },
      },
      schema: {
        tags: ['Publico'],
        description: 'Verifica la autenticidad de un certificado mediante su codigo',
      },
    },
    async (request, reply) => {
      const { codigo } = validarParametros(parametrosCodigo, request.params);
      const codigoNormalizado = codigo.toUpperCase();
      const esFormatoValido = codigoVerificacionSchema.safeParse(codigoNormalizado).success;

      if (!esFormatoValido) {
        return reply.status(200).send({
          valido: false,
          nombre: null,
          rol: null,
          seminario: null,
          fechaEmision: null,
          intensidadHoraria: null,
          estado: null,
        });
      }

      const resultado = await verificarCodigoPublico(codigoNormalizado);
      return reply.send(resultado);
    },
  );
}
