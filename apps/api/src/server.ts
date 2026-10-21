import { construirAplicacion } from './app.js';
import { cargarEntorno } from './config/entorno.js';
import { logger } from './config/log.js';

async function principal(): Promise<void> {
  const entorno = cargarEntorno();
  const app = await construirAplicacion();

  const cerrar = async (senal: string): Promise<void> => {
    logger.info({ senal }, 'Apagando la API de forma ordenada');
    try {
      await app.close();
      process.exit(0);
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Error durante el apagado de la API',
      );
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void cerrar('SIGTERM'));
  process.on('SIGINT', () => void cerrar('SIGINT'));
  process.on('unhandledRejection', (motivo) => {
    logger.error(
      { motivo: motivo instanceof Error ? motivo.message : String(motivo) },
      'Promesa rechazada sin manejar',
    );
  });
  process.on('uncaughtException', (error) => {
    logger.error({ error: error.message, stack: error.stack }, 'Excepcion no controlada');
  });

  await app.listen({ host: entorno.HOST, port: entorno.PORT });
  logger.info({ puerto: entorno.PORT, entorno: entorno.NODE_ENV }, 'API de asistencia iniciada');
}

principal().catch((error: unknown) => {
  logger.error(
    { error: error instanceof Error ? error.message : String(error) },
    'No se pudo iniciar la API',
  );
  process.exit(1);
});
