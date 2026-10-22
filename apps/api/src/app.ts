import compress from '@fastify/compress';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { cargarEntorno, origenesPermitidos } from './config/entorno.js';
import { logger } from './config/log.js';
import { cerrarPool } from './db/cliente.js';
import { registrarManejadorErrores } from './plugins/errores.js';
import { registrarPluginAutenticacion } from './plugins/autenticacion.js';
import { limiteAdministracion } from './config/limites.js';
import { conectarCache, redis } from './servicios/cache.js';
import { registrarRutasAuth } from './rutas/auth.js';
import { registrarRutasSalud } from './rutas/salud.js';
import { registrarRutasAsistentes } from './rutas/asistentes.js';
import { registrarRutasRegistros } from './rutas/registros.js';
import { registrarRutasConfiguracion } from './rutas/configuracion.js';
import { registrarRutasDashboard } from './rutas/dashboard.js';
import { registrarRutasReportes } from './rutas/reportes.js';
import { registrarRutasCertificados } from './rutas/certificados.js';
import { registrarRutasUsuarios } from './rutas/usuarios.js';
import { registrarRutasMantenimiento } from './rutas/mantenimiento.js';
import { registrarRutasPublico } from './rutas/publico.js';
import type { HookAutorizacion } from './tipos.js';
import './tipos.js';

export async function construirAplicacion(): Promise<FastifyInstance> {
  const entorno = cargarEntorno();

  const app = Fastify({
    // La instancia de pino se adapta al tipo de Fastify para conservar el tipado estandar.
    loggerInstance: logger as unknown as FastifyBaseLogger,
    trustProxy: true,
    bodyLimit: entorno.BODY_LIMIT_BYTES,
    ajv: { customOptions: { removeAdditional: 'all', coerceTypes: true } },
  });

  await registrarManejadorErrores(app);
  await conectarCache();

  // El plugin de autenticacion se registra antes que el de limites de tasa:
  // el hook onRoute de mas abajo necesita distinguir las rutas que exigen rol
  // de administrador para aplicarle su propio limite.
  await registrarPluginAutenticacion(app);

  // Las rutas que exigen una sesion valida reciben el limite de tasa del
  // panel de forma automatica. De lo contrario habria que repetirlo en cada
  // una de las veinticinco rutas. Las rutas de escaneo traen su propio limite
  // (mas bajo, por operador) y no se tocan.
  app.addHook('onRoute', (routeOptions) => {
    const ganchos = routeOptions.onRequest;
    if (!Array.isArray(ganchos)) return;
    if (routeOptions.config?.rateLimit) return;

    const exigeSesion = ganchos.some((gancho) => Array.isArray((gancho as HookAutorizacion).roles));
    if (!exigeSesion) return;

    routeOptions.config = { ...routeOptions.config, rateLimit: limiteAdministracion() };
  });

  // Fastify responde 415 cuando un POST no trae Content-Type. Varias rutas de la
  // API (renovacion de sesion, cierre de sesion) se llaman sin cuerpo, asi que se
  // acepta cualquier tipo de contenido y un cuerpo vacio se interpreta como {}.
  app.addContentTypeParser('*', { parseAs: 'string' }, (_request, cuerpo, done) => {
    const texto = typeof cuerpo === 'string' ? cuerpo.trim() : '';
    if (texto.length === 0) {
      done(null, undefined);
      return;
    }
    try {
      done(null, JSON.parse(texto));
    } catch {
      done(new Error('El cuerpo de la peticion no es JSON valido'), undefined);
    }
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
  });

  await app.register(cors, {
    origin: origenesPermitidos(),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Dispositivo'],
    exposedHeaders: ['ETag', 'Retry-After', 'X-Request-Id'],
    maxAge: 600,
  });

  await app.register(compress, {
    global: true,
    encodings: ['br', 'gzip', 'deflate'],
    threshold: 1024,
  });

  await app.register(multipart, {
    limits: {
      fileSize: entorno.UPLOAD_MAX_BYTES,
      files: 1,
      fields: 10,
    },
  });

  await app.register(rateLimit, {
    global: false,
    ...(redis ? { redis } : {}),
    keyGenerator: (request) => request.usuario?.id ?? request.ip,
    errorResponseBuilder: (_request, context) => ({
      statusCode: 429,
      codigo: 'LIMITE_TASA',
      mensaje: 'Se alcanzo el limite de solicitudes. Intenten de nuevo en un momento.',
      reintentarEnSegundos: Math.ceil(context.ttl / 1000),
    }),
  });

  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'API del sistema de control de asistencia',
        description:
          'Registro de asistencia por ID institucional, entrega de refrigerios, ' +
          'emision administrativa de certificados y verificacion publica.',
        version: '1.0.0',
      },
      servers: [{ url: entorno.BASE_URL_PUBLICA }],
      tags: [
        { name: 'Auth', description: 'Inicio de sesion y renovacion de token' },
        { name: 'Asistentes', description: 'Gestion del padron de asistentes' },
        { name: 'Registros', description: 'Ingreso, salida y entrega de refrigerios' },
        { name: 'Configuracion', description: 'Parametros del seminario y jornadas' },
        { name: 'Dashboard', description: 'Indicadores en tiempo real' },
        { name: 'Reportes', description: 'Reportes y exportaciones' },
        { name: 'Certificados', description: 'Emision y descarga de certificados (solo admin)' },
        { name: 'Publico', description: 'Superficie publica de verificacion' },
      ],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', deepLinking: true },
  });

  await registrarRutasSalud(app);
  await registrarRutasAuth(app);
  await registrarRutasAsistentes(app);
  await registrarRutasRegistros(app);
  await registrarRutasConfiguracion(app);
  await registrarRutasDashboard(app);
  await registrarRutasReportes(app);
  await registrarRutasCertificados(app);
  await registrarRutasUsuarios(app);
  await registrarRutasMantenimiento(app);
  await registrarRutasPublico(app);

  app.addHook('onClose', async () => {
    await cerrarPool();
  });

  return app;
}
