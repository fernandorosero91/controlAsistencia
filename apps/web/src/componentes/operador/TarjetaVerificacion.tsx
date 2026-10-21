import { CircleAlert, Clock, IdCard, ShieldCheck, UserRound } from 'lucide-react';
import { formatearHora, nombreRol } from '../../lib/formato';

export interface VerificacionAsistente {
  encontrado: boolean;
  asistente: {
    id: string;
    codigoRegistro: string | null;
    cedulaCiudadania: string | null;
    nombres: string;
    apellidos: string;
    rol: 'estudiante' | 'docente';
    semestre: number | null;
  } | null;
  jornadas: {
    jornadaId: number;
    jornadaNombre: string;
    tieneIngreso: boolean;
    horaIngreso: string | null;
    horaSalida: string | null;
    registradoPor: string | null;
  }[];
}

interface Props {
  verificacion: VerificacionAsistente | null;
  cargando: boolean;
  jornadaId: number | null;
}

/**
 * Muestra el nombre del asistente antes de registrarlo, para que el operador lo
 * compare con la escarapela y confirme que es la misma persona.
 */
export function TarjetaVerificacion({ verificacion, cargando, jornadaId }: Props) {
  if (cargando) {
    return (
      <div className="superficie flex items-center gap-3 p-4" role="status" aria-live="polite">
        <span className="h-8 w-8 animate-pulse rounded-xl bg-neutro-200" aria-hidden="true" />
        <div className="flex-1 space-y-2">
          <span
            className="block h-4 w-2/3 animate-pulse rounded bg-neutro-200"
            aria-hidden="true"
          />
          <span
            className="block h-3 w-1/3 animate-pulse rounded bg-neutro-200"
            aria-hidden="true"
          />
        </div>
        <span className="text-sm text-neutro-500">Buscando asistente</span>
      </div>
    );
  }

  if (!verificacion) return null;

  if (!verificacion.encontrado || !verificacion.asistente) {
    return (
      <div
        className="rounded-2xl border-2 border-error-200 bg-error-100 p-4"
        role="status"
        aria-live="polite"
      >
        <p className="flex items-center gap-2 text-base font-bold text-error-700">
          <CircleAlert className="h-5 w-5" aria-hidden="true" />
          ID no encontrado
        </p>
        <p className="mt-1 text-sm text-error-700">
          Revise el codigo de la escarapela o use la busqueda manual por nombre.
        </p>
      </div>
    );
  }

  const asistente = verificacion.asistente;
  const jornadaActual = verificacion.jornadas.find((j) => j.jornadaId === jornadaId);
  const yaRegistrado = jornadaActual?.tieneIngreso === true;

  return (
    <div
      className="superficie overflow-hidden"
      role="status"
      aria-live="polite"
      data-testid="tarjeta-verificacion"
    >
      <div className="flex items-start gap-3 bg-marca-suave px-4 py-3.5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-marca text-white shadow-marca">
          <UserRound className="h-6 w-6" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutro-600">
            Assistente verificado
          </p>
          <p className="text-lg font-bold leading-tight text-neutro-900">
            {asistente.nombres} {asistente.apellidos}
          </p>
          <p className="mt-0.5 text-sm text-neutro-700">
            {nombreRol(asistente.rol)}
            {asistente.semestre !== null ? ` - Semestre ${asistente.semestre}` : ''}
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 px-4 py-3 text-sm">
        <div className="flex items-center gap-1.5">
          <IdCard className="h-4 w-4 shrink-0 text-neutro-500" aria-hidden="true" />
          <dt className="sr-only">ID institucional</dt>
          <dd className="font-mono font-semibold text-neutro-800">{asistente.id}</dd>
        </div>
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="h-4 w-4 shrink-0 text-neutro-500" aria-hidden="true" />
          <dt className="sr-only">Codigo de registro</dt>
          <dd className="font-mono font-semibold tracking-widest text-neutro-800">
            {asistente.codigoRegistro ?? '-'}
          </dd>
        </div>
        {asistente.cedulaCiudadania ? (
          <div className="flex items-center gap-1.5">
            <IdCard className="h-4 w-4 shrink-0 text-neutro-500" aria-hidden="true" />
            <dt className="sr-only">Cedula de ciudadania</dt>
            <dd className="font-mono font-semibold text-neutro-800">
              {asistente.cedulaCiudadania}
            </dd>
          </div>
        ) : null}
      </dl>

      <ul className="divide-y divide-neutro-100 border-t border-neutro-100">
        {verificacion.jornadas.map((jornada) => (
          <li
            key={jornada.jornadaId}
            className="flex items-center justify-between gap-2 px-4 py-2.5"
          >
            <span className="text-sm text-neutro-700">{jornada.jornadaNombre}</span>
            {jornada.tieneIngreso ? (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-aviso-700">
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                Ingreso {formatearHora(jornada.horaIngreso)}
                {jornada.horaSalida ? ` - salida ${formatearHora(jornada.horaSalida)}` : ''}
              </span>
            ) : (
              <span className="text-xs font-semibold text-exito-700">Sin registro</span>
            )}
          </li>
        ))}
      </ul>

      {yaRegistrado ? (
        <p className="border-t border-aviso-200 bg-aviso-100 px-4 py-2.5 text-xs font-semibold text-aviso-700">
          Esta persona ya tiene ingreso registrado en la jornada activa
          {jornadaActual?.registradoPor ? ` (${jornadaActual.registradoPor})` : ''}. Confirme que es
          la misma persona antes de continuar.
        </p>
      ) : null}
    </div>
  );
}
