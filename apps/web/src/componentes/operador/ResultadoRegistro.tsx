import { useEffect, useRef } from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import clsx from 'clsx';
import type { RespuestaRegistro } from '@seminario/shared';
import { formatearHora, nombreRol } from '../../lib/formato';

interface Props {
  resultado: RespuestaRegistro | null;
  alCerrar?: () => void;
}

const ESTILOS = {
  exito: {
    borde: 'border-exito-200',
    fondo: 'bg-exito',
    chip: 'bg-exito-500',
    titulo: 'text-exito-700',
    texto: 'text-neutro-700',
    fuerte: 'text-neutro-900',
    Icono: CheckCircle2,
  },
  duplicado: {
    borde: 'border-aviso-200',
    fondo: 'bg-aviso',
    chip: 'bg-aviso-500',
    titulo: 'text-aviso-700',
    texto: 'text-neutro-700',
    fuerte: 'text-neutro-900',
    Icono: AlertTriangle,
  },
  fuera_de_ventana: {
    borde: 'border-aviso-200',
    fondo: 'bg-aviso',
    chip: 'bg-aviso-500',
    titulo: 'text-aviso-700',
    texto: 'text-neutro-700',
    fuerte: 'text-neutro-900',
    Icono: Info,
  },
  no_permitido: {
    borde: 'border-error-200',
    fondo: 'bg-error',
    chip: 'bg-error-500',
    titulo: 'text-error-700',
    texto: 'text-neutro-700',
    fuerte: 'text-neutro-900',
    Icono: XCircle,
  },
  no_encontrado: {
    borde: 'border-error-200',
    fondo: 'bg-error',
    chip: 'bg-error-500',
    titulo: 'text-error-700',
    texto: 'text-neutro-700',
    fuerte: 'text-neutro-900',
    Icono: XCircle,
  },
} as const;

export function ResultadoRegistro({ resultado, alCerrar }: Props) {
  const referenciaRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (resultado) referenciaRef.current?.focus();
  }, [resultado]);

  if (!resultado) return null;

  const estilos = ESTILOS[resultado.resultado];
  const { Icono } = estilos;
  const existente = resultado.existente as
    | {
        horaIngreso?: string;
        horaSalida?: string | null;
        entregadoAt?: string;
        registradoPor?: string | null;
        entregadoPor?: string | null;
        jornadaNombre?: string | null;
        tipoRefrigerioNombre?: string | null;
      }
    | null;

  const hora = existente?.horaIngreso ?? existente?.entregadoAt ?? existente?.horaSalida ?? null;
  const responsable = existente?.registradoPor ?? existente?.entregadoPor ?? null;
  const contexto = existente?.tipoRefrigerioNombre ?? existente?.jornadaNombre ?? null;

  return (
    <div
      ref={referenciaRef}
      tabIndex={-1}
      role="status"
      aria-live="assertive"
      className={clsx(
        'animate-entrada-resultado rounded-3xl border px-4 py-4 shadow-resultado outline-none',
        estilos.borde,
        estilos.fondo,
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={clsx(
            'flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white shadow-tarjeta',
            estilos.chip,
          )}
        >
          <Icono className="h-6 w-6" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className={clsx('text-lg font-bold leading-tight', estilos.titulo)}>
            {resultado.resultado === 'exito'
              ? 'Registro exitoso'
              : resultado.resultado === 'duplicado'
                ? 'Asistencia ya registrada'
                : resultado.resultado === 'no_encontrado'
                  ? 'ID no encontrado'
                  : resultado.resultado === 'fuera_de_ventana'
                    ? 'Fuera de la ventana de registro'
                    : 'Registro no permitido'}
          </p>
          <p className={clsx('mt-1 text-sm', estilos.texto)}>{resultado.mensaje}</p>

          {resultado.asistente ? (
            <dl className="mt-3 space-y-1 text-sm">
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 font-semibold text-neutro-500 sm:w-24">Nombre</dt>
                <dd className={clsx('font-bold', estilos.fuerte)}>
                  {resultado.asistente.nombres} {resultado.asistente.apellidos}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 font-semibold text-neutro-500 sm:w-24">ID</dt>
                <dd className={clsx('font-mono font-bold', estilos.fuerte)}>
                  {resultado.asistente.id}
                </dd>
              </div>
              {resultado.asistente.codigoRegistro ? (
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 font-semibold text-neutro-500 sm:w-24">Codigo</dt>
                  <dd className={clsx('font-mono font-bold tracking-wider', estilos.fuerte)}>
                    {resultado.asistente.codigoRegistro}
                  </dd>
                </div>
              ) : null}
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 font-semibold text-neutro-500 sm:w-24">Rol</dt>
                <dd className={estilos.texto}>
                  {nombreRol(resultado.asistente.rol)}
                  {resultado.asistente.semestre !== null
                    ? ` - Semestre ${resultado.asistente.semestre}`
                    : ''}
                </dd>
              </div>
              {hora ? (
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 font-semibold text-neutro-500 sm:w-24">Hora</dt>
                  <dd className={clsx('font-semibold', estilos.fuerte)}>{formatearHora(hora)}</dd>
                </div>
              ) : null}
              {contexto ? (
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 font-semibold text-neutro-500 sm:w-24">Referencia</dt>
                  <dd className={estilos.texto}>{contexto}</dd>
                </div>
              ) : null}
              {responsable ? (
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 font-semibold text-neutro-500 sm:w-24">Registrado por</dt>
                  <dd className={estilos.texto}>{responsable}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
        </div>
      </div>

      {alCerrar ? (
        <button
          type="button"
          onClick={alCerrar}
          className="boton-compacto mt-3 w-full bg-white/80 text-neutro-700 shadow-tarjeta hover:bg-white"
        >
          Continuar
        </button>
      ) : null}
    </div>
  );
}
