import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileArchive,
  FileText,
  Star,
  Trash2,
  Upload,
  Users,
} from 'lucide-react';
import {
  CAMPOS_PLANTILLA,
  DESCRIPCION_CAMPO_PLANTILLA,
  type ListadoElegibilidad,
  type LoteCertificados,
  type MarcasElegibilidad,
  type PlantillaCertificado,
  type ResumenGeneracion,
} from '@seminario/shared';
import { api, ErrorPeticion } from '../../lib/api';
import { formatearFechaHora, formatearNumero } from '../../lib/formato';
import { Aviso, EsqueletoTarjeta, EstadoVacio, Insignia, Modal, Tarjeta } from '../../componentes/comunes';

interface RespuestaListado {
  datos: PlantillaCertificado[];
  total: number;
}

interface RespuestaGeneracion {
  lote: LoteCertificados;
  resumen: ResumenGeneracion;
}

interface RespuestaLotes {
  datos: LoteCertificados[];
  total: number;
}

const ETIQUETA_CAMPO: Record<string, string> = {
  nombre: 'Nombre completo',
  cedula: 'Cedula',
  id: 'ID institucional',
  rol: 'Rol',
  semestre: 'Semestre',
};

export function CrearCertificados() {
  const cliente = useQueryClient();
  const referenciaArchivo = useRef<HTMLInputElement | null>(null);

  const [nombrePlantilla, setNombrePlantilla] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResumenGeneracion | null>(null);
  const [generarCon, setGenerarCon] = useState<PlantillaCertificado | null>(null);
  const [rolSeleccion, setRolSeleccion] = useState<'' | 'estudiante' | 'docente'>('');
  const [excepcion, setExcepcion] = useState(false);
  const [motivoExcepcion, setMotivoExcepcion] = useState('');
  const [eliminar, setEliminar] = useState<PlantillaCertificado | null>(null);
  const [eliminarLote, setEliminarLote] = useState<LoteCertificados | null>(null);
  const [verElegibilidad, setVerElegibilidad] = useState(false);

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['plantillas-certificado'],
    queryFn: () => api.obtener<RespuestaListado>('/plantillas-certificado'),
  });

  const lotes = useQuery({
    queryKey: ['plantillas-certificado', 'lotes'],
    queryFn: () => api.obtener<RespuestaLotes>('/plantillas-certificado/lotes'),
  });

  const elegibilidad = useQuery({
    queryKey: ['plantillas-certificado', 'elegibilidad', rolSeleccion],
    queryFn: () =>
      api.obtener<ListadoElegibilidad>(
        `/plantillas-certificado/elegibilidad${rolSeleccion ? `?rol=${rolSeleccion}` : ''}`,
      ),
    enabled: verElegibilidad,
  });

  const subir = useMutation({
    mutationFn: async (archivo: File) => {
      const datos = new FormData();
      datos.append('archivo', archivo);
      if (nombrePlantilla.trim().length >= 3) datos.append('nombre', nombrePlantilla.trim());
      return api.enviar<PlantillaCertificado>('/plantillas-certificado', datos, {
        reintentar: false,
      });
    },
    onSuccess: (plantilla) => {
      void cliente.invalidateQueries({ queryKey: ['plantillas-certificado'] });
      setNombrePlantilla('');
      setError(null);
      setMensaje(
        `Plantilla "${plantilla.nombre}" cargada. Campos detectados: ${
          plantilla.camposDetectados.length > 0
            ? plantilla.camposDetectados.map((campo) => ETIQUETA_CAMPO[campo] ?? campo).join(', ')
            : 'ninguno'
        }.`,
      );
      if (referenciaArchivo.current) referenciaArchivo.current.value = '';
    },
    onError: (problema) => {
      setMensaje(null);
      setError(
        problema instanceof ErrorPeticion
          ? problema.message
          : 'No se pudo cargar la plantilla. Verifique que sea un archivo .docx valido.',
      );
    },
  });

  const actualizar = useMutation({
    mutationFn: async (entrada: {
      id: string;
      nombre?: string;
      esPredeterminada?: boolean;
      activa?: boolean;
    }) => {
      const { id, ...cambios } = entrada;
      return api.actualizar<PlantillaCertificado>(`/plantillas-certificado/${id}`, cambios);
    },
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['plantillas-certificado'] });
      setError(null);
    },
    onError: (problema) => {
      setError(
        problema instanceof ErrorPeticion ? problema.message : 'No se pudo actualizar la plantilla',
      );
    },
  });

  const borrar = useMutation({
    mutationFn: async (id: string) => api.eliminar(`/plantillas-certificado/${id}`),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['plantillas-certificado'] });
      setEliminar(null);
      setError(null);
    },
    onError: (problema) => {
      setError(
        problema instanceof ErrorPeticion ? problema.message : 'No se pudo eliminar la plantilla',
      );
    },
  });

  const generar = useMutation({
    mutationFn: async (plantilla: PlantillaCertificado) =>
      api.crear<RespuestaGeneracion>('/plantillas-certificado/generar', {
        plantillaId: plantilla.id,
        todos: true,
        rol: rolSeleccion || undefined,
        soloElegibles: !excepcion,
        motivoExcepcion: excepcion ? motivoExcepcion.trim() : undefined,
      }),
    onSuccess: ({ resumen }) => {
      setResultado(resumen);
      setError(null);
      setMensaje(
        `Certificados generados: ${resumen.generados} de ${resumen.total}. ${
          resumen.omitidos > 0
            ? `${resumen.omitidos} omitidos por no tener las 4 marcas (ingreso y salida en cada jornada).`
            : ''
        }${excepcion ? ' Se aplico la excepcion del administrador y quedo registrada en la auditoria.' : ''}`,
      );
      setGenerarCon(null);
      setExcepcion(false);
      setMotivoExcepcion('');
      void cliente.invalidateQueries({ queryKey: ['plantillas-certificado', 'lotes'] });
    },
    onError: (problema) => {
      setResultado(null);
      setError(
        problema instanceof ErrorPeticion
          ? problema.message
          : 'No se pudieron generar los certificados',
      );
    },
  });

  const descargarLote = useMutation({
    mutationFn: async (lote: LoteCertificados) =>
      api.descarga(`/plantillas-certificado/lotes/${lote.id}/descarga`),
    onSuccess: (archivo) => {
      const url = URL.createObjectURL(archivo);
      const enlace = document.createElement('a');
      enlace.href = url;
      enlace.download = 'certificadosGenerados.zip';
      document.body.appendChild(enlace);
      enlace.click();
      document.body.removeChild(enlace);
      URL.revokeObjectURL(url);
    },
    onError: (problema) => {
      setError(
        problema instanceof ErrorPeticion ? problema.message : 'No se pudo descargar el ZIP',
      );
    },
  });

  const borrarLote = useMutation({
    mutationFn: async (id: string) => api.eliminar(`/plantillas-certificado/lotes/${id}`),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['plantillas-certificado', 'lotes'] });
      setEliminarLote(null);
    },
    onError: (problema) => {
      setError(
        problema instanceof ErrorPeticion ? problema.message : 'No se pudo eliminar el lote',
      );
    },
  });

  const plantillas = data?.datos ?? [];
  const listadoLotes = lotes.data?.datos ?? [];

  return (
    <div className="space-y-4">
      {error ? <Aviso tono="error" titulo="No fue posible completar la accion">{error}</Aviso> : null}
      {mensaje ? <Aviso tono="exito">{mensaje}</Aviso> : null}

      <Aviso tono="primario" titulo="Como se habilita un certificado">
        El certificado oficial de la Universidad se genera en <strong>Word</strong>. Solo se genera
        el de los asistentes con las <strong>4 marcas</strong> (ingreso y salida de la manana y de
        la tarde), que hayan permanecido el <strong>minimo de horas</strong> en cada jornada y
        esten hasta el cierre del seminario. Quien no cumpla queda omitido y se muestra el motivo.
      </Aviso>

      <Tarjeta
        titulo="Certificados oficiales en Word"
        descripcion="Formato .docx de la Universidad: suba la plantilla y genere los certificados del padron"
      >
        <Aviso tono="primario" titulo="Como marcar los campos en la plantilla">
          <p>En el documento de Word escriba los datos del titular entre dobles llaves, por ejemplo:</p>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            {CAMPOS_PLANTILLA.map((campo) => (
              <li key={campo} className="flex items-start gap-2">
                <code className="rounded bg-white px-1.5 py-0.5 font-mono text-xs text-primario-700">
                  {`{{${campo}}}`}
                </code>
                <span className="text-xs">{DESCRIPCION_CAMPO_PLANTILLA[campo]}</span>
              </li>
            ))}
          </ul>
        </Aviso>

        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <label htmlFor="nombre-plantilla" className="etiqueta-campo">
              Nombre de la plantilla (opcional)
            </label>
            <input
              id="nombre-plantilla"
              className="campo"
              value={nombrePlantilla}
              onChange={(evento) => setNombrePlantilla(evento.target.value)}
              placeholder="Ej: Certificado de asistencia - estudiantes"
              maxLength={120}
            />
          </div>
          <input
            ref={referenciaArchivo}
            type="file"
            accept=".docx"
            className="sr-only"
            id="archivo-plantilla"
            onChange={(evento) => {
              const archivo = evento.target.files?.[0];
              if (archivo) subir.mutate(archivo);
            }}
          />
          <label
            htmlFor="archivo-plantilla"
            className="boton-primario inline-flex cursor-pointer"
            aria-disabled={subir.isPending}
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            {subir.isPending ? 'Cargando' : 'Subir plantilla .docx'}
          </label>
        </div>
      </Tarjeta>

      <Tarjeta
        titulo="Plantillas cargadas"
        descripcion="La plantilla predeterminada se usa cuando no se indica otra"
        accion={
          <button type="button" className="boton-secundario" onClick={() => void refetch()}>
            Actualizar
          </button>
        }
      >
        {isPending ? (
          <EsqueletoTarjeta lineas={4} />
        ) : isError ? (
          <Aviso tono="error">No se pudieron cargar las plantillas. Intente de nuevo.</Aviso>
        ) : plantillas.length === 0 ? (
          <EstadoVacio
            titulo="Sin plantillas"
            descripcion="Cargue una plantilla .docx para empezar a generar certificados."
          />
        ) : (
          <ul className="space-y-2">
            {plantillas.map((plantilla) => (
              <li
                key={plantilla.id}
                className="flex flex-col gap-3 rounded-2xl border border-neutro-200 bg-white p-3.5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-semibold text-neutro-900">
                    <FileText className="h-4 w-4 shrink-0 text-primario-700" aria-hidden="true" />
                    {plantilla.nombre}
                    {plantilla.esPredeterminada ? (
                      <Insignia tono="primario">Predeterminada</Insignia>
                    ) : null}
                    {!plantilla.activa ? <Insignia tono="neutro">Inactiva</Insignia> : null}
                  </p>
                  <p className="mt-0.5 text-xs text-neutro-600">
                    {plantilla.nombreArchivo ?? 'plantilla.docx'} -{' '}
                    {formatearNumero(plantilla.tamanoBytes ?? 0)} bytes -{' '}
                    {formatearFechaHora(plantilla.createdAt)}
                  </p>
                  <p className="mt-1 flex flex-wrap gap-1 text-xs">
                    {plantilla.camposDetectados.length > 0 ? (
                      plantilla.camposDetectados.map((campo) => (
                        <span
                          key={campo}
                          className="rounded bg-primario-50 px-1.5 py-0.5 font-mono text-primario-700"
                        >
                          {`{{${campo}}}`}
                        </span>
                      ))
                    ) : (
                      <span className="text-aviso-700">
                        No se detectaron campos: revise que la plantilla use {'{{nombre}}'} y{' '}
                        {'{{cedula}}'}
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!plantilla.esPredeterminada ? (
                    <button
                      type="button"
                      className="boton-compacto text-primario-700 hover:bg-primario-50"
                      onClick={() =>
                        actualizar.mutate({ id: plantilla.id, esPredeterminada: true })
                      }
                    >
                      <Star className="h-4 w-4" aria-hidden="true" />
                      Predeterminar
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="boton-compacto bg-marca text-white shadow-marca"
                    onClick={() => {
                      setGenerarCon(plantilla);
                      setResultado(null);
                      setExcepcion(false);
                      setMotivoExcepcion('');
                    }}
                  >
                    <Users className="h-4 w-4" aria-hidden="true" />
                    Generar certificados
                  </button>
                  <button
                    type="button"
                    className="boton-compacto text-error-600 hover:bg-error-100"
                    onClick={() => setEliminar(plantilla)}
                    aria-label={`Eliminar plantilla ${plantilla.nombre}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Tarjeta>

      {resultado ? (
        <Tarjeta titulo="Resultado de la generacion">
          <dl className="grid grid-cols-3 gap-3">
            <Metrica titulo="Total evaluados" valor={resultado.total} />
            <Metrica titulo="Generados" valor={resultado.generados} tono="exito" />
            <Metrica
              titulo="Omitidos"
              valor={resultado.omitidos}
              tono={resultado.omitidos > 0 ? 'error' : 'neutro'}
            />
          </dl>
          <div className="mt-3">
            <button
              type="button"
              className="boton-secundario"
              onClick={() => setVerElegibilidad((valor) => !valor)}
            >
              {verElegibilidad ? 'Ocultar' : 'Ver'} detalle de elegibilidad
            </button>
          </div>
          {verElegibilidad ? (
            <ListaElegibilidad
              datos={resultado.elegibilidad}
              cargando={elegibilidad.isPending && resultado.elegibilidad.length === 0}
              oficial={elegibilidad.data}
            />
          ) : null}
        </Tarjeta>
      ) : null}

      <Tarjeta
        titulo="Certificados generados"
        descripcion="Lotes guardados en la carpeta certificadosGenerados. Descargue el ZIP del lote."
        accion={
          <button
            type="button"
            className="boton-secundario"
            onClick={() => void lotes.refetch()}
          >
            Actualizar
          </button>
        }
      >
        {lotes.isPending ? (
          <EsqueletoTarjeta lineas={3} />
        ) : listadoLotes.length === 0 ? (
          <EstadoVacio
            titulo="Aun no hay certificados generados"
            descripcion="Al generar un lote aparecera aqui con su boton de descarga."
            icono={<FileArchive className="h-6 w-6" aria-hidden="true" />}
          />
        ) : (
          <ul className="space-y-2">
            {listadoLotes.map((lote) => (
              <li
                key={lote.id}
                className="flex flex-col gap-3 rounded-2xl border border-neutro-200 bg-white p-3.5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-semibold text-neutro-900">
                    <FileArchive className="h-4 w-4 shrink-0 text-primario-700" aria-hidden="true" />
                    {lote.nombrePlantilla}
                  </p>
                  <p className="mt-0.5 text-xs text-neutro-600">
                    {formatearFechaHora(lote.createdAt)} - {formatearNumero(lote.generados)} certificados
                    {lote.omitidos > 0 ? ` - ${formatearNumero(lote.omitidos)} omitidos` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="boton-compacto bg-marca text-white shadow-marca"
                    onClick={() => descargarLote.mutate(lote)}
                    disabled={descargarLote.isPending}
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                    Descargar ZIP
                  </button>
                  <button
                    type="button"
                    className="boton-compacto text-error-600 hover:bg-error-100"
                    onClick={() => setEliminarLote(lote)}
                    aria-label={`Eliminar lote ${lote.id}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Tarjeta>

      <Modal
        abierto={generarCon !== null}
        titulo="Generar certificados"
        alCerrar={() => setGenerarCon(null)}
        pie={
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className="boton-secundario" onClick={() => setGenerarCon(null)}>
              Cancelar
            </button>
            <button
              type="button"
              className="boton-primario"
              onClick={() => {
                if (generarCon) generar.mutate(generarCon);
              }}
              disabled={generar.isPending || (excepcion && motivoExcepcion.trim().length < 10)}
            >
              <FileText className="h-4 w-4" aria-hidden="true" />
              {generar.isPending ? 'Generando' : 'Generar certificados .docx'}
            </button>
          </div>
        }
      >
        <p className="text-sm text-neutro-700">
          Plantilla: <span className="font-semibold">{generarCon?.nombre}</span>
        </p>
        <div className="mt-4 space-y-3">
          <div>
            <label htmlFor="rol-generar" className="etiqueta-campo">
              Rol de los asistentes
            </label>
            <select
              id="rol-generar"
              className="campo"
              value={rolSeleccion}
              onChange={(evento) =>
                setRolSeleccion(evento.target.value as '' | 'estudiante' | 'docente')
              }
            >
              <option value="">Todos los roles</option>
              <option value="estudiante">Solo estudiantes</option>
              <option value="docente">Solo docentes</option>
            </select>
          </div>
          <Aviso tono="aviso" titulo="Filtro de elegibilidad">
            Solo se genera el certificado de los asistentes que tengan las 4 marcas: ingreso y
            salida de la manana e ingreso y salida de la tarde, con la permanencia minima. El lote
            se guardara en la carpeta
            <span className="font-mono"> certificadosGenerados </span> y podra descargarlo como ZIP.
          </Aviso>

          <div className="rounded-lg border border-neutro-200 p-3">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={excepcion}
                onChange={(evento) => setExcepcion(evento.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0 accent-[#12505E]"
              />
              <span>
                <span className="block text-sm font-semibold text-neutro-800">
                  Emitir tambien a quienes no cumplen las condiciones
                </span>
                <span className="block text-xs text-neutro-500">
                  Excepcion del administrador para casos especiales. Queda registrada en la
                  auditoria con el motivo.
                </span>
              </span>
            </label>

            {excepcion ? (
              <div className="mt-3">
                <label htmlFor="motivo-excepcion" className="etiqueta-campo">
                  Motivo de la excepcion
                </label>
                <textarea
                  id="motivo-excepcion"
                  className="campo min-h-[72px]"
                  value={motivoExcepcion}
                  onChange={(evento) => setMotivoExcepcion(evento.target.value)}
                  placeholder="Por ejemplo: el asistente colaboro en la organizacion del evento y no alcanzo a registrar su salida."
                />
                <p className="mt-1 text-xs text-neutro-500">
                  Minimo 10 caracteres. Se guarda junto al lote en la auditoria.
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </Modal>

      <Modal
        abierto={eliminar !== null}
        titulo="Eliminar plantilla"
        alCerrar={() => setEliminar(null)}
        pie={
          <div className="flex justify-end gap-2">
            <button type="button" className="boton-secundario" onClick={() => setEliminar(null)}>
              Cancelar
            </button>
            <button
              type="button"
              className="boton-peligro"
              onClick={() => {
                if (eliminar) borrar.mutate(eliminar.id);
              }}
              disabled={borrar.isPending}
            >
              Eliminar
            </button>
          </div>
        }
      >
        <p className="text-sm text-neutro-700">
          Se eliminara la plantilla <span className="font-semibold">{eliminar?.nombre}</span>. Los
          certificados ya generados no se ven afectados. La accion queda auditada.
        </p>
      </Modal>

      <Modal
        abierto={eliminarLote !== null}
        titulo="Eliminar lote de certificados"
        alCerrar={() => setEliminarLote(null)}
        pie={
          <div className="flex justify-end gap-2">
            <button type="button" className="boton-secundario" onClick={() => setEliminarLote(null)}>
              Cancelar
            </button>
            <button
              type="button"
              className="boton-peligro"
              onClick={() => {
                if (eliminarLote) borrarLote.mutate(eliminarLote.id);
              }}
              disabled={borrarLote.isPending}
            >
              Eliminar
            </button>
          </div>
        }
      >
        <p className="text-sm text-neutro-700">
          Se eliminaran los .docx y el ZIP de este lote de la carpeta
          <span className="font-mono"> certificadosGenerados</span>. La accion queda auditada.
        </p>
      </Modal>
    </div>
  );
}

function ListaElegibilidad({
  datos,
  cargando,
  oficial,
}: {
  datos: MarcasElegibilidad[];
  cargando: boolean;
  oficial?: ListadoElegibilidad;
}) {
  const filas = datos.length > 0 ? datos : oficial?.datos ?? [];
  if (cargando && filas.length === 0) return <EsqueletoTarjeta lineas={4} />;
  if (filas.length === 0) {
    return <p className="mt-3 text-sm text-neutro-600">Sin datos de elegibilidad.</p>;
  }
  const excluidos = filas.filter((fila) => !fila.elegible);
  return (
    <div className="mt-3 space-y-2">
      {oficial ? (
        <p className="text-xs text-neutro-600">
          {formatearNumero(oficial.elegibles)} elegibles de {formatearNumero(oficial.total)} -{' '}
          {oficial.regla}
        </p>
      ) : null}
      {excluidos.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-exito-700">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          Todos los asistentes evaluados cumplen las 4 marcas.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {excluidos.slice(0, 30).map((fila) => (
            <li
              key={fila.asistenteId}
              className="flex items-start gap-2 rounded-xl bg-aviso-50 px-3 py-2 text-xs text-aviso-800"
            >
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                <span className="font-semibold">{fila.nombre}</span> ({fila.asistenteId}): {fila.motivo}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Metrica({
  titulo,
  valor,
  tono = 'neutro',
}: {
  titulo: string;
  valor: number;
  tono?: 'neutro' | 'exito' | 'error';
}) {
  const colores = {
    neutro: 'text-neutro-900',
    exito: 'text-exito-700',
    error: 'text-error-700',
  } as const;
  return (
    <div className="rounded-2xl bg-neutro-50 px-3 py-2.5">
      <dt className="text-xs text-neutro-600">{titulo}</dt>
      <dd className={`text-lg font-bold ${colores[tono]}`}>{formatearNumero(valor)}</dd>
    </div>
  );
}
