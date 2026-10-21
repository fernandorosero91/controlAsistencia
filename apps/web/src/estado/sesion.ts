import { create } from 'zustand';
import type { UsuarioSistema } from '@seminario/shared';

interface EstadoSesion {
  usuario: UsuarioSistema | null;
  tokenAcceso: string | null;
  expiraEn: number | null;
  inicializando: boolean;
  establecerSesion: (usuario: UsuarioSistema, tokenAcceso: string, expiraEn: number) => void;
  establecerToken: (tokenAcceso: string, expiraEn: number) => void;
  cerrarSesion: () => void;
  marcarInicializada: (valor: boolean) => void;
}

export const useSesion = create<EstadoSesion>((set) => ({
  usuario: null,
  tokenAcceso: null,
  expiraEn: null,
  inicializando: true,
  establecerSesion: (usuario, tokenAcceso, expiraEn) =>
    set({ usuario, tokenAcceso, expiraEn, inicializando: false }),
  establecerToken: (tokenAcceso, expiraEn) => set({ tokenAcceso, expiraEn }),
  cerrarSesion: () => set({ usuario: null, tokenAcceso: null, expiraEn: null }),
  marcarInicializada: (valor) => set({ inicializando: valor }),
}));

export function tokenActual(): string | null {
  return useSesion.getState().tokenAcceso;
}
