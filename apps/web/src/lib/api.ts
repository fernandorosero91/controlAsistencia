import type { CodigoError, UsuarioSistema } from '@seminario/shared';
import { tokenActual, useSesion } from '../estado/sesion';

const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '/api';

export class ErrorPeticion extends Error {
  readonly estado: number;
  readonly codigo: CodigoError;
  readonly detalles: { campo: string; mensaje: string }[];

  constructor(
    estado: number,
    codigo: CodigoError,
    mensaje: string,
    detalles: { campo: string; mensaje: string }[] = [],
  ) {
    super(mensaje);
    this.name = 'ErrorPeticion';
    this.estado = estado;
    this.codigo = codigo;
    this.detalles = detalles;
  }
}

export class ErrorRed extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorRed';
  }
}

export interface OpcionesPeticion {
  metodo?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  cuerpo?: unknown;
  cabecera?: Record<string, string>;
  claveIdempotencia?: string;
  senal?: AbortSignal;
  reintentar?: boolean;
}

const ESPERA_REINTENTO_MS = [300, 800, 1600];

function esperar(ms: number): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

function nuevoClaveIdempotencia(): string {
  const aleatorio =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return aleatorio;
}

let refrescoEnCurso: Promise<boolean> | null = null;

/** Renueva el token de acceso usando el refresh token en cookie httpOnly. */
export async function renovarToken(): Promise<boolean> {
  if (refrescoEnCurso) return refrescoEnCurso;

  refrescoEnCurso = (async () => {
    try {
      const respuesta = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!respuesta.ok) return false;
      const datos = (await respuesta.json()) as {
        tokenAcceso: string;
        expiraEn: number;
        usuario: UsuarioSistema | null;
      };
      useSesion.getState().establecerToken(datos.tokenAcceso, datos.expiraEn);
      if (datos.usuario) {
        useSesion.getState().establecerSesion(
          datos.usuario,
          datos.tokenAcceso,
          datos.expiraEn,
        );
      }
      return true;
    } catch {
      return false;
    } finally {
      refrescoEnCurso = null;
    }
  })();

  return refrescoEnCurso;
}

async function ejecutar<T>(ruta: string, opciones: OpcionesPeticion): Promise<T> {
  const metodo = opciones.metodo ?? 'GET';
  const esFormulario = typeof FormData !== 'undefined' && opciones.cuerpo instanceof FormData;
  const cabeceras: Record<string, string> = {
    Accept: 'application/json',
    ...(opciones.cuerpo !== undefined && !esFormulario
      ? { 'Content-Type': 'application/json' }
      : {}),
    ...(opciones.cabecera ?? {}),
  };

  const token = tokenActual();
  if (token) cabeceras.Authorization = `Bearer ${token}`;

  if (opciones.claveIdempotencia) {
    cabeceras['Idempotency-Key'] = opciones.claveIdempotencia;
  }

  const intentos = opciones.reintentar === false ? 1 : ESPERA_REINTENTO_MS.length + 1;
  let ultimoError: unknown = null;

  for (let intento = 0; intento < intentos; intento += 1) {
    try {
      const respuesta = await fetch(`${BASE}${ruta}`, {
        method: metodo,
        credentials: 'include',
        headers: cabeceras,
        body:
          opciones.cuerpo === undefined
            ? undefined
            : esFormulario
              ? (opciones.cuerpo as FormData)
              : JSON.stringify(opciones.cuerpo),
        signal: opciones.senal,
      });

      if (respuesta.status === 401 && ruta !== '/auth/refresh' && ruta !== '/auth/login') {
        const renovado = await renovarToken();
        if (renovado) {
          cabeceras.Authorization = `Bearer ${tokenActual() ?? ''}`;
          continue;
        }
        useSesion.getState().cerrarSesion();
      }

      if (respuesta.status === 204) return undefined as T;

      const texto = await respuesta.text();
      const cuerpo = texto ? (JSON.parse(texto) as unknown) : null;

      if (!respuesta.ok) {
        const error = cuerpo as {
          codigo?: CodigoError;
          mensaje?: string;
          detalles?: { campo: string; mensaje: string }[];
        };
        throw new ErrorPeticion(
          respuesta.status,
          error?.codigo ?? 'INTERNO',
          error?.mensaje ?? 'Ocurrio un error inesperado',
          error?.detalles ?? [],
        );
      }

      return cuerpo as T;
    } catch (error) {
      if (error instanceof ErrorPeticion) throw error;
      ultimoError = error;
      if (intento < intentos - 1) {
        await esperar(ESPERA_REINTENTO_MS[intento] ?? 1000);
        continue;
      }
    }
  }

  throw new ErrorRed(
    ultimoError instanceof Error
      ? `No se pudo comunicar con el servidor: ${ultimoError.message}`
      : 'No se pudo comunicar con el servidor',
  );
}

export const api = {
  obtener: <T>(ruta: string, opciones?: Omit<OpcionesPeticion, 'metodo' | 'cuerpo'>) =>
    ejecutar<T>(ruta, { ...opciones, metodo: 'GET' }),
  enviar: <T>(ruta: string, cuerpo: unknown, opciones?: Omit<OpcionesPeticion, 'metodo' | 'cuerpo'>) =>
    ejecutar<T>(ruta, { ...opciones, metodo: 'POST', cuerpo }),
  crear: <T>(ruta: string, cuerpo: unknown, opciones?: Omit<OpcionesPeticion, 'metodo' | 'cuerpo'>) =>
    ejecutar<T>(ruta, { ...opciones, metodo: 'POST', cuerpo }),
  actualizar: <T>(ruta: string, cuerpo: unknown, opciones?: Omit<OpcionesPeticion, 'metodo' | 'cuerpo'>) =>
    ejecutar<T>(ruta, { ...opciones, metodo: 'PATCH', cuerpo }),
  reemplazar: <T>(ruta: string, cuerpo: unknown, opciones?: Omit<OpcionesPeticion, 'metodo' | 'cuerpo'>) =>
    ejecutar<T>(ruta, { ...opciones, metodo: 'PUT', cuerpo }),
  eliminar: <T>(ruta: string, opciones?: Omit<OpcionesPeticion, 'metodo' | 'cuerpo'>) =>
    ejecutar<T>(ruta, { ...opciones, metodo: 'DELETE' }),
  descarga: async (ruta: string, opciones?: Omit<OpcionesPeticion, 'metodo' | 'cuerpo'>) => {
    const token = tokenActual();
    const respuesta = await fetch(`${BASE}${ruta}`, {
      method: 'GET',
      credentials: 'include',
      headers: {
        Accept: '*/*',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(opciones?.cabecera ?? {}),
      },
    });
    if (!respuesta.ok) {
      throw new ErrorPeticion(respuesta.status, 'INTERNO', 'No se pudo descargar el archivo');
    }
    return respuesta.blob();
  },
};

export { nuevoClaveIdempotencia };
export const BASE_API = BASE;
