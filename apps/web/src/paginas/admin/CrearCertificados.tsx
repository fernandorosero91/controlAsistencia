import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BadgeCheck,
  Download,
  FileText,
  Star,
  Trash2,
  Upload,
  Users,
} from 'lucide-react';
import {
  CAMPOS_PLANTILLA,
  DESCRIPCION_CAMPO_PLANTILLA,
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
  const [todos, setTodos] = useState(true);
  const [eliminar, setEliminar] = useState<PlantillaCertificado | null>(null);

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['plantillas-certificado'],
    queryFn: () => api.obtener<RespuestaListado>('/plantillas-certificado'),
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

  const descargarZip = useMutation({
    mutationFn: async (plantilla: PlantillaCertificado) => {
      const cuerpo = {
        plantillaId: plantilla.id,
        todos,
        rol: rolSeleccion || undefined,
        soloElegibles: false,
      };
      const archivo = await api.descargarPost('/plantillas-certificado/generar/descarga', cuerpo);
      return archivo;
    },
    onSuccess: (archivo) => {
      const url = URL.createObjectURL(archivo);
      const enlace = document.createElement('a');
      enlace.href = url;
      enlace.download = 'certificados-plantilla.zip';
      document.body.appendChild(enlace);
      enlace.click();
      document.body.removeChild(enlace);
      URL.revokeObjectURL(url);
      setError(null);
      setMensaje('El ZIP con los certificados se genero correctamente.');
    },
    onError: (problema) => {
      setMensaje(null);
      setError(
        problema instanceof ErrorPeticion
          ? problema.message
          : 'No se pudieron generar los certificados',
      );
    },
  });

  const generarResumen = useMutation({
    mutationFn: async (plantilla: PlantillaCertificado) =>
      api.crear<ResumenGeneracion>('/plantillas-certificado/generar', {
        plantillaId: plantilla.id,
        todos,
        rol: rolSeleccion || undefined,
        soloElegibles: false,
      }),
    onSuccess: (resumen) => {
      setResultado(resumen);
      setError(null);
    },
    onError: (problema) => {
      setResultado(null);
      setError(
        problema instanceof ErrorPeticion ? problema.message : 'No se pudieron generar los certificados',
      );
    },
  });

  const plantillas = data?.datos ?? [];

  return (
    <div className="space-y-4">
      {error ? <Aviso tono="error" titulo="No fue posible completar la accion">{error}</Aviso> : null}
      {mensaje ? <Aviso tono="exito">{mensaje}</Aviso> : null}

      <Tarjeta
        titulo="Crear certificados desde una plantilla .docx"
        descripcion="Suba una plantilla de Word con los campos entre dobles llaves y genere los certificados del padron"
      >
        <Aviso tono="primario" titulo="Como marcar los campos en la plantilla">
          <p>
            En el documento de Word escriba los datos del titular entre dobles llaves, por ejemplo:
          </p>
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
                    }}
                  >
                    <Users className="h-4 w-4" aria-hidden="true" />
                    Generar
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
            <Metrica titulo="Total" valor={resultado.total} />
            <Metrica titulo="Generados" valor={resultado.generados} tono="exito" />
            <Metrica titulo="Omitidos" valor={resultado.omitidos} tono={resultado.omitidos > 0 ? 'error' : 'neutro'} />
          </dl>
          {resultado.errores.length > 0 ? (
            <ul className="mt-3 space-y-1 text-xs text-error-700">
              {resultado.errores.slice(0, 8).map((detalle) => (
                <li key={detalle.asistenteId}>
                  {detalle.asistenteId}: {detalle.mensaje}
                </li>
              ))}
            </ul>
          ) : null}
        </Tarjeta>
      ) : null}

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
              className="boton-secundario"
              onClick={() => {
                if (generarCon) generarResumen.mutate(generarCon);
              }}
              disabled={generarResumen.isPending}
            >
              <BadgeCheck className="h-4 w-4" aria-hidden="true" />
              {generarResumen.isPending ? 'Generando' : 'Previsualizar'}
            </button>
            <button
              type="button"
              className="boton-primario"
              onClick={() => {
                if (generarCon) descargarZip.mutate(generarCon);
              }}
              disabled={descargarZip.isPending}
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              {descargarZip.isPending ? 'Generando' : 'Descargar ZIP'}
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
              onChange={(evento) => setRolSeleccion(evento.target.value as '' | 'estudiante' | 'docente')}
            >
              <option value="">Todos los roles</option>
              <option value="estudiante">Solo estudiantes</option>
              <option value="docente">Solo docentes</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-neutro-700">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={todos}
              onChange={(evento) => setTodos(evento.target.checked)}
            />
            Generar para todo el padron activo
          </label>
          <p className="text-xs text-neutro-500">
            Por ahora la seleccion individual de asistentes se define en un paso posterior. Si
            desmarca esta opcion, se generaran igualmente todos los asistentes activos que
            coincidan con el rol elegido.
          </p>
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
