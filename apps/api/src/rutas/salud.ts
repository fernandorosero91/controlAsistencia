import type { FastifyInstance } from 'fastify';
import { comprobarConexion } from '../db/cliente.js';

export async function registrarRutasSalud(app: FastifyInstance): Promise<void> {
  app.get('/health/live', { schema: { tags: ['Salud'] } }, async () => {
    return { estado: 'ok', servicio: 'seminario-asistencia-api' };
  });

  app.get('/health/ready', { schema: { tags: ['Salud'] } }, async (_request, reply) => {
    const baseDatos = await comprobarConexion();
    if (!baseDatos) {
      return reply.status(503).send({ estado: 'degradado', baseDatos: false });
    }
    return { estado: 'ok', baseDatos: true };
  });
}
