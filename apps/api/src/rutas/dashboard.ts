import type { FastifyInstance } from 'fastify';
import { obtenerResumen } from '../servicios/dashboard.js';

export async function registrarRutasDashboard(app: FastifyInstance): Promise<void> {
  app.get(
    '/dashboard/resumen',
    {
      onRequest: [app.autorizar(['admin', 'operador'])],
      schema: {
        tags: ['Dashboard'],
        description:
          'Indicadores en tiempo real del seminario. Responde 304 si el cliente ya tiene la version actual',
      },
    },
    async (request, reply) => {
      const { resumen, etag } = await obtenerResumen();
      const ifNoneMatch = request.headers['if-none-match'];
      if (typeof ifNoneMatch === 'string' && ifNoneMatch === etag) {
        return reply.status(304).send();
      }
      return reply.header('ETag', etag).header('Cache-Control', 'no-cache').send(resumen);
    },
  );
}
