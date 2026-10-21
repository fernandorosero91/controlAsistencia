import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useSesion } from './estado/sesion';
import { registrarEstadoConexion, useColaOffline } from './estado/colaOffline';
import { renovarToken } from './lib/api';
import { PantallaCarga } from './componentes/comunes';
import { Login } from './paginas/Login';
import { Operador } from './paginas/Operador';
import { PanelAdministracion } from './paginas/admin/PanelAdministracion';
import { Dashboard } from './paginas/admin/Dashboard';
import { Asistentes } from './paginas/admin/Asistentes';
import { ImportarAsistentes } from './paginas/admin/ImportarAsistentes';
import { Carnets } from './paginas/admin/Carnets';
import { Certificados } from './paginas/admin/Certificados';
import { Configuracion } from './paginas/admin/Configuracion';
import { Reportes } from './paginas/admin/Reportes';
import { Usuarios } from './paginas/admin/Usuarios';
import { VerificarCertificado } from './paginas/VerificarCertificado';
import { NoEncontrada } from './paginas/NoEncontrada';

function RequiereSesion({ children }: { children: JSX.Element }) {
  const usuario = useSesion((estado) => estado.usuario);
  const inicializando = useSesion((estado) => estado.inicializando);

  if (inicializando) return <PantallaCarga mensaje="Restaurando la sesion" />;
  if (!usuario) return <Navigate to="/login" replace />;
  return children;
}

function RequiereAdmin({ children }: { children: JSX.Element }) {
  const usuario = useSesion((estado) => estado.usuario);
  if (!usuario) return <Navigate to="/login" replace />;
  if (usuario.rol !== 'admin') return <Navigate to="/operador" replace />;
  return children;
}

export function App() {
  const inicializando = useSesion((estado) => estado.inicializando);
  const marcarInicializada = useSesion((estado) => estado.marcarInicializada);
  const usuario = useSesion((estado) => estado.usuario);
  const refrescarCola = useColaOffline((estado) => estado.refrescar);

  useEffect(() => {
    let vigente = true;
    void (async () => {
      await renovarToken();
      if (vigente) marcarInicializada(false);
    })();
    return () => {
      vigente = false;
    };
  }, [marcarInicializada]);

  useEffect(() => registrarEstadoConexion(), []);

  useEffect(() => {
    void refrescarCola();
  }, [refrescarCola]);

  if (inicializando) return <PantallaCarga mensaje="Cargando el sistema" />;

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/verificar/:codigo" element={<VerificarCertificado />} />
      <Route
        path="/operador"
        element={
          <RequiereSesion>
            <Operador />
          </RequiereSesion>
        }
      />
      <Route
        path="/admin"
        element={
          <RequiereAdmin>
            <PanelAdministracion />
          </RequiereAdmin>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="asistentes" element={<Asistentes />} />
        <Route path="importar" element={<ImportarAsistentes />} />
        <Route path="carnets" element={<Carnets />} />
        <Route path="certificados" element={<Certificados />} />
        <Route path="configuracion" element={<Configuracion />} />
        <Route path="reportes" element={<Reportes />} />
        <Route path="usuarios" element={<Usuarios />} />
      </Route>
      <Route
        path="/"
        element={<Navigate to={usuario?.rol === 'admin' ? '/admin' : '/operador'} replace />}
      />
      <Route path="*" element={<NoEncontrada />} />
    </Routes>
  );
}
