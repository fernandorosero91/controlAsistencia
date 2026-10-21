import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Download, FileUp, TriangleAlert, Upload } from 'lucide-react';
import { api, ErrorPeticion } from '../../lib/api';
import { formatearNumero } from '../../lib/formato';
import { Aviso, EstadoVacio, Insignia, Tarjeta } from '../../componentes/comunes';

interface VistaPrevia {
  totalFilas: number;
  filasValidas: number;
  filasConError: number;
  nuevos: number;
  actualizados: number;
  duplicadosEnArchivo: number;
  muestra: {
    fila: number;
    datos: Record<string, unknown>;
    errores: { fila: number; campo: string | null; mensaje: string; valor: string | null }[];
  }[];
}

export function ImportarAsistentes() {
  const cliente = useQueryClient();
  const referenciaArchivo = useRef<HTMLInputElement | null>(null);
  const [vistaPrevia, setVistaPrevia] = useState<VistaPrevia | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultadoImportacion, setResultadoImportacion] = useState<string | null>(null);
  const [archivoNombre, setArchivoNombre] = useState<string | null>(null);
  const [descargandoPlantilla, setDescargandoPlantilla] = useState(false);

  const descargarPlantilla = async () => {
    setDescargandoPlantilla(true);
    try {
      const archivo = await api.descarga('/asistentes/plantilla');
      const url = URL.createObjectURL(archivo);
      const enlace = document.createElement('a');
      enlace.href = url;
      enlace.download = 'plantilla-asistentes.xlsx';
      document.body.appendChild(enlace);
      enlace.click();
      document.body.removeChild(enlace);
      URL.revokeObjectURL(url);
    } catch {
      setError('No se pudo descargar la plantilla.');
    } finally {
      setDescargandoPlantilla(false);
    }
  };

  const analysing = useMutation({
    mutationFn: async (archivo: File) => {
      const datos = new FormData();
      datos.append('archivo', archivo);
      return api.enviar<VistaPrevia>('/asistentes/importar/previa', datos, {
        reintentar: false,
      });
    },
    onSuccess: (datos) => {
      setVistaPrevia(datos);
      setError(null);
    },
    onError: (problema) => {
      setError(
        problema instanceof ErrorPeticion
          ? problema.message
          : 'No se pudo leer el archivo. Verifique el formato y el tamano.',
      );
    },
  });

  const confirmar = useMutation({
    mutationFn: async () => {
      if (!vistaPrevia) return;
      const filas = vistaPrevia.muestra
        .filter((fila) => fila.errores.length === 0)
        .map((fila) => ({
          fila: fila.fila,
          id: String(fila.datos.id ?? ''),
          nombres: String(fila.datos.nombres ?? ''),
          apellidos: String(fila.datos.apellidos ?? ''),
          rol: String(fila.datos.rol ?? 'estudiante') as 'estudiante' | 'docente',
          semestre: (fila.datos.semestre ?? null) as number | null,
        }));
      return api.crear<{ creados: number; actualizados: number; omitidos: number }>(
        '/asistentes/importar/confirmar',
        { filas, modo: 'crear_actualizar' },
      );
    },
    onSuccess: (resultado) => {
      void cliente.invalidateQueries({ queryKey: ['asistentes'] });
      setVistaPrevia(null);
      setArchivoNombre(null);
      setResultadoImportacion(
        `Se importaron ${resultado?.creados ?? 0} asistentes nuevos y se actualizaron ${resultado?.actualizados ?? 0}.`,
      );
      if (referenciaArchivo.current) referenciaArchivo.current.value = '';
    },
  });

  return (
    <div className="space-y-4">
      <Tarjeta
        titulo="Importacion masiva de asistentes"
        descripcion="Archivo XLSX o CSV con las columnas: id, nombres, apellidos, rol, semestre y email"
        accion={
          <button
            type="button"
            className="boton-secundario"
            onClick={() => void descargarPlantilla()}
            disabled={descargandoPlantilla}
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            {descargandoPlantilla ? 'Descargando' : 'Descargar plantilla'}
          </button>
        }
      >
        <div className="rounded-2xl border border-dashed border-neutro-300 bg-white/70 px-4 py-8 text-center">
          <FileUp className="mx-auto h-9 w-9 text-neutro-500" aria-hidden="true" />
          <p className="mt-2 text-sm text-neutro-700">
            Seleccione el archivo de Excel con el padron de asistentes
          </p>
          <p className="mt-1 text-xs text-neutro-500">
            Formato XLSX (primera hoja) o CSV. Maximo 10 MB y 5000 filas por importacion. El
            codigo de registro y el QR los genera el sistema: no se importan.
          </p>
          <input
            ref={referenciaArchivo}
            type="file"
            accept=".csv,.xlsx"
            className="sr-only"
            id="archivo-asistentes"
            onChange={(evento) => {
              const archivo = evento.target.files?.[0];
              if (!archivo) return;
              setArchivoNombre(archivo.name);
              analysing.mutate(archivo);
            }}
          />
          <label
            htmlFor="archivo-asistentes"
            className="boton-primario mt-4 inline-flex cursor-pointer"
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            {analysing.isPending ? 'Analizando' : 'Seleccionar archivo'}
          </label>
        </div>

        {error ? (
          <div className="mt-4">
            <Aviso tono="error" titulo="No se pudo procesar el archivo">
              {error}
            </Aviso>
          </div>
        ) : null}

        {resultadoImportacion ? (
          <div className="mt-4">
            <Aviso tono="exito" titulo="Importacion completada">
              {resultadoImportacion}
            </Aviso>
          </div>
        ) : null}
      </Tarjeta>

      {vistaPrevia ? (
        <Tarjeta
          titulo={`Vista previa de ${archivoNombre ?? 'archivo'}`}
          descripcion="Revise el resultado antes de aplicar los cambios al padron"
          accion={
            <button
              type="button"
              className="boton-primario"
              onClick={() => confirmar.mutate()}
              disabled={confirmar.isPending || vistaPrevia.filasValidas === 0}
            >
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              {confirmar.isPending
                ? 'Importando'
                : `Importar ${formatearNumero(vistaPrevia.filasValidas)} filas`}
            </button>
          }
        >
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metrica titulo="Filas" valor={vistaPrevia.totalFilas} />
            <Metrica titulo="Validas" valor={vistaPrevia.filasValidas} tono="exito" />
            <Metrica titulo="Con error" valor={vistaPrevia.filasConError} tono="error" />
            <Metrica titulo="Nuevos" valor={vistaPrevia.nuevos} />
          </dl>

          {vistaPrevia.duplicadosEnArchivo > 0 ? (
            <div className="mt-4">
              <Aviso tono="aviso" titulo="IDs repetidos en el archivo">
                {formatearNumero(vistaPrevia.duplicadosEnArchivo)} filas repiten un ID ya presente
                en el archivo. Se tomara la primera aparicion.
              </Aviso>
            </div>
          ) : null}

          <div className="mt-4 overflow-x-auto sin-barra-espacial">
            <table className="tabla">
              <thead className="tabla-cabecera">
                <tr>
                  <th scope="col">Fila</th>
                  <th scope="col">ID</th>
                  <th scope="col">Nombre</th>
                  <th scope="col">Rol</th>
                  <th scope="col">Semestre</th>
                  <th scope="col">Estado</th>
                </tr>
              </thead>
              <tbody className="tabla-cuerpo">
                {vistaPrevia.muestra.map((fila) => (
                  <tr key={fila.fila}>
                    <td className="text-neutro-500">{fila.fila}</td>
                    <td className="font-mono">{String(fila.datos.id ?? '')}</td>
                    <td>
                      {String(fila.datos.nombres ?? '')} {String(fila.datos.apellidos ?? '')}
                    </td>
                    <td>{String(fila.datos.rol ?? '')}</td>
                    <td>{fila.datos.semestre === null ? '-' : String(fila.datos.semestre ?? '-')}</td>
                    <td>
                      {fila.errores.length === 0 ? (
                        <Insignia tono="exito">Valida</Insignia>
                      ) : (
                        <span className="flex items-start gap-1.5 text-sm text-error-700">
                          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                          {fila.errores.map((detalle) => detalle.mensaje).join('; ')}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {vistaPrevia.muestra.length === 0 ? (
            <EstadoVacio titulo="El archivo no tiene filas para mostrar" />
          ) : null}
        </Tarjeta>
      ) : null}
    </div>
  );
}

function Metrica({
  titulo,
  valor,
  tono,
}: {
  titulo: string;
  valor: number;
  tono?: 'exito' | 'error';
}) {
  return (
    <div className="rounded-lg border border-neutro-200 bg-neutro-50 px-3 py-2.5">
      <dt className="text-xs font-medium text-neutro-600">{titulo}</dt>
      <dd
        className={
          tono === 'exito'
            ? 'text-xl font-bold text-exito-600'
            : tono === 'error'
              ? 'text-xl font-bold text-error-600'
              : 'text-xl font-bold text-neutro-900'
        }
      >
        {formatearNumero(valor)}
      </dd>
    </div>
  );
}
