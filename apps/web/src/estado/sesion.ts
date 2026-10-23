import { create } from 'zustand';
import type { UsuarioSistema } from '@seminario/shared';

/**
 * Sesion en memoria del navegador.
 *
 * `expiraEn` son los segundos de vida del token (no una marca de tiempo);
 * `emitidoEn` guarda cuando se recibio, para poder renovarlo al volver a la app
 * despues de que el telefono haya estado en segundo plano.
 *
 * `motivoSalida` permite mostrar en el inicio de sesion por que se cerro: un
 * cierre manual o una sesion vencida.
 */
export type MotivoSalida = 'manual' | 'expirada';

interface EstadoSesion {
  usuario: UsuarioSistema | null;
  tokenAcceso: string | null;
  expiraEn: number | null;
  emitidoEn: number | null;
  motivoSalida: MotivoSalida | null;
  inicializando: boolean;
  establecerSesion: (usuario: UsuarioSistema, tokenAcceso: string, expiraEn: number) => void;
  establecerToken: (tokenAcceso: string, expiraEn: number) => void;
  cerrarSesion: (motivo?: MotivoSalida) => void;
  marcarInicializada: (valor: boolean) => void;
}

export const useSesion = create<EstadoSesion>((set) => ({
  usuario: null,
  tokenAcceso: null,
  expiraEn: null,
  emitidoEn: null,
  motivoSalida: null,
  inicializando: true,
  establecerSesion: (usuario, tokenAcceso, expiraEn) =>
    set({
      usuario,
      tokenAcceso,
      expiraEn,
      emitidoEn: Date.now(),
      motivoSalida: null,
      inicializando: false,
    }),
  establecerToken: (tokenAcceso, expiraEn) =>
    set({ tokenAcceso, expiraEn, emitidoEn: Date.now() }),
  cerrarSesion: (motivo = 'manual') =>
    set({
      usuario: null,
      tokenAcceso: null,
      expiraEn: null,
      emitidoEn: null,
      motivoSalida: motivo,
    }),
  marcarInicializada: (valor) => set({ inicializando: valor }),
}));

export function tokenActual(): string | null {
  return useSesion.getState().tokenAcceso;
}

/**
 * Indica si el token de acceso esta por vencer (o ya vencio). Se usa al volver
 * a la app: el temporizador de renovacion puede haberse pausado con la pantalla
 * apagada.
 */
export function tokenPorVencer(margenSegundos = 120): boolean {
  const { tokenAcceso, expiraEn, emitidoEn } = useSesion.getState();
  if (!tokenAcceso || !expiraEn || !emitidoEn) return false;
  return Date.now() + margenSegundos * 1000 >= emitidoEn + expiraEn * 1000;
}
