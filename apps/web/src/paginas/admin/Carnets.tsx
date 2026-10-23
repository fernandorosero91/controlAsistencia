import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Download, FileText, Mail, QrCode, Send } from 'lucide-react';
import { api, ErrorPeticion } from '../../lib/api';
import { formatearNumero } from '../../lib/formato';
import { Aviso, EsqueletoTarjeta, Tarjeta } from '../../componentes/comunes';

export function Carnets() {
  const [rol, setRol] = useState<'' | 'estudiante' | 'docente'>('');
  const [descargando, setDescargando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loteId, setLoteId] = useState<string | null>(null);
  const [resultadoEnvio, setResultadoEnvio] = useState<{
    total: number;
    enviados: number;
    fallidos: number;
    resultados?: { asistenteId: string; enviado: boolean; mensaje: string }[];
  } | null>(null);

  const { data, isPending } = useQuery({
    queryKey: ['asistentes', 'carnets', rol],
    queryFn: () =>
      api.obtener<{ total: number }>(`/asistentes?porPagina=1${rol ? `&rol=${rol}` : ''}`),
    staleTime: 60_000,
  });

  const enviarQr = useMutation({
    mutationFn: async () =>
      api.crear<{
        enCola: boolean;
        loteId?: string;
        total: number;
        enviados?: number;
        fallidos?: number;
        sinCorreo?: number;
        correoConfigurado: boolean;
        resultados?: { asistenteId: string; enviado: boolean; mensaje: string }[];
      }>('/asistentes/enviar-qr', { todos: true }),
    onSuccess: (resultado) => {
      setError(null);
      if (resultado.enCola && resultado.loteId) {
        setLoteId(resultado.loteId);
        setResultadoEnvio(null);
        return;
      }
      setLoteId(null);
      setResultadoEnvio({
        total: resultado.total,
        enviados: resultado.enviados ?? 0,
        fallidos: resultado.fallidos ?? 0,
        resultados: resultado.resultados,
      });
    },
    onError: (problema) => {
      setResultadoEnvio(null);
      setLoteId(null);
      setError(
        problema instanceof ErrorPeticion
          ? problema.message
          : 'No se pudo enviar el correo con los codigos de registro',
      );
    },
  });

  // Avance del lote encolado: se consulta cada 2 segundos hasta completarse.
  const avance = useQuery({
    queryKey: ['asistentes', 'envio-qr', loteId],
    queryFn: () =>
      api.obtener<{
        total: number;
        enviados: number;
        fallidos: number;
        pendientes: number;
        estado: 'en_proceso' | 'completado';
      }>(`/asistentes/enviar-qr/lote/${loteId}`),
    enabled: Boolean(loteId),
    refetchInterval: (consulta) =>
      consulta.state.data?.estado === 'completado' ? false : 2000,
  });

  const descargar = async (ruta: string, nombre: string, etiqueta: string) => {
    setDescargando(etiqueta);
    setError(null);
    try {
      const parametros = new URLSearchParams();
      if (rol) parametros.set('rol', rol);
      const archivo = await api.descarga(`${ruta}?${parametros.toString()}`);
      const url = URL.createObjectURL(archivo);
      const enlace = document.createElement('a');
      enlace.href = url;
      enlace.download = nombre;
      document.body.appendChild(enlace);
      enlace.click();
      document.body.removeChild(enlace);
      URL.revokeObjectURL(url);
    } catch {
      setError('No se pudo generar el archivo. Intente de nuevo.');
    } finally {
      setDescargando(null);
    }
  };

  return (
    <div className="space-y-4">
      {error ? <Aviso tono="error">{error}</Aviso> : null}

      <Tarjeta
        titulo="Carnets y escarapelas con QR"
        descripcion="Cada asistente recibe un codigo de registro unico de 6 caracteres que se imprime en su escarapela"
        accion={
          <button
            type="button"
            className="boton-primario"
            onClick={() =>
              void descargar('/asistentes/carnets', 'carnets-asistentes.pdf', 'carnets')
            }
            disabled={descargando !== null}
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            {descargando === 'carnets' ? 'Generando' : 'Descargar carnets'}
          </button>
        }
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label htmlFor="filtro-rol-carnets" className="etiqueta-campo">
              Rol de los asistentes
            </label>
            <select
              id="filtro-rol-carnets"
              className="campo sm:max-w-xs"
              value={rol}
              onChange={(evento) => setRol(evento.target.value as '' | 'estudiante' | 'docente')}
            >
              <option value="">Todos</option>
              <option value="estudiante">Estudiantes</option>
              <option value="docente">Docentes</option>
            </select>
          </div>
          <p className="text-sm text-neutro-600">
            {isPending
              ? 'Contando asistentes...'
              : `${formatearNumero(data?.total ?? 0)} asistentes`}
          </p>
        </div>

        <div className="mt-5">
          <Aviso tono="primario" titulo="Que codifica el QR">
            <span className="flex items-start gap-2">
              <QrCode className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                El QR contiene el codigo de registro de 6 caracteres (por ejemplo{' '}
                <code>K7M4D2</code>), que el operador puede digitar si el escaner falla. La
                escarapela muestra el nombre, el rol y el ID institucional en grande; el codigo no
                se imprime porque ya va dentro del QR.
              </span>
            </span>
          </Aviso>
        </div>
      </Tarjeta>

      <div className="grid gap-4 lg:grid-cols-2">
        <Tarjeta
          titulo="Carta de QR"
          descripcion="Escarapela con el QR, el nombre y el ID institucional"
          accion={
            <button
              type="button"
              className="boton-secundario"
              onClick={() =>
                void descargar('/asistentes/carta-qr', 'carta-qr-asistentes.pdf', 'carta')
              }
              disabled={descargando !== null}
            >
              <FileText className="h-4 w-4" aria-hidden="true" />
              {descargando === 'carta' ? 'Generando' : 'Descargar'}
            </button>
          }
        >
          <p className="text-sm text-neutro-600">
            Util cuando no hay servidor de correo configurado o cuando un asistente no tiene correo
            registrado. Son cuatro escarapelas por hoja, con el logo de la Universidad, el nombre
            del asistente, el rol, el QR con su codigo de registro y los datos de identificacion.
          </p>
        </Tarjeta>

        <Tarjeta
          titulo="Enviar codigo y QR por correo"
          descripcion="Envia a los asistentes con correo registrado su codigo de registro"
          accion={
            <button
              type="button"
              className="boton-primario"
              onClick={() => enviarQr.mutate()}
              disabled={enviarQr.isPending}
            >
              <Send className="h-4 w-4" aria-hidden="true" />
              {enviarQr.isPending ? 'Encolando' : 'Enviar a todos'}
            </button>
          }
        >
          <p className="flex items-start gap-2 text-sm text-neutro-600">
            <Mail className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            El correo incluye el codigo, el QR, las instrucciones de uso y la escarapela adjunta en
            PDF al tamano de la tarjeta. Los envios se encolan: se procesan de a pocos, con
            reintentos si el servidor de correo falla, y la operacion queda auditada.
          </p>

          {loteId ? (
            <div className="mt-4 space-y-2">
              {avance.data ? (
                <>
                  <Aviso
                    tono={
                      avance.data.estado === 'completado'
                        ? avance.data.fallidos === 0
                          ? 'exito'
                          : 'aviso'
                        : 'primario'
                    }
                    titulo={
                      avance.data.estado === 'completado'
                        ? 'Envio terminado'
                        : 'Enviando credenciales'
                    }
                  >
                    {formatearNumero(avance.data.enviados)} enviados de{' '}
                    {formatearNumero(avance.data.total)}.{' '}
                    {avance.data.fallidos > 0
                      ? `${formatearNumero(avance.data.fallidos)} con error (revisar el registro de la API).`
                      : ''}
                    {avance.data.estado === 'en_proceso'
                      ? ` Quedan ${formatearNumero(avance.data.pendientes)} en cola.`
                      : ''}
                  </Aviso>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-neutro-200">
                    <div
                      className="h-full bg-marca transition-all"
                      style={{
                        width: `${
                          avance.data.total > 0
                            ? Math.round(
                                ((avance.data.enviados + avance.data.fallidos) /
                                  avance.data.total) *
                                  100,
                              )
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                </>
              ) : (
                <p className="text-sm text-neutro-600">Preparando el envio...</p>
              )}
            </div>
          ) : null}

          {resultadoEnvio ? (
            <div className="mt-4 space-y-2">
              <Aviso
                tono={resultadoEnvio.fallidos === 0 ? 'exito' : 'aviso'}
                titulo="Envio terminado"
              >
                {formatearNumero(resultadoEnvio.enviados)} correos enviados de{' '}
                {formatearNumero(resultadoEnvio.total)} asistentes.{' '}
                {resultadoEnvio.fallidos > 0
                  ? `${formatearNumero(resultadoEnvio.fallidos)} no pudieron enviarse.`
                  : ''}
              </Aviso>
              {resultadoEnvio.resultados && resultadoEnvio.fallidos > 0 ? (
                <div className="rounded-md border border-aviso-200 bg-aviso-50 p-3 text-xs text-aviso-900">
                  <p className="font-semibold mb-1">Detalle del intento de envio:</p>
                  <ul className="list-disc pl-4 space-y-0.5">
                    {resultadoEnvio.resultados
                      .filter((r) => !r.enviado)
                      .map((r) => (
                        <li key={r.asistenteId}>
                          <span className="font-medium">{r.asistenteId}:</span> {r.mensaje}
                        </li>
                      ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </Tarjeta>
      </div>

      {isPending ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <EsqueletoTarjeta />
          <EsqueletoTarjeta />
          <EsqueletoTarjeta />
        </div>
      ) : null}
    </div>
  );
}
