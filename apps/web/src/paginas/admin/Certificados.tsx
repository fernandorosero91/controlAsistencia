import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, Ban, Download, FileArchive, RefreshCw, Search, Send } from 'lucide-react';
import { api, ErrorPeticion } from '../../lib/api';
import { formatearFechaHora, formatearNumero, nombreRol } from '../../lib/formato';
import {
  Aviso,
  EstadoError,
  Insignia,
  Modal,
  Paginacion,
  Tarjeta,
} from '../../componentes/comunes';
import type { EstadoCertificadoDetalle } from '@seminario/shared';

type Estado = 'elegible' | 'no_elegible' | 'emitido' | 'revocado';

interface RespuestaListado {
  datos: EstadoCertificadoDetalle[];
  pagina: number;
  porPagina: number;
  total: number;
  totalPaginas: number;
}

interface ProgresoLote {
  id: string;
  estado: 'en_proceso' | 'completado' | 'fallido';
  total: number;
  procesados: number;
  exitosos: number;
  fallidos: number;
  porcentaje: number;
  errores: { asistenteId: string; mensaje: string }[];
  iniciadoAt: string;
  finalizadoAt: string | null;
}

const ETIQUETAS: Record<Estado, { texto: string; tono: 'exito' | 'aviso' | 'error' | 'neutro' }> = {
  elegible: { texto: 'Elegible', tono: 'exito' },
  no_elegible: { texto: 'No elegible', tono: 'neutro' },
  emitido: { texto: 'Emitido', tono: 'primario' as 'exito' },
  revocado: { texto: 'Revocado', tono: 'error' },
};

export function Certificados() {
  const cliente = useQueryClient();
  const [estado, setEstado] = useState<'' | Estado>('');
  const [rol, setRol] = useState<'' | 'estudiante' | 'docente'>('');
  const [consulta, setConsulta] = useState('');
  const [busquedaAplicada, setBusquedaAplicada] = useState('');
  const [pagina, setPagina] = useState(1);
  const [loteId, setLoteId] = useState<string | null>(null);
  const [excepcion, setExcepcion] = useState<EstadoCertificadoDetalle | null>(null);
  const [revocar, setRevocar] = useState<EstadoCertificadoDetalle | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, isError, refetch } = useQuery({
    queryKey: ['certificados', pagina, estado, rol, busquedaAplicada],
    queryFn: () => {
      const parametros = new URLSearchParams({ pagina: String(pagina), porPagina: '25' });
      if (estado) parametros.set('estado', estado);
      if (rol) parametros.set('rol', rol);
      if (busquedaAplicada) parametros.set('q', busquedaAplicada);
      return api.obtener<RespuestaListado>(`/certificados?${parametros.toString()}`);
    },
  });

  const { data: progreso } = useQuery({
    queryKey: ['certificados', 'lote', loteId],
    queryFn: () => api.obtener<ProgresoLote>(`/certificados/lote/${loteId}`),
    enabled: loteId !== null,
    refetchInterval: (consulta) => (consulta.state.data?.estado === 'en_proceso' ? 1500 : false),
  });

  const emitir = useMutation({
    mutationFn: async (datos: { asistenteId: string; excepcionManual: boolean; motivo?: string }) =>
      api.crear<{ codigoVerificacion: string }>(`/certificados/emitir/${datos.asistenteId}`, {
        excepcionManual: datos.excepcionManual,
        motivo: datos.motivo,
      }),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['certificados'] });
      setExcepcion(null);
      setError(null);
    },
    onError: (problema) => {
      setError(
        problema instanceof ErrorPeticion ? problema.message : 'No se pudo emitir el certificado',
      );
    },
  });

  const emitirLote = useMutation({
    mutationFn: async () =>
      api.crear<{ loteId: string; total: number }>('/certificados/emitir-lote', {
        soloElegibles: true,
      }),
    onSuccess: (respuesta) => {
      setLoteId(respuesta.loteId);
      setError(null);
    },
    onError: (problema) => {
      setError(
        problema instanceof ErrorPeticion
          ? problema.message
          : 'No se pudo iniciar la emision masiva',
      );
    },
  });

  const revocarCertificado = useMutation({
    mutationFn: async (datos: { id: string; motivo: string }) =>
      api.crear<{ revocado: boolean }>(`/certificados/${datos.id}/revocar`, {
        motivo: datos.motivo,
      }),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['certificados'] });
      setRevocar(null);
      setError(null);
    },
    onError: (problema) => {
      setError(
        problema instanceof ErrorPeticion ? problema.message : 'No se pudo revocar el certificado',
      );
    },
  });

  const descargar = async (ruta: string, nombre: string) => {
    setError(null);
    try {
      const archivo = await api.descarga(ruta);
      const url = URL.createObjectURL(archivo);
      const enlace = document.createElement('a');
      enlace.href = url;
      enlace.download = nombre;
      document.body.appendChild(enlace);
      enlace.click();
      document.body.removeChild(enlace);
      URL.revokeObjectURL(url);
    } catch {
      setError('No se pudo descargar el archivo solicitado.');
    }
  };

  return (
    <div className="space-y-4">
      <Aviso tono="primario" titulo="El certificado oficial se genera en Word">
        Este modulo emite la <strong>copia verificable en PDF</strong>, con codigo y QR de
        verificacion publica. El documento oficial de la Universidad se descarga en{' '}
        <strong>Certificados (Word)</strong>. Ambos usan la misma regla: 4 marcas (ingreso y salida
        en cada jornada), permanencia minima y cierre del seminario.
      </Aviso>

      <Tarjeta
        titulo="Certificados PDF (copia verificable)"
        descripcion="Emision individual y masiva. Solo el administrador puede emitir y descargar"
        accion={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="boton-secundario"
              onClick={() => void refetch()}
              aria-label="Actualizar la lista"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="boton-primario"
              onClick={() => emitirLote.mutate()}
              disabled={emitirLote.isPending}
            >
              <Send className="h-4 w-4" aria-hidden="true" />
              {emitirLote.isPending ? 'Iniciando' : 'Emitir en lote'}
            </button>
          </div>
        }
      >
        {error ? (
          <div className="mb-4">
            <Aviso tono="error">{error}</Aviso>
          </div>
        ) : null}

        {loteId ? (
          <div className="mb-4">
            <Aviso tono="primario" titulo="Emision masiva en curso">
              <div className="mt-2">
                <div className="flex items-center justify-between text-sm">
                  <span>
                    {formatearNumero(progreso?.procesados ?? 0)} de{' '}
                    {formatearNumero(progreso?.total ?? 0)} procesados
                  </span>
                  <span className="font-semibold">{progreso?.porcentaje ?? 0}%</span>
                </div>
                <div
                  className="barra-progreso mt-1.5"
                  role="progressbar"
                  aria-valuenow={progreso?.porcentaje ?? 0}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className="barra-progreso-relleno"
                    style={{ width: `${progreso?.porcentaje ?? 0}%` }}
                  />
                </div>
                {progreso?.estado === 'completado' ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <p className="text-sm text-neutro-700">
                      {formatearNumero(progreso.exitosos)} emitidos,{' '}
                      {formatearNumero(progreso.fallidos)} con error.
                    </p>
                    <button
                      type="button"
                      className="boton-compacto border border-primario-300 bg-white text-primario-700"
                      onClick={() =>
                        void descargar(
                          `/certificados/lote/${loteId}/descarga`,
                          `certificados-lote-${loteId}.zip`,
                        )
                      }
                    >
                      <FileArchive className="h-4 w-4" aria-hidden="true" />
                      Descargar ZIP
                    </button>
                    <button
                      type="button"
                      className="boton-compacto text-neutro-600 hover:bg-neutro-100"
                      onClick={() => setLoteId(null)}
                    >
                      Cerrar
                    </button>
                  </div>
                ) : null}
                {(progreso?.errores.length ?? 0) > 0 ? (
                  <ul className="mt-2 space-y-1 text-xs text-error-700">
                    {progreso!.errores.slice(0, 5).map((detalle) => (
                      <li key={detalle.asistenteId}>
                        {detalle.asistenteId}: {detalle.mensaje}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </Aviso>
          </div>
        ) : null}

        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(evento) => {
            evento.preventDefault();
            setBusquedaAplicada(consulta.trim());
            setPagina(1);
          }}
        >
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutro-400"
              aria-hidden="true"
            />
            <input
              className="campo pl-9"
              value={consulta}
              onChange={(evento) => setConsulta(evento.target.value)}
              placeholder="Buscar por nombre o ID"
              aria-label="Buscar asistentes"
            />
          </div>
          <select
            className="campo sm:w-48"
            value={estado}
            onChange={(evento) => {
              setEstado(evento.target.value as '' | Estado);
              setPagina(1);
            }}
            aria-label="Filtrar por estado"
          >
            <option value="">Todos los estados</option>
            <option value="elegible">Elegibles</option>
            <option value="no_elegible">No elegibles</option>
            <option value="emitido">Emitidos</option>
            <option value="revocado">Revocados</option>
          </select>
          <select
            className="campo sm:w-44"
            value={rol}
            onChange={(evento) => {
              setRol(evento.target.value as '' | 'estudiante' | 'docente');
              setPagina(1);
            }}
            aria-label="Filtrar por rol"
          >
            <option value="">Todos los roles</option>
            <option value="estudiante">Estudiantes</option>
            <option value="docente">Docentes</option>
          </select>
          <button type="submit" className="boton-secundario">
            Filtrar
          </button>
        </form>

        {isError ? (
          <div className="mt-4">
            <EstadoError alReintentar={() => void refetch()} />
          </div>
        ) : null}

        <div className="mt-4 overflow-x-auto sin-barra-espacial">
          <table className="tabla hidden md:table">
            <thead className="tabla-cabecera">
              <tr>
                <th scope="col">ID</th>
                <th scope="col">Nombre</th>
                <th scope="col">Rol</th>
                <th scope="col">Estado</th>
                <th scope="col">Motivo</th>
                <th scope="col" className="text-right">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody className="tabla-cuerpo">
              {(data?.datos ?? []).map((fila) => (
                <tr key={fila.asistenteId}>
                  <td className="font-mono">{fila.asistenteIdInstitucional}</td>
                  <td>
                    <span className="block text-neutro-900">{fila.asistenteNombre}</span>
                    {fila.codigoVerificacion ? (
                      <span className="font-mono text-xs text-neutro-500">
                        {fila.codigoVerificacion}
                      </span>
                    ) : null}
                  </td>
                  <td>{nombreRol(fila.rol)}</td>
                  <td>
                    <Insignia tono={ETIQUETAS[fila.estado].tono}>
                      {ETIQUETAS[fila.estado].texto}
                    </Insignia>
                    {fila.excepcionManual ? (
                      <span className="ml-1">
                        <Insignia tono="aviso">Excepcion</Insignia>
                      </span>
                    ) : null}
                  </td>
                  <td className="max-w-[16rem] text-xs text-neutro-600">
                    {fila.motivos.length > 0 ? fila.motivos.join(', ') : '-'}
                  </td>
                  <td className="text-right">
                    <div className="flex justify-end gap-1">
                      {fila.estado === 'elegible' ? (
                        <button
                          type="button"
                          className="boton-compacto text-primario-700 hover:bg-primario-50"
                          onClick={() =>
                            emitir.mutate({ asistenteId: fila.asistenteId, excepcionManual: false })
                          }
                          aria-label={`Emitir certificado a ${fila.asistenteNombre}`}
                        >
                          <Award className="h-4 w-4" aria-hidden="true" />
                          Emitir
                        </button>
                      ) : null}
                      {fila.estado === 'no_elegible' ? (
                        <button
                          type="button"
                          className="boton-compacto text-aviso-700 hover:bg-aviso-100"
                          onClick={() => setExcepcion(fila)}
                          aria-label={`Emitir con excepcion a ${fila.asistenteNombre}`}
                        >
                          <Send className="h-4 w-4" aria-hidden="true" />
                          Excepcion
                        </button>
                      ) : null}
                      {fila.estado === 'emitido' ? (
                        <>
                          <button
                            type="button"
                            className="boton-compacto text-neutro-700 hover:bg-neutro-100"
                            onClick={() =>
                              void descargar(
                                `/certificados/${fila.asistenteId}/pdf`,
                                `certificado-${fila.asistenteIdInstitucional}.pdf`,
                              )
                            }
                            aria-label={`Descargar certificado de ${fila.asistenteNombre}`}
                          >
                            <Download className="h-4 w-4" aria-hidden="true" />
                            PDF
                          </button>
                          <button
                            type="button"
                            className="boton-compacto text-error-600 hover:bg-error-100"
                            onClick={() => setRevocar(fila)}
                            aria-label={`Revocar certificado de ${fila.asistenteNombre}`}
                          >
                            <Ban className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Vista de tarjetas para pantallas pequenas */}
          <ul className="space-y-2 md:hidden">
            {(data?.datos ?? []).map((fila) => (
              <li key={fila.asistenteId} className="rounded-2xl bg-neutro-50 p-3.5">
                <p className="text-sm font-bold text-neutro-900">{fila.asistenteNombre}</p>
                <p className="font-mono text-xs text-neutro-600">
                  {fila.asistenteIdInstitucional}
                  {fila.codigoVerificacion ? ` - ${fila.codigoVerificacion}` : ''}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Insignia tono={ETIQUETAS[fila.estado].tono}>
                    {ETIQUETAS[fila.estado].texto}
                  </Insignia>
                  <Insignia tono="neutro">{nombreRol(fila.rol)}</Insignia>
                  {fila.excepcionManual ? <Insignia tono="aviso">Excepcion</Insignia> : null}
                </div>
                {fila.motivos.length > 0 ? (
                  <p className="mt-2 text-xs text-neutro-600">{fila.motivos.join(', ')}</p>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  {fila.estado === 'elegible' ? (
                    <button
                      type="button"
                      className="boton-compacto bg-marca text-white shadow-marca"
                      aria-label={`Emitir certificado a ${fila.asistenteNombre}`}
                      onClick={() =>
                        emitir.mutate({ asistenteId: fila.asistenteId, excepcionManual: false })
                      }
                    >
                      <Award className="h-4 w-4" aria-hidden="true" />
                      Emitir
                    </button>
                  ) : null}
                  {fila.estado === 'no_elegible' ? (
                    <button
                      type="button"
                      className="boton-compacto bg-aviso-100 text-aviso-700"
                      aria-label={`Emitir con excepcion a ${fila.asistenteNombre}`}
                      onClick={() => setExcepcion(fila)}
                    >
                      <Send className="h-4 w-4" aria-hidden="true" />
                      Excepcion
                    </button>
                  ) : null}
                  {fila.estado === 'emitido' ? (
                    <>
                      <button
                        type="button"
                        className="boton-compacto bg-white text-neutro-700 shadow-tarjeta"
                        aria-label={`Descargar certificado de ${fila.asistenteNombre}`}
                        onClick={() =>
                          void descargar(
                            `/certificados/${fila.asistenteId}/pdf`,
                            `certificado-${fila.asistenteIdInstitucional}.pdf`,
                          )
                        }
                      >
                        <Download className="h-4 w-4" aria-hidden="true" />
                        PDF
                      </button>
                      <button
                        type="button"
                        className="boton-compacto bg-error-100 text-error-700"
                        aria-label={`Revocar certificado de ${fila.asistenteNombre}`}
                        onClick={() => setRevocar(fila)}
                      >
                        <Ban className="h-4 w-4" aria-hidden="true" />
                        Revocar
                      </button>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>

          {data && data.datos.length === 0 ? (
            <p className="py-8 text-center text-sm text-neutro-600">
              No hay asistentes que coincidan con el filtro.
            </p>
          ) : null}
        </div>

        {data ? (
          <Paginacion
            pagina={data.pagina}
            totalPaginas={data.totalPaginas}
            total={data.total}
            alCambiar={setPagina}
          />
        ) : null}
      </Tarjeta>

      <Modal
        abierto={excepcion !== null}
        titulo="Emitir con excepcion manual"
        alCerrar={() => setExcepcion(null)}
        pie={
          <div className="flex justify-end gap-2">
            <button type="button" className="boton-secundario" onClick={() => setExcepcion(null)}>
              Cancelar
            </button>
            <button
              type="button"
              className="boton-primario"
              onClick={() => {
                const motivo = document.getElementById('motivo-excepcion');
                if (!excepcion || !(motivo instanceof HTMLTextAreaElement)) return;
                emitir.mutate({
                  asistenteId: excepcion.asistenteId,
                  excepcionManual: true,
                  motivo: motivo.value,
                });
              }}
              disabled={emitir.isPending}
            >
              Emitir certificado
            </button>
          </div>
        }
      >
        <Aviso tono="aviso" titulo="Excepcion manual">
          <p>
            {excepcion?.asistenteNombre} ({excepcion?.asistenteIdInstitucional}) no cumple los
            requisitos de elegibilidad. La emision queda registrada en la auditoria con el motivo
            que indique a continuacion.
          </p>
          {excepcion && excepcion.motivos.length > 0 ? (
            <p className="mt-1 text-xs">Motivos: {excepcion.motivos.join(', ')}</p>
          ) : null}
        </Aviso>
        <label htmlFor="motivo-excepcion" className="etiqueta-campo mt-4">
          Motivo obligatorio (minimo 10 caracteres)
        </label>
        <textarea
          id="motivo-excepcion"
          className="campo min-h-[100px]"
          placeholder="Ej: Participacion verificada por la coordinacion academica"
          minLength={10}
        />
      </Modal>

      <Modal
        abierto={revocar !== null}
        titulo="Revocar certificado"
        alCerrar={() => setRevocar(null)}
        pie={
          <div className="flex justify-end gap-2">
            <button type="button" className="boton-secundario" onClick={() => setRevocar(null)}>
              Cancelar
            </button>
            <button
              type="button"
              className="boton-peligro"
              onClick={() => {
                const motivo = document.getElementById('motivo-revocacion');
                if (!revocar || !(motivo instanceof HTMLTextAreaElement)) return;
                revocarCertificado.mutate({
                  id: revocar.certificadoId ?? '',
                  motivo: motivo.value,
                });
              }}
              disabled={revocarCertificado.isPending}
            >
              Revocar
            </button>
          </div>
        }
      >
        <p className="text-sm text-neutro-700">
          Al revocar el certificado de {revocar?.asistenteNombre}, la verificacion publica mostrara
          que no es valido. La accion queda auditada.
        </p>
        <label htmlFor="motivo-revocacion" className="etiqueta-campo mt-4">
          Motivo obligatorio (minimo 10 caracteres)
        </label>
        <textarea
          id="motivo-revocacion"
          className="campo min-h-[100px]"
          placeholder="Ej: Error en el registro de asistencia"
          minLength={10}
        />
      </Modal>

      <p className="text-xs text-neutro-500">
        Ultima actualizacion de la lista: {formatearFechaHora(new Date().toISOString())}
      </p>
    </div>
  );
}
