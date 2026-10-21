import { Redis } from 'ioredis';
import { cargarEntorno } from '../config/entorno.js';
import { logger } from '../config/log.js';

/**
 * Cache con dos implementaciones: Redis cuando esta disponible y un almacen en
 * memoria con TTL como respaldo. El respaldo en memoria es por proceso, por lo que
 * con varias instancias de la API el cache no se comparte: esto solo afecta el
 * rendimiento del dashboard, nunca la integridad de los datos.
 */

export interface Cache {
  readonly disponible: boolean;
  obtener<T>(clave: string): Promise<T | null>;
  guardar(clave: string, valor: unknown, ttlMs?: number): Promise<void>;
  invalidar(clave: string): Promise<void>;
  invalidarPrefijo(prefijo: string): Promise<void>;
  cerrar(): Promise<void>;
}

class CacheMemoria implements Cache {
  readonly disponible = false;
  private readonly valores = new Map<string, { valor: unknown; expiraEn: number }>();

  async obtener<T>(clave: string): Promise<T | null> {
    const entrada = this.valores.get(clave);
    if (!entrada) return null;
    if (entrada.expiraEn < Date.now()) {
      this.valores.delete(clave);
      return null;
    }
    return entrada.valor as T;
  }

  async guardar(clave: string, valor: unknown, ttlMs: number): Promise<void> {
    this.valores.set(clave, { valor, expiraEn: Date.now() + ttlMs });
  }

  async invalidar(clave: string): Promise<void> {
    this.valores.delete(clave);
  }

  async invalidarPrefijo(prefijo: string): Promise<void> {
    for (const clave of [...this.valores.keys()]) {
      if (clave.startsWith(prefijo)) this.valores.delete(clave);
    }
  }

  async cerrar(): Promise<void> {
    this.valores.clear();
  }
}

class CacheRedis implements Cache {
  readonly disponible = true;

  constructor(private readonly cliente: Redis) {}

  async obtener<T>(clave: string): Promise<T | null> {
    const bruto = await this.cliente.get(clave);
    if (bruto === null) return null;
    try {
      return JSON.parse(bruto) as T;
    } catch {
      return null;
    }
  }

  async guardar(clave: string, valor: unknown, ttlMs: number): Promise<void> {
    await this.cliente.set(clave, JSON.stringify(valor), 'PX', ttlMs);
  }

  async invalidar(clave: string): Promise<void> {
    await this.cliente.del(clave);
  }

  async invalidarPrefijo(prefijo: string): Promise<void> {
    let cursor = '0';
    do {
      const [siguiente, claves] = await this.cliente.scan(
        cursor,
        'MATCH',
        `${prefijo}*`,
        'COUNT',
        200,
      );
      cursor = siguiente;
      if (claves.length > 0) await this.cliente.del(...claves);
    } while (cursor !== '0');
  }

  async cerrar(): Promise<void> {
    await this.cliente.quit();
  }
}

export let cache: Cache = new CacheMemoria();
export let redis: Redis | null = null;

export async function conectarCache(): Promise<Cache> {
  const entorno = cargarEntorno();
  if (!entorno.REDIS_URL) {
    logger.warn('REDIS_URL no configurada: se usara cache en memoria por proceso');
    return cache;
  }

  const cliente = new Redis(entorno.REDIS_URL, {
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    lazyConnect: true,
    retryStrategy: (intentos) => Math.min(intentos * 500, 5000),
  });

  cliente.on('error', (error: Error) => {
    logger.warn({ error: error.message }, 'Redis no disponible, se usara cache en memoria');
  });

  try {
    await cliente.connect();
    await cliente.ping();
    logger.info('Cache Redis conectada');
    cache = new CacheRedis(cliente);
    redis = cliente;
    return cache;
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'No se pudo conectar a Redis: se usara cache en memoria',
    );
    cliente.disconnect();
    return cache;
  }
}
