import { Link } from 'react-router-dom';
import { FileQuestion } from 'lucide-react';

export function NoEncontrada() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-primario-50 px-6 text-center">
      <FileQuestion className="h-10 w-10 text-neutro-500" aria-hidden="true" />
      <h1 className="text-xl font-bold text-neutro-900">Pagina no encontrada</h1>
      <p className="max-w-sm text-sm text-neutro-600">
        La direccion solicitada no existe en el sistema de asistencia.
      </p>
      <Link to="/" className="boton-primario">
        Ir al inicio
      </Link>
    </div>
  );
}
