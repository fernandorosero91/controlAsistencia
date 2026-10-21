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
    contenedor: 'border-exito-300 bg-exito-100',
    titulo: 'text-exito-700',
    texto: 'text-exito-700',
    Icono: CheckCircle2,
  },
  duplicado: {
    contenedor: 'border-aviso-300 bg-aviso-100',
    titulo: 'text-aviso-700',
    texto: 'text-aviso-700',
    Icono: AlertTriangle,
  },
  fuera_de_ventana: {
    contenedor: 'border-aviso-300 bg-aviso-100',
    titulo: 'text-aviso-700',
    texto: 'text-aviso-700',
    Icono: Info,
  },
  no_permitido: {
    contenedor: 'border-error-300 bg-error-100',
    titulo: 'text-error-700',
    texto: 'text-error-700',
    Icono: XCircle,
  },
  no_encontrado: {
    contenedor: 'border-error-300 bg-error-100',
    titulo: 'text-error-700',
    texto: 'text-error-700',
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

  const hora =
    existente?.horaIngreso ?? existente?.entregadoAt ?? existente?.horaSalida ?? null;
  const responsable = existente?.registradoPor ?? existente?.entregadoPor ?? null;
  const contexto =
    existente?.tipoRefrigerioNombre ??
    existente?.jornadaNombre ??
    null;

  return (
    <div
      ref={referenciaRef}
      tabIndex={-1}
      role="status"
      aria-live="assertive"
      className={clsx(
        'animate-entrada-resultado rounded-xl border-2 px-4 py-4 shadow-resultado outline-none',
        estilos.contenedor,
      )}
    >
      <div className="flex items-start gap-3">
        <Icono className={clsx('h-8 w-8 shrink-0', estilos.titulo)} aria-hidden="true" />
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
                <dt className="w-24 shrink-0 font-medium opacity-70">Nombre</dt>
                <dd className={clsx('font-semibold', estilos.texto)}>
                  {resultado.asistente.nombres} {resultado.asistente.apellidos}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-24 shrink-0 font-medium opacity-70">ID</dt>
                <dd className={clsx('font-mono font-semibold', estilos.texto)}>
                  {resultado.asistente.id}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-24 shrink-0 font-medium opacity-70">Rol</dt>
                <dd className={estilos.texto}>
                  {nombreRol(resultado.asistente.rol)}
                  {resultado.asistente.semestre !== null
                    ? ` - Semestre ${resultado.asistente.semestre}`
                    : ''}
                </dd>
              </div>
              {hora ? (
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 font-medium opacity-70">Hora</dt>
                  <dd className={clsx('font-medium', estilos.texto)}>{formatearHora(hora)}</dd>
                </div>
              ) : null}
              {contexto ? (
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 font-medium opacity-70">Referencia</dt>
                  <dd className={estilos.texto}>{contexto}</dd>
                </div>
              ) : null}
              {responsable ? (
                <div className="flex gap-2">
                  <dt className="w-24 shrink-0 font-medium opacity-70">Registrado por</dt>
                  <dd className={estilos.texto}>{responsable}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
        </div>
      </div>

      {alCerrar ? (
        <button type="button" onClick={alCerrar} className="boton-compacto mt-3 w-full border border-current/20 bg-white/60">
          Continuar
        </button>
      ) : null}
    </div>
  );
}
