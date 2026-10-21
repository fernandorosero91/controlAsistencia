const ZONA = 'America/Bogota';

const opcionesFecha: Intl.DateTimeFormatOptions = {
  timeZone: ZONA,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
};

export function formatearFecha(valor: string | Date | null | undefined): string {
  if (!valor) return '-';
  const fecha = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(fecha.getTime())) return '-';
  return new Intl.DateTimeFormat('es-CO', opcionesFecha).format(fecha);
}

export function formatearFechaHora(valor: string | Date | null | undefined): string {
  if (!valor) return '-';
  const fecha = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(fecha.getTime())) return '-';
  return new Intl.DateTimeFormat('es-CO', {
    ...opcionesFecha,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(fecha);
}

export function formatearHora(valor: string | Date | null | undefined): string {
  if (!valor) return '-';
  const fecha = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(fecha.getTime())) return '-';
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: ZONA,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(fecha);
}

export function formatearNumero(valor: number | null | undefined): string {
  if (valor === null || valor === undefined) return '-';
  return new Intl.NumberFormat('es-CO').format(valor);
}

export function formatearPorcentaje(valor: number | null | undefined): string {
  if (valor === null || valor === undefined) return '-';
  return `${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 }).format(valor)}%`;
}

export function nombreRol(rol: 'estudiante' | 'docente' | null | undefined): string {
  if (rol === 'estudiante') return 'Estudiante';
  if (rol === 'docente') return 'Docente';
  return '-';
}

/** Convierte un valor de fecha y hora local a ISO, para enviar a la API. */
export function aIso(valor: string): string {
  const fecha = new Date(valor);
  return Number.isNaN(fecha.getTime()) ? valor : fecha.toISOString();
}
