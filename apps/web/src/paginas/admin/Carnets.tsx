import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, QrCode } from 'lucide-react';
import { api } from '../../lib/api';
import { formatearNumero } from '../../lib/formato';
import { Aviso, EsqueletoTarjeta, Tarjeta } from '../../componentes/comunes';

export function Carnets() {
  const [rol, setRol] = useState<'' | 'estudiante' | 'docente'>('');
  const [descargando, setDescargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data, isPending } = useQuery({
    queryKey: ['asistentes', 'carnets', rol],
    queryFn: () =>
      api.obtener<{ total: number }>(
        `/asistentes?porPagina=1${rol ? `&rol=${rol}` : ''}`,
      ),
    staleTime: 60_000,
  });

  const descargar = async () => {
    setDescargando(true);
    setError(null);
    try {
      const parametros = new URLSearchParams();
      if (rol) parametros.set('rol', rol);
      const archivo = await api.descarga(`/asistentes/carnets?${parametros.toString()}`);
      const url = URL.createObjectURL(archivo);
      const enlace = document.createElement('a');
      enlace.href = url;
      enlace.download = 'carnets-asistentes.pdf';
      document.body.appendChild(enlace);
      enlace.click();
      document.body.removeChild(enlace);
      URL.revokeObjectURL(url);
    } catch {
      setError('No se pudo generar el archivo de carnets. Intente de nuevo.');
    } finally {
      setDescargando(false);
    }
  };

  return (
    <Tarjeta
      titulo="Carnets y escarapelas con QR"
      descripcion="Genera un PDF con el codigo QR, el nombre, el rol y el ID de cada asistente"
      accion={
        <button
          type="button"
          className="boton-primario"
          onClick={() => void descargar()}
          disabled={descargando}
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          {descargando ? 'Generando' : 'Descargar PDF'}
        </button>
      }
    >
      {error ? (
        <div className="mb-4">
          <Aviso tono="error">{error}</Aviso>
        </div>
      ) : null}

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
          {isPending ? 'Contando asistentes...' : `${formatearNumero(data?.total ?? 0)} asistentes`}
        </p>
      </div>

      <div className="mt-5">
        <Aviso tono="primario" titulo="Imprima en papel grueso o plastificado">
          <span className="flex items-start gap-2">
            <QrCode className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              El codigo QR contiene el ID institucional, que es la clave de busqueda del asistente.
              Cada carnet muestra ademas el nombre, el rol y el ID en texto legible por si el
              escaner falla y el operador debe digitarlo.
            </span>
          </span>
        </Aviso>
      </div>

      {isPending ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <EsqueletoTarjeta />
          <EsqueletoTarjeta />
          <EsqueletoTarjeta />
        </div>
      ) : null}
    </Tarjeta>
  );
}
