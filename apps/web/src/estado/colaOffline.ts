import { openDB, type IDBPDatabase } from 'idb';
import { create } from 'zustand';

export type TipoRegistroCola = 'ingreso' | 'salida' | 'refrigerio';
export type EstadoCola = 'pendiente' | 'sincronizado' | 'conflicto' | 'error';

export interface RegistroCola {
  id: string;
  tipo: TipoRegistroCola;
  asistenteId: string;
  jornadaId: number;
  tipoRefrigerioId: number | null;
  creadoEn: string;
  intentos: number;
  estado: EstadoCola;
  mensaje: string | null;
}

const NOMBRE_BD = 'seminario-asistencia';
const ALMACEN = 'registros-pendientes';

let promesaBd: Promise<IDBPDatabase> | null = null;

function abrirBd(): Promise<IDBPDatabase> {
  if (!promesaBd) {
    promesaBd = openDB(NOMBRE_BD, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(ALMACEN)) {
          const almacen = db.createObjectStore(ALMACEN, { keyPath: 'id' });
          almacen.createIndex('porEstado', 'estado');
          almacen.createIndex('porFecha', 'creadoEn');
        }
      },
    });
  }
  return promesaBd;
}

export async function agregarALaCola(registro: RegistroCola): Promise<void> {
  const db = await abrirBd();
  await db.put(ALMACEN, registro);
}

export async function listarDeLaCola(): Promise<RegistroCola[]> {
  const db = await abrirBd();
  const registros = await db.getAll(ALMACEN);
  return registros.sort((a, b) => a.creadoEn.localeCompare(b.creadoEn));
}

export async function listarPendientes(): Promise<RegistroCola[]> {
  const registros = await listarDeLaCola();
  return registros.filter(
    (registro) => registro.estado === 'pendiente' || registro.estado === 'error',
  );
}

export async function actualizarEnCola(registro: RegistroCola): Promise<void> {
  const db = await abrirBd();
  await db.put(ALMACEN, registro);
}

export async function eliminarDeLaCola(id: string): Promise<void> {
  const db = await abrirBd();
  await db.delete(ALMACEN, id);
}

export async function vaciarCola(): Promise<void> {
  const db = await abrirBd();
  await db.clear(ALMACEN);
}

interface EstadoColaStore {
  pendientes: number;
  conflictos: number;
  enLinea: boolean;
  sincronizando: boolean;
  refrescar: () => Promise<void>;
  establecerEnLinea: (valor: boolean) => void;
  establecerSincronizando: (valor: boolean) => void;
}

export const useColaOffline = create<EstadoColaStore>((set) => ({
  pendientes: 0,
  conflictos: 0,
  enLinea: typeof navigator === 'undefined' ? true : navigator.onLine,
  sincronizando: false,
  refrescar: async () => {
    try {
      const registros = await listarDeLaCola();
      set({
        pendientes: registros.filter((r) => r.estado === 'pendiente' || r.estado === 'error')
          .length,
        conflictos: registros.filter((r) => r.estado === 'conflicto').length,
      });
    } catch {
      set({ pendientes: 0, conflictos: 0 });
    }
  },
  establecerEnLinea: (valor) => set({ enLinea: valor }),
  establecerSincronizando: (valor) => set({ sincronizando: valor }),
}));

export function registrarEstadoConexion(): () => void {
  const actualizar = () => {
    useColaOffline.getState().establecerEnLinea(navigator.onLine);
    if (navigator.onLine) void useColaOffline.getState().refrescar();
  };
  window.addEventListener('online', actualizar);
  window.addEventListener('offline', actualizar);
  return () => {
    window.removeEventListener('online', actualizar);
    window.removeEventListener('offline', actualizar);
  };
}
