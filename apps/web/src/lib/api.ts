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

let refrescoEnCurso: Promise<ResultadoRenovacion> | null = null;
let temporizadorRenovacion: number | null = null;

/**
 * Resultado de renovar el token de acceso.
 *
 * - `ok`: hay token nuevo.
 * - `expirado`: el servidor dice que la sesion no existe mas. Solo en este
 *   caso se cierra la sesion en el navegador.
 * - `red`: no se pudo hablar con el servidor. La sesion se conserva: un fallo
 *   de red no debe expulsar al operador del panel en mitad del evento.
 */
export type ResultadoRenovacion = 'ok' | 'expirado' | 'red';

const MARGEN_RENOVACION_SEGUNDOS = 60;

/**
 * Programa la renovacion del token antes de que expire.
 *
 * Sin esto, el token de acceso vence a los quince minutos y la primera
 * peticion despues de ese momento recibe un 401: el operador ve un error en
 * pantalla aunque la sesion siga vigente. Con la renovacion anticipada el
 * token cambia solo y no se ve ningun error.
 */
export function programarRenovacion(expiraEnSegundos: number): void {
  if (typeof window === 'undefined') return;
  if (temporizadorRenovacion !== null) {
    window.clearTimeout(temporizadorRenovacion);
    temporizadorRenovacion = null;
  }
  const espera = Math.max((expiraEnSegundos - MARGEN_RENOVACION_SEGUNDOS) * 1000, 10_000);
  temporizadorRenovacion = window.setTimeout(() => {
    temporizadorRenovacion = null;
    void renovarTokenDetallado();
  }, espera);
}

/** Cancela la renovacion programada (por ejemplo, al cerrar la sesion). */
export function cancelarRenovacion(): void {
  if (typeof window === 'undefined') return;
  if (temporizadorRenovacion !== null) {
    window.clearTimeout(temporizadorRenovacion);
    temporizadorRenovacion = null;
  }
}

/** Renueva el token de acceso usando el refresh token en cookie httpOnly. */
export async function renovarToken(): Promise<boolean> {
  return (await renovarTokenDetallado()) === 'ok';
}

/**
 * Renueva el token de acceso. Reintenta una vez: si otra pestana del mismo
 * navegador renovo la sesion en el mismo instante, la cookie puede haberse
 * actualizado justo despues de enviar esta peticion.
 */
export async function renovarTokenDetallado(): Promise<ResultadoRenovacion> {
  if (refrescoEnCurso) return refrescoEnCurso;

  const promesa = (async (): Promise<ResultadoRenovacion> => {
    for (let intento = 0; intento < 2; intento += 1) {
      try {
        const respuesta = await fetch(`${BASE}/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });

        if (respuesta.ok) {
          const datos = (await respuesta.json()) as {
            tokenAcceso: string;
            expiraEn: number;
            usuario: UsuarioSistema | null;
          };
          useSesion.getState().establecerToken(datos.tokenAcceso, datos.expiraEn);
          if (datos.usuario) {
            useSesion.getState().establecerSesion(datos.usuario, datos.tokenAcceso, datos.expiraEn);
          }
          programarRenovacion(datos.expiraEn);
          return 'ok';
        }

        if (respuesta.status === 401) {
          // La sesion no existe o el refresh token ya se uso en otra
          // renovacion. Se reintenta una vez por si la cookie se actualizo.
          if (intento === 0) {
            await esperar(700);
            continue;
          }
          return 'expirado';
        }

        // Un error del servidor (500) no cierra la sesion: se reintenta.
        if (intento === 0) {
          await esperar(700);
          continue;
        }
        return 'red';
      } catch {
        if (intento === 0) {
          await esperar(700);
          continue;
        }
        return 'red';
      }
    }
    return 'red';
  })();

  refrescoEnCurso = promesa;
  try {
    return await promesa;
  } finally {
    refrescoEnCurso = null;
  }
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
        const resultado = await renovarTokenDetallado();
        if (resultado === 'ok') {
          cabeceras.Authorization = `Bearer ${tokenActual() ?? ''}`;
          continue;
        }
        // Solo se cierra la sesion cuando el servidor confirma que ya no
        // existe. Un fallo de red deja la sesion vigente: el operador puede
        // reintentar sin volver a iniciar sesion.
        if (resultado === 'expirado') {
          cancelarRenovacion();
          useSesion.getState().cerrarSesion();
        }
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
  enviar: <T>(
    ruta: string,
    cuerpo: unknown,
    opciones?: Omit<OpcionesPeticion, 'metodo' | 'cuerpo'>,
  ) => ejecutar<T>(ruta, { ...opciones, metodo: 'POST', cuerpo }),
  crear: <T>(
    ruta: string,
    cuerpo: unknown,
    opciones?: Omit<OpcionesPeticion, 'metodo' | 'cuerpo'>,
  ) => ejecutar<T>(ruta, { ...opciones, metodo: 'POST', cuerpo }),
  actualizar: <T>(
    ruta: string,
    cuerpo: unknown,
    opciones?: Omit<OpcionesPeticion, 'metodo' | 'cuerpo'>,
  ) => ejecutar<T>(ruta, { ...opciones, metodo: 'PATCH', cuerpo }),
  reemplazar: <T>(
    ruta: string,
    cuerpo: unknown,
    opciones?: Omit<OpcionesPeticion, 'metodo' | 'cuerpo'>,
  ) => ejecutar<T>(ruta, { ...opciones, metodo: 'PUT', cuerpo }),
  eliminar: <T>(ruta: string, opciones?: Omit<OpcionesPeticion, 'metodo' | 'cuerpo'>) =>
    ejecutar<T>(ruta, { ...opciones, metodo: 'DELETE' }),
  /** Cierra la sesion en el servidor: revoca el refresh token. */
  cerrarSesion: async () => {
    cancelarRenovacion();
    try {
      await fetch(`${BASE}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
    } catch {
      // Si el servidor no responde, la sesion local se cierra igual.
    }
  },
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
