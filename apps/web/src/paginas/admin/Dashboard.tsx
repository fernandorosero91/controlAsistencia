import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Award, DoorOpen, ScanLine, TrendingUp, Users } from 'lucide-react';
import clsx from 'clsx';
import type { ResumenDashboard } from '@seminario/shared';
import { BASE_API, renovarTokenDetallado } from '../../lib/api';
import { tokenActual } from '../../estado/sesion';
import { formatearNumero, formatearPorcentaje } from '../../lib/formato';
import { EsqueletoTarjeta, EstadoError, Tarjeta } from '../../componentes/comunes';

const ETAG_RESUMEN = { valor: null as string | null };

async function obtenerResumenConEtag(): Promise<ResumenDashboard> {
  // El resumen se pide con un fetch propio para poder enviar la cabecera
  // If-None-Match. Por eso el 401 se atiende aqui: si el token vencio, se
  // renueva y se reintenta, en lugar de dejar el panel en error.
  for (let intento = 0; intento < 2; intento += 1) {
    const cliente = new AbortController();
    const token = tokenActual();
    const respuesta = await fetch(`${BASE_API}/dashboard/resumen`, {
      method: 'GET',
      credentials: 'include',
      signal: cliente.signal,
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(ETAG_RESUMEN.valor ? { 'If-None-Match': ETAG_RESUMEN.valor } : {}),
      },
    });

    if (respuesta.status === 401) {
      const resultado = await renovarTokenDetallado();
      if (resultado === 'ok') continue;
    }

    if (respuesta.status === 304) {
      throw new Error('SIN_CAMBIOS');
    }

    if (!respuesta.ok) {
      throw new Error('No se pudo cargar el resumen del seminario');
    }

    ETAG_RESUMEN.valor = respuesta.headers.get('etag');
    return (await respuesta.json()) as ResumenDashboard;
  }

  throw new Error('No se pudo cargar el resumen del seminario');
}

export function Dashboard() {
  const cliente = useQueryClient();

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['dashboard', 'resumen'],
    queryFn: async () => {
      try {
        return await obtenerResumenConEtag();
      } catch (error) {
        if (error instanceof Error && error.message === 'SIN_CAMBIOS') {
          const previo = cliente.getQueryData<ResumenDashboard>(['dashboard', 'resumen']);
          if (previo) return previo;
        }
        throw error;
      }
    },
    refetchInterval: 5000,
    staleTime: 3000,
  });

  if (isError) {
    return (
      <EstadoError
        titulo="No se pudo cargar el panel"
        descripcion="Revise la conexion con el servidor de la API."
        alReintentar={() => void refetch()}
      />
    );
  }

  if (isPending || !data) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <EsqueletoTarjeta />
        <EsqueletoTarjeta />
        <EsqueletoTarjeta />
        <EsqueletoTarjeta lineas={2} />
        <EsqueletoTarjeta lineas={2} />
        <EsqueletoTarjeta lineas={2} />
      </div>
    );
  }

  const maximoRitmo = Math.max(...data.ritmoIngreso.map((punto) => punto.registros), 1);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-neutro-900">Estado del seminario</h2>
          <p className="text-sm text-neutro-600">Indicadores actualizados cada 5 segundos.</p>
        </div>
        <Link to="/operador" className="boton-primario">
          <ScanLine className="h-4 w-4" aria-hidden="true" />
          Abrir la app del operador
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador
          titulo="Asistentes registrados"
          valor={formatearNumero(data.totalAsistentes)}
          detalle="Padron activo del seminario"
          Icono={Users}
        />
        <Indicador
          titulo="Adentro ahora"
          valor={formatearNumero(data.dentroAhora)}
          detalle={
            data.jornadaActivaNombre
              ? `${formatearNumero(data.fueraAhora)} ya registraron salida`
              : `${formatearNumero(data.fueraAhora)} ya registraron salida · sin jornada activa`
          }
          Icono={DoorOpen}
        />
        <Indicador
          titulo="Elegibles a certificado"
          valor={formatearNumero(data.elegibles)}
          detalle={`${formatearNumero(data.noElegibles)} no elegibles`}
          Icono={Award}
        />
        <Indicador
          titulo="Certificados emitidos"
          valor={formatearNumero(data.emitidos)}
          detalle={`${formatearNumero(data.revocados)} revocados`}
          Icono={Award}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Tarjeta
          titulo="Asistencia por jornada"
          descripcion="Ingresos, salidas y faltantes de cada jornada"
        >
          <div className="space-y-3">
            {data.porJornada.map((jornada) => (
              <div key={jornada.jornadaId} className="rounded-2xl bg-neutro-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-neutro-900">{jornada.jornadaNombre}</p>
                  <p className="text-sm font-medium text-primario-700">
                    {formatearPorcentaje(jornada.porcentajeAsistencia)}
                  </p>
                </div>
                <div
                  className="barra-progreso mt-2"
                  role="img"
                  aria-label={`Asistencia de la jornada ${jornada.jornadaNombre}: ${formatearPorcentaje(
                    jornada.porcentajeAsistencia,
                  )}`}
                >
                  <div
                    className="barra-progreso-relleno bg-acento"
                    style={{ width: `${Math.min(jornada.porcentajeAsistencia, 100)}%` }}
                  />
                </div>
                <dl className="mt-2.5 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <div>
                    <dt className="text-neutro-500">Ingresos</dt>
                    <dd className="font-semibold text-neutro-800">
                      {formatearNumero(jornada.ingresos)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-neutro-500">Salidas</dt>
                    <dd className="font-semibold text-neutro-800">
                      {formatearNumero(jornada.salidas)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-neutro-500">Sin salida</dt>
                    <dd className="font-semibold text-aviso-700">
                      {formatearNumero(jornada.dentroAhora)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-neutro-500">Sin ingresar</dt>
                    <dd className="font-semibold text-neutro-800">
                      {formatearNumero(jornada.pendientes)}
                    </dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
        </Tarjeta>

        <Tarjeta
          titulo="Refrigerios"
          descripcion="Entregados frente a los posibles en cada jornada"
        >
          {data.refrigerios.length === 0 ? (
            <p className="text-sm text-neutro-600">No hay refrigerios configurados.</p>
          ) : (
            <ul className="space-y-3">
              {data.refrigerios.map((refrigerio) => {
                const total = refrigerio.entregados + refrigerio.pendientes;
                const porcentaje = total > 0 ? (refrigerio.entregados / total) * 100 : 0;
                return (
                  <li key={refrigerio.tipoRefrigerioId}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-neutro-800">{refrigerio.nombre}</p>
                      <p className="text-sm text-neutro-600">
                        {formatearNumero(refrigerio.entregados)} / {formatearNumero(total)}
                      </p>
                    </div>
                    <div className="barra-progreso mt-1.5">
                      <div className="barra-progreso-relleno" style={{ width: `${porcentaje}%` }} />
                    </div>
                    <p className="mt-1 text-xs text-neutro-500">
                      {formatearNumero(refrigerio.pendientes)} pendientes
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </Tarjeta>
      </div>

      <Tarjeta
        titulo="Ritmo de ingreso"
        descripcion="Registros por minuto en la ultima hora"
        accion={
          <span className="flex items-center gap-1.5 text-xs text-neutro-500">
            <TrendingUp className="h-4 w-4" aria-hidden="true" />
            Actualizacion cada 5 segundos
          </span>
        }
      >
        {data.ritmoIngreso.length === 0 ? (
          <p className="text-sm text-neutro-600">Todavia no hay ingresos registrados.</p>
        ) : (
          <div className="flex h-32 items-end gap-1">
            {data.ritmoIngreso.map((punto) => (
              <div
                key={punto.minuto}
                className="flex min-w-[6px] flex-1 flex-col items-center justify-end gap-1"
                title={`${punto.minuto}: ${punto.registros} registros`}
              >
                <div
                  className="w-full rounded-t bg-acento"
                  style={{ height: `${(punto.registros / maximoRitmo) * 100}%` }}
                />
                <span className="sr-only">
                  {punto.minuto}: {punto.registros} registros
                </span>
              </div>
            ))}
          </div>
        )}
      </Tarjeta>
    </div>
  );
}

function Indicador({
  titulo,
  valor,
  detalle,
  Icono,
}: {
  titulo: string;
  valor: string;
  detalle: string;
  Icono: typeof Users;
}) {
  return (
    <div className="ficha-indicador">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-neutro-600">{titulo}</p>
        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-marca-suave text-primario-600">
          <Icono className="h-5 w-5" aria-hidden="true" />
        </span>
      </div>
      <p className={clsx('mt-2 text-3xl font-bold text-neutro-900')}>{valor}</p>
      <p className="mt-0.5 text-xs font-medium text-neutro-500">{detalle}</p>
    </div>
  );
}
