/**
 * Retroalimentacion tactile y sonora del registro. Ambas son configurables por el
 * operador y se guardan en el dispositivo (preferencia local, no requiere servidor).
 */

export type TipoAviso = 'exito' | 'aviso' | 'error';

const CLAVE_PREFERENCIA = 'seminario.preferencias.retroalimentacion';

export interface PreferenciasRetroalimentacion {
  sonido: boolean;
  vibracion: boolean;
}

const PREFERENCIAS_POR_DEFECTO: PreferenciasRetroalimentacion = {
  sonido: true,
  vibracion: true,
};

export function leerPreferencias(): PreferenciasRetroalimentacion {
  try {
    const bruto = localStorage.getItem(CLAVE_PREFERENCIA);
    if (!bruto) return { ...PREFERENCIAS_POR_DEFECTO };
    const guardado = JSON.parse(bruto) as Partial<PreferenciasRetroalimentacion>;
    return {
      sonido: guardado.sonido ?? true,
      vibracion: guardado.vibracion ?? true,
    };
  } catch {
    return { ...PREFERENCIAS_POR_DEFECTO };
  }
}

export function guardarPreferencias(preferencias: PreferenciasRetroalimentacion): void {
  try {
    localStorage.setItem(CLAVE_PREFERENCIA, JSON.stringify(preferencias));
  } catch {
    // Si el almacenamiento no esta disponible se usan los valores por defecto.
  }
}

const PATRONES_VIBRACION: Record<TipoAviso, number | number[]> = {
  exito: 40,
  aviso: [35, 60, 35],
  error: [60, 40, 60],
};

const FRECUENCIAS: Record<TipoAviso, [number, number][]> = {
  exito: [[660, 0.09], [880, 0.12]],
  aviso: [[520, 0.1], [0, 0.04], [520, 0.1]],
  error: [[240, 0.16], [180, 0.2]],
};

export function vibrar(tipo: TipoAviso): void {
  const preferencias = leerPreferencias();
  if (!preferencias.vibracion) return;
  if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return;
  try {
    navigator.vibrate(PATRONES_VIBRACION[tipo]);
  } catch {
    // Algunos navegadores restringen la vibracion sin interaccion previa.
  }
}

let contexto: AudioContext | null = null;

function obtenerContexto(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Constructor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Constructor) return null;
  if (!contexto) contexto = new Constructor();
  return contexto;
}

export function reproducirAviso(tipo: TipoAviso): void {
  const preferencias = leerPreferencias();
  if (!preferencias.sonido) return;

  const audio = obtenerContexto();
  if (!audio) return;
  if (audio.state === 'suspended') void audio.resume();

  let inicio = audio.currentTime;
  for (const [frecuencia, duracion] of FRECUENCIAS[tipo]) {
    if (frecuencia === 0) {
      inicio += duracion;
      continue;
    }
    const oscilador = audio.createOscillator();
    const ganancia = audio.createGain();
    oscilador.type = 'sine';
    oscilador.frequency.value = frecuencia;
    ganancia.gain.setValueAtTime(0.0001, inicio);
    ganancia.gain.exponentialRampToValueAtTime(0.18, inicio + 0.012);
    ganancia.gain.exponentialRampToValueAtTime(0.0001, inicio + duracion);
    oscilador.connect(ganancia);
    ganancia.connect(audio.destination);
    oscilador.start(inicio);
    oscilador.stop(inicio + duracion + 0.02);
    inicio += duracion;
  }
}

export function avisar(tipo: TipoAviso): void {
  vibrar(tipo);
  reproducirAviso(tipo);
}
