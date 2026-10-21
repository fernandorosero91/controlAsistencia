import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  Award,
  BarChart3,
  FileSpreadsheet,
  LayoutDashboard,
  LogOut,
  Menu,
  QrCode,
  Settings,
  Upload,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import { useSesion } from '../../estado/sesion';

const SECCIONES = [
  { ruta: '/admin', etiqueta: 'Dashboard', Icono: LayoutDashboard, exacto: true },
  { ruta: '/admin/asistentes', etiqueta: 'Asistentes', Icono: Users, exacto: false },
  { ruta: '/admin/importar', etiqueta: 'Importar', Icono: Upload, exacto: false },
  { ruta: '/admin/carnets', etiqueta: 'Carnets', Icono: QrCode, exacto: false },
  { ruta: '/admin/certificados', etiqueta: 'Certificados', Icono: Award, exacto: false },
  { ruta: '/admin/reportes', etiqueta: 'Reportes', Icono: FileSpreadsheet, exacto: false },
  { ruta: '/admin/configuracion', etiqueta: 'Configuracion', Icono: Settings, exacto: false },
  { ruta: '/admin/usuarios', etiqueta: 'Usuarios', Icono: UserCheck, exacto: false },
];

export function PanelAdministracion() {
  const navegar = useNavigate();
  const usuario = useSesion((estado) => estado.usuario);
  const cerrarSesion = useSesion((estado) => estado.cerrarSesion);
  const [menuAbierto, setMenuAbierto] = useState(false);

  return (
    <div className="min-h-dvh bg-primario-50">
      <header className="sticky top-0 z-30 border-b border-neutro-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="boton-compacto text-neutro-600 hover:bg-neutro-100 lg:hidden"
              onClick={() => setMenuAbierto((valor) => !valor)}
              aria-label="Abrir el menu de administracion"
              aria-expanded={menuAbierto}
            >
              {menuAbierto ? (
                <X className="h-5 w-5" aria-hidden="true" />
              ) : (
                <Menu className="h-5 w-5" aria-hidden="true" />
              )}
            </button>
            <div>
              <h1 className="text-base font-bold text-primario-900">Panel de administracion</h1>
              <p className="text-xs text-neutro-600">
                {usuario?.nombre} - {usuario?.email}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <BarChart3 className="hidden h-5 w-5 text-neutro-400 sm:block" aria-hidden="true" />
            <button
              type="button"
              className="boton-compacto text-neutro-600 hover:bg-neutro-100"
              onClick={() => {
                cerrarSesion();
                navegar('/login');
              }}
            >
              <LogOut className="h-5 w-5" aria-hidden="true" />
              <span className="hidden sm:inline">Salir</span>
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl gap-6 px-4 py-5">
        <nav
          className={clsx(
            'w-full shrink-0 lg:w-60',
            menuAbierto ? 'block' : 'hidden lg:block',
          )}
          aria-label="Secciones del panel"
        >
          <ul className="superficie divide-y divide-neutro-200 overflow-hidden">
            {SECCIONES.map(({ ruta, etiqueta, Icono, exacto }) => (
              <li key={ruta}>
                <NavLink
                  to={ruta}
                  end={exacto}
                  onClick={() => setMenuAbierto(false)}
                  className={({ isActive }) =>
                    clsx(
                      'flex min-h-[48px] items-center gap-3 px-4 py-3 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-primario-700 text-white'
                        : 'text-neutro-700 hover:bg-neutro-100',
                    )
                  }
                >
                  <Icono className="h-5 w-5 shrink-0" aria-hidden="true" />
                  {etiqueta}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
