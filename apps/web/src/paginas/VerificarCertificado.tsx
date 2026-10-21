import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { CheckCircle2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';
import { formatearFechaHora, nombreRol } from '../lib/formato';
import { Esqueleto } from '../componentes/comunes';

interface RespuestaVerificacion {
  valido: boolean;
  nombre: string | null;
  rol: string | null;
  seminario: string | null;
  fechaEmision: string | null;
  intensidadHoraria: number | null;
  estado: string | null;
}

export function VerificarCertificado() {
  const { codigo } = useParams<{ codigo: string }>();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['publico', 'verificar', codigo],
    queryFn: () =>
      api.obtener<RespuestaVerificacion>(`/publico/verificar/${encodeURIComponent(codigo ?? '')}`),
    enabled: Boolean(codigo),
    retry: false,
  });

  return (
    <div className="flex min-h-dvh flex-col bg-primario-50 px-4 py-10">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <img
            src="/logo-ucc.svg"
            alt="Universidad Cooperativa de Colombia"
            className="h-9 w-auto"
          />
          <div>
            <h1 className="text-lg font-bold text-primario-900">Verificacion de certificados</h1>
            <p className="text-sm text-neutro-600">
              Confirme la autenticidad de un certificado del seminario
            </p>
          </div>
        </div>

        <div className="superficie p-5">
          {isLoading ? (
            <div className="space-y-3">
              <Esqueleto className="h-5 w-1/2" />
              <Esqueleto className="h-4 w-full" />
              <Esqueleto className="h-4 w-4/5" />
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center" role="alert">
              <ShieldAlert className="h-9 w-9 text-error-600" aria-hidden="true" />
              <p className="text-base font-semibold text-neutro-900">
                No se pudo consultar el certificado
              </p>
              <p className="text-sm text-neutro-600">
                Revise el codigo e intente de nuevo en unos minutos.
              </p>
            </div>
          ) : data?.valido ? (
            <div>
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="h-7 w-7 text-exito-600" aria-hidden="true" />
                <div>
                  <p className="text-lg font-bold text-exito-700">Certificado autentico</p>
                  <p className="text-sm text-neutro-600">
                    Emitido y vigente ante el sistema del seminario
                  </p>
                </div>
              </div>

              <dl className="mt-5 space-y-3 text-sm">
                <div>
                  <dt className="font-medium text-neutro-600">Titular</dt>
                  <dd className="text-base font-semibold text-neutro-900">{data.nombre}</dd>
                </div>
                <div>
                  <dt className="font-medium text-neutro-600">Rol</dt>
                  <dd className="text-neutro-900">
                    {nombreRol(data.rol as 'estudiante' | 'docente' | null)}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium text-neutro-600">Seminario</dt>
                  <dd className="text-neutro-900">{data.seminario}</dd>
                </div>
                <div>
                  <dt className="font-medium text-neutro-600">Intensidad horaria</dt>
                  <dd className="text-neutro-900">{data.intensidadHoraria} horas</dd>
                </div>
                <div>
                  <dt className="font-medium text-neutro-600">Fecha de emision</dt>
                  <dd className="text-neutro-900">{formatearFechaHora(data.fechaEmision)}</dd>
                </div>
              </dl>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 py-6 text-center" role="alert">
              <ShieldAlert className="h-9 w-9 text-error-600" aria-hidden="true" />
              <p className="text-lg font-bold text-error-700">Certificado no valido</p>
              <p className="text-sm text-neutro-600">
                El codigo no corresponde a un certificado emitido, o el certificado fue revocado.
              </p>
            </div>
          )}
        </div>

        <p className="mt-6 flex items-center justify-center gap-2 text-xs text-neutro-500">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          Consulta publica. No se muestran datos distintos a los del certificado.
        </p>
      </div>
    </div>
  );
}
