import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { AlertTriangle, CircleAlert, Code2, Inbox, Loader2, RefreshCw, X } from 'lucide-react';
import clsx from 'clsx';

export function PantallaCarga({ mensaje = 'Cargando' }: { mensaje?: string }) {
  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-primario-50 px-6"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="h-8 w-8 animate-spin text-primario-600" aria-hidden="true" />
      <p className="text-sm font-medium text-neutro-600">{mensaje}</p>
    </div>
  );
}

export function Esqueleto({ className }: { className?: string }) {
  return (
    <div
      className={clsx('animate-pulso-suave rounded-lg bg-neutro-200', className)}
      aria-hidden="true"
    />
  );
}

export function EsqueletoTarjeta({ lineas = 3 }: { lineas?: number }) {
  return (
    <div className="superficie p-4" aria-hidden="true">
      <Esqueleto className="h-4 w-2/5" />
      <div className="mt-3 space-y-2">
        {Array.from({ length: lineas }).map((_, indice) => (
          <Esqueleto key={indice} className={clsx('h-3', indice % 2 === 0 ? 'w-full' : 'w-4/5')} />
        ))}
      </div>
    </div>
  );
}

export function EstadoVacio({
  titulo,
  descripcion,
  icono,
  accion,
}: {
  titulo: string;
  descripcion?: string;
  icono?: ReactNode;
  accion?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-neutro-100 text-neutro-500">
        {icono ?? <Inbox className="h-6 w-6" aria-hidden="true" />}
      </div>
      <div>
        <p className="text-base font-semibold text-neutro-800">{titulo}</p>
        {descripcion ? (
          <p className="mt-1 max-w-md text-sm text-neutro-600">{descripcion}</p>
        ) : null}
      </div>
      {accion}
    </div>
  );
}

export function EstadoError({
  titulo = 'No se pudo cargar la informacion',
  descripcion,
  alReintentar,
}: {
  titulo?: string;
  descripcion?: string;
  alReintentar?: () => void;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 rounded-xl border border-error-300 bg-error-100 px-6 py-10 text-center"
      role="alert"
    >
      <CircleAlert className="h-7 w-7 text-error-600" aria-hidden="true" />
      <div>
        <p className="text-base font-semibold text-error-700">{titulo}</p>
        {descripcion ? <p className="mt-1 text-sm text-error-700">{descripcion}</p> : null}
      </div>
      {alReintentar ? (
        <button type="button" className="boton-secundario" onClick={alReintentar}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Reintentar
        </button>
      ) : null}
    </div>
  );
}

export function Insignia({
  tono = 'neutro',
  children,
}: {
  tono?: 'neutro' | 'exito' | 'aviso' | 'error' | 'primario';
  children: ReactNode;
}) {
  const tonos = {
    neutro: 'insignia-neutra',
    exito: 'insignia-exito',
    aviso: 'insignia-aviso',
    error: 'insignia-error',
    primario: 'insignia-marca',
  } as const;

  return <span className={clsx(tonos[tono])}>{children}</span>;
}

export function Tarjeta({
  titulo,
  descripcion,
  accion,
  children,
  className,
}: {
  titulo?: string;
  descripcion?: string;
  accion?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={clsx('superficie', className)}>
      {(titulo || accion) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-neutro-200 px-4 py-3.5">
          <div>
            {titulo ? <h2 className="text-md font-semibold text-neutro-900">{titulo}</h2> : null}
            {descripcion ? <p className="mt-0.5 text-sm text-neutro-600">{descripcion}</p> : null}
          </div>
          {accion}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Aviso({
  tono = 'aviso',
  titulo,
  children,
}: {
  tono?: 'aviso' | 'error' | 'exito' | 'primario';
  titulo?: string;
  children: ReactNode;
}) {
  const estilos = {
    aviso: 'border-aviso-200 bg-aviso-100 text-aviso-700',
    error: 'border-error-200 bg-error-100 text-error-700',
    exito: 'border-exito-200 bg-exito-100 text-exito-700',
    primario: 'border-primario-200 bg-primario-50 text-primario-700',
  } as const;

  const Icono = tono === 'error' ? CircleAlert : tono === 'exito' ? null : AlertTriangle;

  return (
    <div
      className={clsx(
        'flex items-start gap-2.5 rounded-2xl border px-4 py-3 text-sm',
        estilos[tono],
      )}
      role="status"
    >
      {Icono ? <Icono className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : null}
      <div className="min-w-0">
        {titulo ? <p className="font-semibold">{titulo}</p> : null}
        <div className={clsx(titulo && 'mt-0.5')}>{children}</div>
      </div>
    </div>
  );
}

export function Modal({
  abierto,
  titulo,
  alCerrar,
  children,
  pie,
}: {
  abierto: boolean;
  titulo: string;
  alCerrar: () => void;
  children: ReactNode;
  pie?: ReactNode;
}) {
  useEffect(() => {
    if (!abierto) return;
    const alPresionar = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') alCerrar();
    };
    document.addEventListener('keydown', alPresionar);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', alPresionar);
      document.body.style.overflow = '';
    };
  }, [abierto, alCerrar]);

  if (!abierto) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-neutro-900/50 p-0 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className="flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-2xl bg-white shadow-elevada sm:rounded-2xl"
      >
        <header className="flex items-center justify-between border-b border-neutro-200 px-4 py-3.5">
          <h2 className="text-md font-semibold text-neutro-900">{titulo}</h2>
          <button
            type="button"
            onClick={alCerrar}
            className="boton-compacto text-neutro-600 hover:bg-neutro-100"
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {pie ? <footer className="border-t border-neutro-200 px-4 py-3">{pie}</footer> : null}
      </div>
    </div>
  );
}

export function Paginacion({
  pagina,
  totalPaginas,
  total,
  alCambiar,
}: {
  pagina: number;
  totalPaginas: number;
  total: number;
  alCambiar: (pagina: number) => void;
}) {
  if (total === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutro-200 px-4 py-3">
      <p className="text-sm text-neutro-600">
        Pagina <span className="font-medium text-neutro-800">{pagina}</span> de{' '}
        <span className="font-medium text-neutro-800">{Math.max(totalPaginas, 1)}</span> -{' '}
        <span className="font-medium text-neutro-800">{total}</span> registros
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          className="boton-compacto border border-neutro-300 bg-white text-neutro-800 disabled:opacity-40"
          onClick={() => alCambiar(pagina - 1)}
          disabled={pagina <= 1}
        >
          Anterior
        </button>
        <button
          type="button"
          className="boton-compacto border border-neutro-300 bg-white text-neutro-800 disabled:opacity-40"
          onClick={() => alCambiar(pagina + 1)}
          disabled={pagina >= totalPaginas}
        >
          Siguiente
        </button>
      </div>
    </div>
  );
}

/**
 * Creditos de la aplicacion. Se muestra discreto al pie de cada superficie:
 * panel de administracion, app del operador, inicio de sesion y verificacion
 * publica de certificados.
 */
export function Creditos({ compacto = false }: { compacto?: boolean }) {
  return (
    <footer
      className={clsx(
        'mx-auto flex flex-col items-center gap-0.5 text-center',
        compacto ? 'text-[11px]' : 'text-xs',
      )}
    >
      <p className="flex flex-wrap items-center justify-center gap-x-1 gap-y-0.5 text-neutro-500">
        <Code2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>Desarrollado por</span>
        <span className="font-semibold text-neutro-700">Elier Fernando Rosero Bravo</span>
        <span aria-hidden="true">y</span>
        <span className="font-semibold text-neutro-700">Edwar Alexander Benito Basante</span>
      </p>
      <p className="text-neutro-400">
        Estudiantes de Ingenieria de Software - Universidad Cooperativa de Colombia
      </p>
    </footer>
  );
}
