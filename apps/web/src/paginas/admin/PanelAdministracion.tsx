import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  Award,
  BarChart3,
  FileSpreadsheet,
  LayoutDashboard,
  LogOut,
  Menu,
  QrCode,
  ScanLine,
  Settings,
  Upload,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import { api } from '../../lib/api';
import { useSesion } from '../../estado/sesion';

const SECCIONES = [
  { ruta: '/operador', etiqueta: 'Tomar asistencia', Icono: ScanLine, exacto: false },
  { ruta: '/admin', etiqueta: 'Dashboard', Icono: LayoutDashboard, exacto: true },
  { ruta: '/admin/asistentes', etiqueta: 'Asistentes', Icono: Users, exacto: false },
  { ruta: '/admin/importar', etiqueta: 'Importar', Icono: Upload, exacto: false },
  { ruta: '/admin/carnets', etiqueta: 'Carnets y QR', Icono: QrCode, exacto: false },
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
      <header className="sticky top-0 z-30 bg-marca text-white shadow-marca">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="boton-compacto text-white hover:bg-white/10 lg:hidden"
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
            <img
              src="/logo-ucc-blanco.svg"
              alt="Universidad Cooperativa de Colombia"
              className="hidden h-8 w-auto sm:block"
            />
            <div>
              <h1 className="text-base font-bold">Panel de administracion</h1>
              <p className="text-xs text-primario-100">
                {usuario?.nombre} - {usuario?.email}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/operador"
              className="boton-compacto hidden bg-white/15 text-white hover:bg-white/25 sm:inline-flex"
            >
              <ScanLine className="h-4 w-4" aria-hidden="true" />
              Tomar asistencia
            </Link>
            <BarChart3 className="hidden h-5 w-5 text-primario-300 sm:block" aria-hidden="true" />
            <button
              type="button"
              className="boton-compacto text-white hover:bg-white/10"
              onClick={() => {
                void api.cerrarSesion();
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
          className={clsx('w-full shrink-0 lg:w-60', menuAbierto ? 'block' : 'hidden lg:block')}
          aria-label="Secciones del panel"
        >
          <ul className="superficie divide-y divide-neutro-100 overflow-hidden">
            {SECCIONES.map(({ ruta, etiqueta, Icono, exacto }) => (
              <li key={ruta}>
                <NavLink
                  to={ruta}
                  end={exacto}
                  onClick={() => setMenuAbierto(false)}
                  className={({ isActive }) =>
                    clsx(
                      'flex min-h-[48px] items-center gap-3 px-4 py-3 text-sm font-semibold transition-colors',
                      isActive
                        ? 'bg-marca text-white'
                        : 'text-neutro-700 hover:bg-primario-50 hover:text-primario-700',
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
