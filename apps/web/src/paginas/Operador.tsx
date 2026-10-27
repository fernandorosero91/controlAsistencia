import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  ClipboardCheck,
  Gift,
  Info,
  LayoutDashboard,
  LogOut,
  Package,
  ScanLine,
  Search,
  Settings2,
  UserCheck,
  Users,
  WifiOff,
} from 'lucide-react';
import clsx from 'clsx';
import type { ModoRegistro, RespuestaRegistro } from '@seminario/shared';
import { api, ErrorPeticion, ErrorRed, nuevoClaveIdempotencia } from '../lib/api';
import { avisar } from '../lib/alertas';
import { formatearHora, nombreRol } from '../lib/formato';
import { useSesion } from '../estado/sesion';
import {
  agregarALaCola,
  eliminarDeLaCola,
  listarPendientes,
  type RegistroCola,
  type TipoRegistroCola,
  actualizarEnCola,
  useColaOffline,
} from '../estado/colaOffline';
import { EscanerCamara } from '../componentes/operador/EscanerCamara';
import { ResultadoRegistro } from '../componentes/operador/ResultadoRegistro';
import {
  TarjetaVerificacion,
  type VerificacionAsistente,
} from '../componentes/operador/TarjetaVerificacion';
import { Ayuda, Aviso, Creditos, Esqueleto, Insignia, Modal } from '../componentes/comunes';

interface JornadaResumen {
  id: number;
  nombre: string;
  inicio: string;
  fin: string;
}

interface ContextoOperador {
  config: {
    nombre: string;
    horaFinSeminario: string;
    toleranciaMinutos: number;
    exigirAmbasJornadas: boolean;
    minimoPermanenciaHoras: number;
  };
  /** Jornada que el servidor considera vigente. El operador no la elige. */
  jornadaActiva: JornadaResumen | null;
  motivoJornada: 'activa' | 'margen_cierre' | 'forzada' | 'fuera_de_horario' | 'sin_jornadas';
  vigenteHasta: string | null;
  proximaJornada: JornadaResumen | null;
  refrigerios: { id: number; nombre: string; jornadaId: number }[];
  refrigerioActivo: { id: number; nombre: string; jornadaId: number } | null;
  souvenirs: { id: number; nombre: string }[];
  souvenirActivo: { id: number; nombre: string } | null;
  modulos: { ingreso: boolean; refrigerio: boolean; salida: boolean; souvenir: boolean };
  /** Registros de la jornada vigente, para mostrar el avance en vivo. */
  registrosJornada: number;
  servidorHora: string;
}

interface EntradaHistorial {
  id: string;
  modo: TipoRegistroCola;
  nombre: string;
  asistenteId: string;
  resultado: string;
  hora: string;
  pendiente: boolean;
}

const MODOS: {
  id: ModoRegistro;
  etiqueta: string;
  descripcion: string;
  Icono: typeof UserCheck;
}[] = [
  {
    id: 'ingreso',
    etiqueta: 'Ingreso',
    descripcion: 'Registra la entrada a la jornada',
    Icono: UserCheck,
  },
  {
    id: 'refrigerio',
    etiqueta: 'Refrigerio',
    descripcion: 'Entrega el refrigerio de la jornada',
    Icono: Package,
  },
  {
    id: 'salida',
    etiqueta: 'Salida',
    descripcion: 'Registra la salida de la jornada',
    Icono: ClipboardCheck,
  },
  {
    id: 'souvenir',
    etiqueta: 'Souvenir',
    descripcion: 'Entrega el souvenir del seminario',
    Icono: Gift,
  },
];

/** Hora de una marca de tiempo en formato corto, en hora de Bogota. */
function horaBogota(valor: string | null | undefined): string {
  if (!valor) return '-';
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(valor));
}

export function Operador() {
  const navegar = useNavigate();
  const usuario = useSesion((estado) => estado.usuario);
  const cerrarSesion = useSesion((estado) => estado.cerrarSesion);

  const [modo, setModo] = useState<ModoRegistro>('ingreso');
  const [tipoRefrigerioElegido, setTipoRefrigerioElegido] = useState<number | null>(null);
  const [tipoSouvenirElegido, setTipoSouvenirElegido] = useState<number | null>(null);
  const [idTexto, setIdTexto] = useState('');
  const [codigoVerificado, setCodigoVerificado] = useState('');
  const [verificacion, setVerificacion] = useState<VerificacionAsistente | null>(null);
  const [verificando, setVerificando] = useState(false);
  const [resultado, setResultado] = useState<RespuestaRegistro | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [escaneando, setEscaneando] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [ajustes, setAjustes] = useState(false);
  const [historial, setHistorial] = useState<EntradaHistorial[]>([]);
  const [consultaManual, setConsultaManual] = useState('');
  const [motivoExcepcion, setMotivoExcepcion] = useState('');
  const [enviandoExcepcion, setEnviandoExcepcion] = useState(false);
  const [errorExcepcion, setErrorExcepcion] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const enLinea = useColaOffline((estado) => estado.enLinea);
  const pendientes = useColaOffline((estado) => estado.pendientes);
  const conflictos = useColaOffline((estado) => estado.conflictos);
  const refrescarCola = useColaOffline((estado) => estado.refrescar);

  const {
    data: contexto,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['operador', 'contexto'],
    queryFn: () => api.obtener<ContextoOperador>('/operador/contexto'),
    // La jornada cambia sola con el horario y el administrador puede apagar un
    // modulo en cualquier momento: el contexto se refresca cada 20 segundos y
    // cada vez que la app vuelve al frente.
    staleTime: 10_000,
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
  });

  const cliente = useQueryClient();

  // La jornada la decide el servidor: aqui solo se usa la que llega.
  const jornadaId = contexto?.jornadaActiva?.id ?? null;

  const refrigeriosDeLaJornada = useMemo(
    () => (contexto?.refrigerios ?? []).filter((refrigerio) => refrigerio.jornadaId === jornadaId),
    [contexto, jornadaId],
  );

  // Si hay un solo refrigerio en la jornada se usa ese, sin pedirle nada al
  // operador; solo se muestran opciones cuando hay mas de uno.
  const tipoRefrigerioId = refrigeriosDeLaJornada.some(
    (refrigerio) => refrigerio.id === tipoRefrigerioElegido,
  )
    ? tipoRefrigerioElegido
    : (contexto?.refrigerioActivo?.id ?? refrigeriosDeLaJornada[0]?.id ?? null);

  const souvenirsDisponibles = contexto?.souvenirs ?? [];
  const tipoSouvenirId = souvenirsDisponibles.some(
    (souvenir) => souvenir.id === tipoSouvenirElegido,
  )
    ? tipoSouvenirElegido
    : (contexto?.souvenirActivo?.id ?? souvenirsDisponibles[0]?.id ?? null);

  const modulosDisponibles = useMemo(
    () => MODOS.filter((opcion) => contexto?.modulos[opcion.id] ?? false),
    [contexto],
  );

  // El ingreso y la salida necesitan jornada vigente; el souvenir es del evento.
  const requiereJornada = modo === 'ingreso' || modo === 'salida';
  const sinJornada = requiereJornada && !jornadaId;
  const sinRefrigerio = modo === 'refrigerio' && !tipoRefrigerioId;
  const sinSouvenir = modo === 'souvenir' && !tipoSouvenirId;

  // Si el administrador apaga el modulo que estaba en uso, se pasa al primero
  // que siga habilitado.
  useEffect(() => {
    if (!contexto) return;
    if (contexto.modulos[modo]) return;
    const primero = MODOS.find((opcion) => contexto.modulos[opcion.id]);
    if (primero) setModo(primero.id);
  }, [contexto, modo]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [modo]);

  const enfocarCampo = useCallback(() => {
    window.setTimeout(() => {
      const campo = inputRef.current;
      if (!campo) return;
      campo.focus();
      campo.select();
    }, 30);
  }, []);

  const registrarEnHistorial = useCallback((entrada: EntradaHistorial) => {
    setHistorial((actual) => [entrada, ...actual].slice(0, 12));
  }, []);

  const enviar = useCallback(
    async (id: string, clave: string) => {
      setMotivoExcepcion('');
      setErrorExcepcion(null);
      const modoCola: TipoRegistroCola =
        modo === 'ingreso' || modo === 'salida' || modo === 'souvenir' ? modo : 'refrigerio';

      const cuerpo =
        modo === 'refrigerio'
          ? { asistenteId: id, tipoRefrigerioId, dispositivo: 'navegador' }
          : modo === 'souvenir'
            ? { asistenteId: id, tipoSouvenirId, dispositivo: 'navegador' }
            : { asistenteId: id, jornadaId, dispositivo: 'navegador' };

      const ruta =
        modo === 'ingreso'
          ? '/asistencias/ingreso'
          : modo === 'salida'
            ? '/asistencias/salida'
            : modo === 'souvenir'
              ? '/souvenirs/entregar'
              : '/refrigerios/entregar';

      const registroCola: RegistroCola = {
        id: clave,
        tipo: modoCola,
        asistenteId: id,
        jornadaId: jornadaId ?? 0,
        tipoRefrigerioId: modo === 'refrigerio' ? tipoRefrigerioId : null,
        tipoSouvenirId: modo === 'souvenir' ? tipoSouvenirId : null,
        creadoEn: new Date().toISOString(),
        intentos: 0,
        estado: 'pendiente',
        mensaje: null,
      };

      if (!enLinea) {
        await agregarALaCola(registroCola);
        await refrescarCola();
        setResultado(null);
        setIdTexto('');
        enfocarCampo();
        registrarEnHistorial({
          id: clave,
          modo: modoCola,
          nombre: id,
          asistenteId: id,
          resultado: 'Pendiente de sincronizar',
          hora: new Date().toISOString(),
          pendiente: true,
        });
        avisar('aviso');
        return;
      }

      setEnviando(true);
      try {
        const respuesta = await api.enviar<RespuestaRegistro>(ruta, cuerpo, {
          claveIdempotencia: clave,
        });
        setResultado(respuesta);
        setIdTexto('');
        setVerificacion(null);
        setCodigoVerificado('');
        enfocarCampo();
        registrarEnHistorial({
          id: clave,
          modo: modoCola,
          nombre: respuesta.asistente
            ? `${respuesta.asistente.nombres} ${respuesta.asistente.apellidos}`
            : id,
          asistenteId: respuesta.asistente?.id ?? id,
          resultado: respuesta.mensaje,
          hora: new Date().toISOString(),
          pendiente: false,
        });
        avisar(
          respuesta.resultado === 'exito'
            ? 'exito'
            : respuesta.resultado === 'duplicado'
              ? 'aviso'
              : 'error',
        );
        // El contador de la jornada se actualiza al instante.
        void cliente.invalidateQueries({ queryKey: ['operador', 'contexto'] });      } catch (error) {
        if (error instanceof ErrorRed) {
          await agregarALaCola(registroCola);
          await refrescarCola();
          setResultado(null);
          setIdTexto('');
          setVerificacion(null);
          setCodigoVerificado('');
          enfocarCampo();
          registrarEnHistorial({
            id: clave,
            modo: modoCola,
            nombre: id,
            asistenteId: id,
            resultado: 'Sin conexion: queda pendiente de sincronizar',
            hora: new Date().toISOString(),
            pendiente: true,
          });
          avisar('aviso');
          return;
        }
        const mensaje =
          error instanceof ErrorPeticion ? error.message : 'No se pudo completar el registro';
        setResultado({
          resultado: 'no_permitido',
          mensaje,
          asistente: null,
          existente: null,
          requiereBusquedaManual: false,
        });
        avisar('error');
      } finally {
        setEnviando(false);
      }
    },
    [cliente, enLinea, enfocarCampo, jornadaId, modo, refrescarCola, registrarEnHistorial, tipoRefrigerioId, tipoSouvenirId],
  );

  /**
   * Excepcion del administrador: entrega el souvenir a quien no registro su
   * ingreso en la primera jornada. Exige motivo y queda en la auditoria.
   */
  const entregarComoExcepcion = useCallback(async () => {
    const asistente = resultado?.asistente;
    const motivo = motivoExcepcion.trim();
    if (!asistente || !tipoSouvenirId) return;
    if (motivo.length < 10) {
      setErrorExcepcion('El motivo debe tener al menos 10 caracteres.');
      return;
    }
    if (!enLinea) {
      setErrorExcepcion('Sin conexion: la excepcion necesita comunicarse con el servidor.');
      return;
    }

    setEnviandoExcepcion(true);
    setErrorExcepcion(null);
    try {
      const respuesta = await api.enviar<RespuestaRegistro>(
        '/souvenirs/entregar',
        {
          asistenteId: asistente.id,
          tipoSouvenirId,
          dispositivo: 'navegador',
          forzar: true,
          motivo,
        },
        { claveIdempotencia: nuevoClaveIdempotencia() },
      );

      setResultado(respuesta);
      setMotivoExcepcion('');
      registrarEnHistorial({
        id: asistente.id,
        modo: 'souvenir',
        nombre: respuesta.asistente
          ? `${respuesta.asistente.nombres} ${respuesta.asistente.apellidos}`
          : asistente.id,
        asistenteId: asistente.id,
        resultado: `${respuesta.mensaje} (excepcion del administrador)`,
        hora: new Date().toISOString(),
        pendiente: false,
      });
      avisar(respuesta.resultado === 'exito' ? 'exito' : 'aviso');
      void cliente.invalidateQueries({ queryKey: ['operador', 'contexto'] });
    } catch (error) {
      setErrorExcepcion(
        error instanceof ErrorPeticion
          ? error.message
          : 'No se pudo entregar el souvenir como excepcion.',
      );
    } finally {
      setEnviandoExcepcion(false);
    }
  }, [resultado, tipoSouvenirId, motivoExcepcion, enLinea, registrarEnHistorial, cliente]);

  /**
   * Verifica el codigo ingresado y muestra el nombre del asistente para que el
   * operador lo compare con la escarapela antes de registrar.
   */
  const verificar = useCallback(async (codigo: string) => {
    const limpio = codigo.replace(/\s+/g, '').trim().toUpperCase();
    if (limpio.length === 0) return;
    setVerificando(true);
    try {
      const datos = await api.obtener<VerificacionAsistente>(
        `/asistentes/verificar?codigo=${encodeURIComponent(limpio)}`,
      );
      setVerificacion(datos);
      setCodigoVerificado(limpio);
    } catch {
      setVerificacion({ encontrado: false, asistente: null, jornadas: [] });
      setCodigoVerificado(limpio);
    } finally {
      setVerificando(false);
    }
  }, []);

  const manejarEnvio = useCallback(
    (evento?: React.FormEvent) => {
      evento?.preventDefault();
      const id = idTexto.replace(/\s+/g, '').trim().toUpperCase();
      if (id.length === 0 || enviando) return;

      // Si el texto cambio despues de verificar, se vuelve a verificar: nunca se
      // registra a una persona sin haber visto antes su nombre.
      if (codigoVerificado !== id) {
        void verificar(id);
        return;
      }

      if (modo === 'refrigerio' && !tipoRefrigerioId) {
        setResultado({
          resultado: 'no_permitido',
          mensaje: 'No hay un refrigerio activo configurado para esta jornada.',
          asistente: null,
          existente: null,
          requiereBusquedaManual: false,
        });
        return;
      }
      if (modo === 'souvenir' && !tipoSouvenirId) {
        setResultado({
          resultado: 'no_permitido',
          mensaje: 'No hay un souvenir activo configurado.',
          asistente: null,
          existente: null,
          requiereBusquedaManual: false,
        });
        return;
      }
      if (requiereJornada && !jornadaId) {
        setResultado({
          resultado: 'no_permitido',
          mensaje:
            'No hay ninguna jornada activa en este momento. Un administrador puede fijarla desde el panel.',
          asistente: null,
          existente: null,
          requiereBusquedaManual: false,
        });
        return;
      }
      void enviar(id, nuevoClaveIdempotencia());
    },
    [
      codigoVerificado,
      enviando,
      enviar,
      idTexto,
      jornadaId,
      modo,
      requiereJornada,
      tipoRefrigerioId,
      tipoSouvenirId,
      verificar,
    ],
  );

  const detectarEscaneo = useCallback(
    (texto: string) => {
      const limpio = texto.replace(/\s+/g, '').trim().toUpperCase();
      setIdTexto(limpio);
      setResultado(null);
      enfocarCampo();
      // Al escanear se verifica de inmediato: el operador ve el nombre antes de
      // confirmar el registro.
      void verificar(limpio);
    },
    [enfocarCampo, verificar],
  );

  const sincronizarPendientes = useCallback(async () => {
    const registros = await listarPendientes();
    if (registros.length === 0) return;
    useColaOffline.getState().establecerSincronizando(true);
    try {
      for (const registro of registros) {
        const cuerpo =
          registro.tipo === 'refrigerio'
            ? {
                asistenteId: registro.asistenteId,
                tipoRefrigerioId: registro.tipoRefrigerioId,
                dispositivo: 'navegador',
                // Se conserva la hora de captura y la API no exige que la
                // jornada siga vigente: el registro se tomo cuando lo estaba.
                registradoEn: registro.creadoEn,
              }
            : registro.tipo === 'souvenir'
              ? {
                  asistenteId: registro.asistenteId,
                  tipoSouvenirId: registro.tipoSouvenirId,
                  dispositivo: 'navegador',
                  registradoEn: registro.creadoEn,
                }
              : {
                  asistenteId: registro.asistenteId,
                  jornadaId: registro.jornadaId,
                  dispositivo: 'navegador',
                  registradoEn: registro.creadoEn,
                };
        const ruta =
          registro.tipo === 'ingreso'
            ? '/asistencias/ingreso'
            : registro.tipo === 'salida'
              ? '/asistencias/salida'
              : registro.tipo === 'souvenir'
                ? '/souvenirs/entregar'
                : '/refrigerios/entregar';

        try {
          const respuesta = await api.enviar<RespuestaRegistro>(ruta, cuerpo, {
            claveIdempotencia: registro.id,
          });
          if (respuesta.resultado === 'duplicado') {
            await actualizarEnCola({
              ...registro,
              estado: 'conflicto',
              intentos: registro.intentos + 1,
              mensaje: respuesta.mensaje,
            });
          } else {
            await eliminarDeLaCola(registro.id);
          }
        } catch (error) {
          await actualizarEnCola({
            ...registro,
            estado: 'error',
            intentos: registro.intentos + 1,
            mensaje: error instanceof Error ? error.message : 'Error desconocido',
          });
        }
      }
    } finally {
      useColaOffline.getState().establecerSincronizando(false);
      await refrescarCola();
    }
  }, [refrescarCola]);

  useEffect(() => {
    if (!enLinea) return;
    const temporizador = window.setInterval(() => {
      void sincronizarPendientes();
    }, 15000);
    void sincronizarPendientes();
    return () => window.clearInterval(temporizador);
  }, [enLinea, sincronizarPendientes]);

  if (isError) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4">
        <Aviso tono="error" titulo="Sin conexion con el servidor">
          No fue posible obtener la configuracion del seminario. Revise la conexion e intente de
          nuevo.
        </Aviso>
        <button type="button" className="boton-primario" onClick={() => void refetch()}>
          Reintentar
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col gap-3 px-3 py-3 area-segura">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <img
            src="/logo-ucc.svg"
            alt="Universidad Cooperativa de Colombia"
            className="h-6 w-auto"
          />
          <h1 className="mt-1.5 truncate text-base font-bold text-primario-900">
            {contexto?.config.nombre ?? 'Control de asistencia'}
          </h1>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm text-neutro-600">
            {modo === 'souvenir' ? (
              <>
                <span className="font-semibold text-neutro-800">
                  {contexto?.souvenirActivo?.nombre ?? 'Souvenir del seminario'}
                </span>
                <span className="text-neutro-500">
                  Solo con el ingreso de la primera jornada
                </span>
              </>
            ) : contexto?.jornadaActiva ? (
              <>
                <span className="font-semibold text-neutro-800">
                  Jornada: {contexto.jornadaActiva.nombre}
                </span>
                <span className="text-neutro-500">
                  {horaBogota(contexto.jornadaActiva.inicio)} a{' '}
                  {horaBogota(contexto.jornadaActiva.fin)}
                </span>
                {contexto.motivoJornada === 'forzada' ? (
                  <Insignia tono="aviso">Fijada por el administrador</Insignia>
                ) : null}
              </>
            ) : (
              'Sin jornada activa'
            )}
          </p>
          {contexto?.jornadaActiva && modo !== 'souvenir' ? (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-neutro-500">
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
              {contexto.registrosJornada} registros en esta jornada
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          {usuario?.rol === 'admin' ? (
            <button
              type="button"
              className="boton-compacto text-neutro-600 hover:bg-neutro-100"
              onClick={() => navegar('/admin')}
              aria-label="Volver al panel de administracion"
              title="Volver al panel de administracion"
            >
              <LayoutDashboard className="h-5 w-5" aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            className="boton-compacto text-neutro-600 hover:bg-neutro-100"
            onClick={() => setAjustes(true)}
            aria-label="Ajustes del operador"
          >
            <Settings2 className="h-5 w-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="boton-compacto text-neutro-600 hover:bg-neutro-100"
            onClick={() => {
              void api.cerrarSesion();
              cerrarSesion();
              navegar('/login');
            }}
            aria-label="Cerrar sesion"
          >
            <LogOut className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </header>

      {!enLinea ? (
        <Aviso tono="aviso" titulo="Sin conexion">
          Los registros se guardan en el dispositivo y se sincronizan al volver la red.
        </Aviso>
      ) : null}

      {pendientes > 0 ? (
        <Aviso tono="aviso" titulo={`${pendientes} registros por sincronizar`}>
          <button
            type="button"
            className="boton-compacto mt-1 border border-aviso-300 bg-white/70 text-aviso-700"
            onClick={() => void sincronizarPendientes()}
          >
            Sincronizar ahora
          </button>
        </Aviso>
      ) : null}

      {conflictos > 0 ? (
        <Aviso tono="aviso" titulo={`${conflictos} registros con conflicto`}>
          Alguno de esos registros ya existia en el sistema. Revise el historial para confirmar.
        </Aviso>
      ) : null}

      {modulosDisponibles.length === 0 ? (
        <Aviso tono="error" titulo="Registro bloqueado por el administrador">
          Ningun modulo de registro esta habilitado en este momento. Contacte al administrador.
        </Aviso>
      ) : (
        <div
          className={clsx(
            'grid gap-2',
            modulosDisponibles.length === 1
              ? 'grid-cols-1'
              : modulosDisponibles.length === 2
                ? 'grid-cols-2'
                : modulosDisponibles.length === 3
                  ? 'grid-cols-3'
                  : 'grid-cols-2',
          )}
          role="tablist"
          aria-label="Modo de registro"
        >
          {modulosDisponibles.map(({ id, etiqueta, descripcion, Icono }) => {
            const activo = modo === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={activo}
                onClick={() => setModo(id)}
                className={clsx(
                  'flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-3xl px-2 py-2 transition-all',
                  activo
                    ? 'bg-marca text-white shadow-marca'
                    : 'bg-white text-neutro-700 shadow-tarjeta hover:text-primario-700',
                )}
              >
                <Icono className="h-6 w-6" aria-hidden="true" />
                <span className="text-sm font-semibold">{etiqueta}</span>
                <span
                  className={clsx(
                    'text-center text-[11px] leading-tight',
                    activo ? 'text-primario-100' : 'text-neutro-500',
                  )}
                >
                  {' '}
                  {descripcion}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {contexto &&
      requiereJornada &&
      (contexto.motivoJornada === 'fuera_de_horario' || contexto.motivoJornada === 'sin_jornadas') ? (
        <Aviso tono="aviso" titulo="No hay jornada activa">
          {contexto.proximaJornada
            ? `La proxima jornada es ${contexto.proximaJornada.nombre}, a las ${horaBogota(
                contexto.proximaJornada.inicio,
              )}.`
            : 'No hay jornadas programadas.'}
        </Aviso>
      ) : null}

      {modo === 'refrigerio' && refrigeriosDeLaJornada.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto sin-barra-espacial pb-1">
          {refrigeriosDeLaJornada.map((refrigerio) => (
            <button
              key={refrigerio.id}
              type="button"
              onClick={() => setTipoRefrigerioElegido(refrigerio.id)}
              className={clsx(
                'min-h-[44px] shrink-0 rounded-2xl px-4 py-2 text-sm font-semibold transition-colors',
                tipoRefrigerioId === refrigerio.id
                  ? 'bg-marca text-white shadow-marca'
                  : 'bg-white text-neutro-700 shadow-tarjeta',
              )}
            >
              {refrigerio.nombre}
            </button>
          ))}
        </div>
      ) : null}

      {modo === 'refrigerio' && refrigeriosDeLaJornada.length === 0 ? (
        <Aviso tono="aviso" titulo="Sin refrigerio para esta jornada">
          El administrador no ha configurado un refrigerio para la jornada en curso.
        </Aviso>
      ) : null}

      {modo === 'souvenir' && souvenirsDisponibles.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto sin-barra-espacial pb-1">
          {souvenirsDisponibles.map((souvenir) => (
            <button
              key={souvenir.id}
              type="button"
              onClick={() => setTipoSouvenirElegido(souvenir.id)}
              className={clsx(
                'min-h-[44px] shrink-0 rounded-2xl px-4 py-2 text-sm font-semibold transition-colors',
                tipoSouvenirId === souvenir.id
                  ? 'bg-marca text-white shadow-marca'
                  : 'bg-white text-neutro-700 shadow-tarjeta',
              )}
            >
              {souvenir.nombre}
            </button>
          ))}
        </div>
      ) : null}

      {modo === 'souvenir' && souvenirsDisponibles.length === 0 ? (
        <Aviso tono="aviso" titulo="Sin souvenir configurado">
          El administrador no ha creado un souvenir activo.
        </Aviso>
      ) : null}

      <form onSubmit={manejarEnvio} className="superficie p-3">
        <label htmlFor="campo-id" className="etiqueta-campo">
          ID institucional o codigo de registro
        </label>
        <div className="flex gap-2">
          <input
            id="campo-id"
            ref={inputRef}
            value={idTexto}
            onChange={(evento) => {
              const valor = evento.target.value.toUpperCase();
              setIdTexto(valor);
              if (valor.replace(/\s+/g, '').trim() !== codigoVerificado) {
                setVerificacion(null);
                setCodigoVerificado('');
              }
            }}
            className="campo flex-1 text-lg font-mono tracking-wider"
            placeholder="EST00001 o K7M4D2"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            inputMode="text"
            enterKeyHint="send"
            aria-describedby="ayuda-id"
          />
          <button
            type="button"
            className="boton-secundario px-3"
            onClick={() => void verificar(idTexto)}
            disabled={idTexto.trim().length === 0 || verificando}
            aria-label="Verificar el nombre del asistente"
            title="Verificar nombre"
          >
            <Search className="h-5 w-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="boton-secundario px-3"
            onClick={() => setEscaneando(true)}
            aria-label="Escanear codigo QR con la camara"
            title="Escanear codigo QR"
          >
            <ScanLine className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <Ayuda titulo="Que puedo escribir en este campo" className="mt-2">
          <p id="ayuda-id">
            La cedula, el codigo estudiantil o el codigo de 6 caracteres del QR (por ejemplo{' '}
            <span className="font-mono font-semibold">K7M4D2</span>). Pulse{' '}
            <span className="font-semibold">Verificar</span> para comparar el nombre con la
            escarapela antes de registrar.
          </p>
        </Ayuda>
        <div className="mt-3 flex gap-2">
          <button
            type="submit"
            className="boton-primario flex-1"
            disabled={
              enviando ||
              sinJornada ||
              sinSouvenir ||
              modulosDisponibles.length === 0 ||
              idTexto.trim().length === 0 ||
              codigoVerificado !== idTexto.replace(/\s+/g, '').trim().toUpperCase() ||
              !verificacion?.encontrado
            }
          >
            {enviando
              ? 'Registrando'
              : sinJornada
                ? 'Sin jornada activa'
                : sinRefrigerio
                  ? 'Sin refrigerio configurado'
                  : sinSouvenir
                    ? 'Sin souvenir configurado'
                    : verificacion?.encontrado && verificacion.asistente
                      ? `Registrar a ${verificacion.asistente.nombres} ${verificacion.asistente.apellidos}`
                      : 'Verifique primero el nombre'}
          </button>
          <button
            type="button"
            className="boton-secundario"
            onClick={() => setBuscando(true)}
            aria-label="Buscar asistente por nombre"
          >
            <Search className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
      </form>

      <TarjetaVerificacion
        verificacion={verificacion}
        cargando={verificando}
        jornadaId={jornadaId}
      />

      <ResultadoRegistro resultado={resultado} />

      {modo === 'souvenir' &&
      usuario?.rol === 'admin' &&
      resultado?.resultado === 'no_permitido' &&
      resultado.puedeForzar === true &&
      resultado.asistente &&
      tipoSouvenirId ? (
        <div className="superficie border border-aviso-300 p-3">
          <Aviso tono="aviso" titulo="Excepcion del administrador">
            <span className="font-semibold">
              {resultado.asistente.nombres} {resultado.asistente.apellidos}
            </span>{' '}
            no cumple la condicion del souvenir. Puede entregarlo igualmente dejando el motivo; la
            excepcion queda registrada en la auditoria y en el reporte.
          </Aviso>
          <label htmlFor="motivo-excepcion-souvenir" className="etiqueta-campo mt-3">
            Motivo de la excepcion
          </label>
          <textarea
            id="motivo-excepcion-souvenir"
            className="campo"
            rows={3}
            maxLength={500}
            value={motivoExcepcion}
            onChange={(evento) => setMotivoExcepcion(evento.target.value)}
            placeholder="Ejemplo: el celular no tenia red al registrar el ingreso de la manana."
          />
          {errorExcepcion ? (
            <p className="mt-1 text-sm text-error-600">{errorExcepcion}</p>
          ) : null}
          <button
            type="button"
            className="boton-primario mt-3 w-full"
            onClick={() => void entregarComoExcepcion()}
            disabled={enviandoExcepcion || motivoExcepcion.trim().length < 10}
          >
            <Gift className="h-4 w-4" aria-hidden="true" />
            {enviandoExcepcion ? 'Entregando' : 'Entregar souvenir como excepcion'}
          </button>
        </div>
      ) : null}

      <section aria-label="Ultimos registros">
        <h2 className="mb-2 text-sm font-semibold text-neutro-700">Ultimos registros</h2>
        {historial.length === 0 ? (
          <div className="superficie px-4 py-6 text-center text-sm text-neutro-500">
            Todavia no hay registros en esta sesion.
          </div>
        ) : (
          <ul className="superficie divide-y divide-neutro-200">
            {historial.map((entrada) => (
              <li key={entrada.id} className="flex items-start gap-3 px-3.5 py-3">
                <span className="mt-0.5">
                  {entrada.pendiente ? (
                    <WifiOff className="h-4 w-4 text-aviso-600" aria-hidden="true" />
                  ) : (
                    <UserCheck className="h-4 w-4 text-primario-600" aria-hidden="true" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-neutro-900">{entrada.nombre}</p>
                  <p className="truncate text-xs text-neutro-600">{entrada.resultado}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-mono text-xs text-neutro-700">{entrada.asistenteId}</p>
                  <p className="text-xs text-neutro-500">{formatearHora(entrada.hora)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Creditos compacto />

      <EscanerCamara
        abierto={escaneando}
        alCerrar={() => setEscaneando(false)}
        alDetectar={detectarEscaneo}
      />

      <BusquedaManual
        abierto={buscando}
        consulta={consultaManual}
        alCambiarConsulta={setConsultaManual}
        alCerrar={() => setBuscando(false)}
        alElegir={(id) => {
          setBuscando(false);
          setIdTexto(id);
          enfocarCampo();
          void verificar(id);
        }}
      />

      <AjustesOperador abierto={ajustes} alCerrar={() => setAjustes(false)} />
    </div>
  );
}

function BusquedaManual({
  abierto,
  consulta,
  alCambiarConsulta,
  alCerrar,
  alElegir,
}: {
  abierto: boolean;
  consulta: string;
  alCambiarConsulta: (valor: string) => void;
  alCerrar: () => void;
  alElegir: (id: string) => void;
}) {
  const { data, isFetching } = useQuery({
    queryKey: ['operador', 'busqueda', consulta],
    queryFn: () =>
      api.obtener<{ datos: { id: string; nombres: string; apellidos: string; rol: string }[] }>(
        `/asistentes/buscar?q=${encodeURIComponent(consulta)}`,
      ),
    enabled: abierto && consulta.trim().length >= 2,
    staleTime: 30_000,
  });

  return (
    <Modal abierto={abierto} titulo="Buscar asistente" alCerrar={alCerrar}>
      <label htmlFor="busqueda-manual" className="etiqueta-campo">
        Nombre o apellido
      </label>
      <input
        id="busqueda-manual"
        value={consulta}
        onChange={(evento) => alCambiarConsulta(evento.target.value)}
        className="campo"
        placeholder="Escriba al menos 2 caracteres"
        autoComplete="off"
      />

      <div className="mt-4 space-y-2">
        {isFetching ? (
          <>
            <Esqueleto className="h-12 w-full" />
            <Esqueleto className="h-12 w-full" />
          </>
        ) : null}
        {!isFetching && (data?.datos.length ?? 0) === 0 && consulta.trim().length >= 2 ? (
          <p className="text-sm text-neutro-600">No se encontraron asistentes con ese dato.</p>
        ) : null}
        {(data?.datos ?? []).map((asistente) => (
          <button
            key={asistente.id}
            type="button"
            className="flex w-full items-center justify-between gap-3 rounded-lg border border-neutro-200 bg-white px-3.5 py-3 text-left hover:border-primario-300"
            onClick={() => alElegir(asistente.id)}
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-neutro-900">
                {asistente.nombres} {asistente.apellidos}
              </p>
              <p className="font-mono text-xs text-neutro-600">{asistente.id}</p>
            </div>
            <Insignia tono="primario">
              {nombreRol(asistente.rol as 'estudiante' | 'docente')}
            </Insignia>
          </button>
        ))}
      </div>
    </Modal>
  );
}

function AjustesOperador({ abierto, alCerrar }: { abierto: boolean; alCerrar: () => void }) {
  const [preferencias, setPreferencias] = useState({ sonido: true, vibracion: true });

  useEffect(() => {
    if (!abierto) return;
    void import('../lib/alertas').then(({ leerPreferencias }) => {
      setPreferencias(leerPreferencias());
    });
  }, [abierto]);

  const alternar = (clave: 'sonido' | 'vibracion') => {
    const nuevas = { ...preferencias, [clave]: !preferencias[clave] };
    setPreferencias(nuevas);
    void import('../lib/alertas').then(({ guardarPreferencias }) => {
      guardarPreferencias(nuevas);
    });
    avisar(clave === 'sonido' ? 'exito' : 'aviso');
  };

  return (
    <Modal abierto={abierto} titulo="Ajustes del operador" alCerrar={alCerrar}>
      <p className="text-sm text-neutro-600">
        Preferencias guardadas en este dispositivo. No se envian al servidor.
      </p>
      <div className="mt-4 space-y-3">
        <label className="flex min-h-[48px] items-center justify-between gap-4 rounded-lg border border-neutro-200 px-3.5">
          <span className="text-sm font-medium text-neutro-800">Sonido de confirmacion</span>
          <input
            type="checkbox"
            checked={preferencias.sonido}
            onChange={() => alternar('sonido')}
            className="h-5 w-5 accent-[#12505E]"
          />
        </label>
        <label className="flex min-h-[48px] items-center justify-between gap-4 rounded-lg border border-neutro-200 px-3.5">
          <span className="text-sm font-medium text-neutro-800">Vibracion</span>
          <input
            type="checkbox"
            checked={preferencias.vibracion}
            onChange={() => alternar('vibracion')}
            className="h-5 w-5 accent-[#12505E]"
          />
        </label>
      </div>
      <p className="mt-4 flex items-start gap-2 text-xs text-neutro-500">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Sesion activa como {usuarioNombre()}.
      </p>
    </Modal>
  );
}

function usuarioNombre(): string {
  return useSesion.getState().usuario?.nombre ?? 'operador';
}
