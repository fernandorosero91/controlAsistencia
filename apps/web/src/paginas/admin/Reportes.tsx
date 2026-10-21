import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileSpreadsheet, FileText, Sheet } from 'lucide-react';
import { api } from '../../lib/api';
import { Aviso, Tarjeta } from '../../componentes/comunes';

type Formato = 'csv' | 'xlsx' | 'pdf';

interface DefinicionReporte {
  id: string;
  titulo: string;
  descripcion: string;
}

const REPORTES: DefinicionReporte[] = [
  {
    id: 'asistencia',
    titulo: 'Asistencia por jornada',
    descripcion: 'Ingresos y salidas con el operador que realizo cada registro',
  },
  {
    id: 'asistencia-parcial',
    titulo: 'Asistencia parcial',
    descripcion: 'Asistentes que no tienen registro en todas las jornadas',
  },
  {
    id: 'refrigerios-entregados',
    titulo: 'Refrigerios entregados',
    descripcion: 'Detalle de cada entrega con fecha y responsable',
  },
  {
    id: 'refrigerios-pendientes',
    titulo: 'Refrigerios pendientes',
    descripcion: 'Asistentes con asistencia que todavia no recibieron el refrigerio',
  },
  {
    id: 'elegibles',
    titulo: 'Elegibles a certificado',
    descripcion: 'Asistentes que cumplen los requisitos de asistencia y permanencia',
  },
  {
    id: 'no-elegibles',
    titulo: 'No elegibles a certificado',
    descripcion: 'Asistentes que no cumplen los requisitos, con el motivo',
  },
  {
    id: 'certificados-emitidos',
    titulo: 'Certificados emitidos',
    descripcion: 'Certificados vigentes con su codigo de verificacion',
  },
  {
    id: 'auditoria',
    titulo: 'Auditoria',
    descripcion: 'Acciones sensibles registradas con usuario, IP y fecha',
  },
];

export function Reportes() {
  const [jornadaId, setJornadaId] = useState<string>('');
  const [rol, setRol] = useState<string>('');
  const [descargando, setDescargando] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: jornadas } = useQuery({
    queryKey: ['jornadas'],
    queryFn: () => api.obtener<{ jornadas: { id: number; nombre: string }[] }>('/jornadas'),
    staleTime: 60_000,
  });

  const descargar = async (reporte: string, formato: Formato) => {
    setDescargando(`${reporte}-${formato}`);
    setError(null);
    try {
      const parametros = new URLSearchParams({ formato });
      if (jornadaId) parametros.set('jornadaId', jornadaId);
      if (rol) parametros.set('rol', rol);
      const archivo = await api.descarga(`/reportes/${reporte}?${parametros.toString()}`);
      const url = URL.createObjectURL(archivo);
      const enlace = document.createElement('a');
      enlace.href = url;
      enlace.download = `reporte-${reporte}.${formato}`;
      document.body.appendChild(enlace);
      enlace.click();
      document.body.removeChild(enlace);
      URL.revokeObjectURL(url);
    } catch {
      setError('No se pudo generar el reporte. Intente de nuevo en unos minutos.');
    } finally {
      setDescargando(null);
    }
  };

  return (
    <div className="space-y-4">
      <Tarjeta
        titulo="Reportes del seminario"
        descripcion="Las cifras coinciden con los totales mostrados en el dashboard"
      >
        {error ? (
          <div className="mb-4">
            <Aviso tono="error">{error}</Aviso>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="filtro-jornada-reporte" className="etiqueta-campo">
              Jornada
            </label>
            <select
              id="filtro-jornada-reporte"
              className="campo"
              value={jornadaId}
              onChange={(evento) => setJornadaId(evento.target.value)}
            >
              <option value="">Todas las jornadas</option>
              {jornadas?.jornadas.map((jornada) => (
                <option key={jornada.id} value={jornada.id}>
                  {jornada.nombre}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="filtro-rol-reporte" className="etiqueta-campo">
              Rol
            </label>
            <select
              id="filtro-rol-reporte"
              className="campo"
              value={rol}
              onChange={(evento) => setRol(evento.target.value)}
            >
              <option value="">Todos los roles</option>
              <option value="estudiante">Estudiantes</option>
              <option value="docente">Docentes</option>
            </select>
          </div>
        </div>
      </Tarjeta>

      <div className="grid gap-3 lg:grid-cols-2">
        {REPORTES.map((reporte) => (
          <Tarjeta key={reporte.id} titulo={reporte.titulo} descripcion={reporte.descripcion}>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="boton-secundario"
                onClick={() => void descargar(reporte.id, 'csv')}
                disabled={descargando !== null}
              >
                <Sheet className="h-4 w-4" aria-hidden="true" />
                CSV
              </button>
              <button
                type="button"
                className="boton-secundario"
                onClick={() => void descargar(reporte.id, 'xlsx')}
                disabled={descargando !== null}
              >
                <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
                Excel
              </button>
              <button
                type="button"
                className="boton-secundario"
                onClick={() => void descargar(reporte.id, 'pdf')}
                disabled={descargando !== null}
              >
                <FileText className="h-4 w-4" aria-hidden="true" />
                PDF
              </button>
              {descargando === `${reporte.id}-csv` ? (
                <span className="self-center text-xs text-neutro-500">Generando...</span>
              ) : null}
            </div>
          </Tarjeta>
        ))}
      </div>

      <p className="flex items-center gap-2 text-xs text-neutro-500">
        <Download className="h-3.5 w-3.5" aria-hidden="true" />
        Las exportaciones en Excel y PDF protegen las celdas contra la inyeccion de formulas.
      </p>
    </div>
  );
}
