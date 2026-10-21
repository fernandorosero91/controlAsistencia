import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  ClipboardCheck,
  Info,
  LogOut,
  Package,
  ScanLine,
  Search,
  Settings2,
  UserCheck,
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
import { Aviso, Esqueleto, Insignia, Modal } from '../componentes/comunes';

interface ContextoOperador {
  config: {
    nombre: string;
    horaFinSeminario: string;
    toleranciaMinutos: number;
    exigirAmbasJornadas: boolean;
  };
  jornadas: {
    id: number;
    nombre: string;
    inicio: string;
    fin: string;
    ventanaCheckinInicio: string;
    ventanaCheckinFin: string;
    orden: number;
  }[];
  jornadaActiva: { id: number; nombre: string } | null;
  refrigerios: { id: number; nombre: string; jornadaId: number }[];
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

const MODOS: { id: ModoRegistro; etiqueta: string; descripcion: string; Icono: typeof UserCheck }[] = [
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
    descripcion: 'Registra el cierre del semestre',
    Icono: ClipboardCheck,
  },
];

export function Operador() {
  const navegar = useNavigate();
  const cerrarSesion = useSesion((estado) => estado.cerrarSesion);

  const [modo, setModo] = useState<ModoRegistro>('ingreso');
  const [jornadaId, setJornadaId] = useState<number | null>(null);
  const [tipoRefrigerioId, setTipoRefrigerioId] = useState<number | null>(null);
  const [idTexto, setIdTexto] = useState('');
  const [resultado, setResultado] = useState<RespuestaRegistro | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [escaneando, setEscaneando] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [ajustes, setAjustes] = useState(false);
  const [historial, setHistorial] = useState<EntradaHistorial[]>([]);
  const [consultaManual, setConsultaManual] = useState('');

  const inputRef = useRef<HTMLInputElement | null>(null);
  const enLinea = useColaOffline((estado) => estado.enLinea);
  const pendientes = useColaOffline((estado) => estado.pendientes);
  const conflictos = useColaOffline((estado) => estado.conflictos);
  const refrescarCola = useColaOffline((estado) => estado.refrescar);

  const { data: contexto, isError, refetch } = useQuery({
    queryKey: ['operador', 'contexto'],
    queryFn: () => api.obtener<ContextoOperador>('/operador/contexto'),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (!contexto) return;
    if (jornadaId === null) {
      setJornadaId(contexto.jornadaActiva?.id ?? contexto.jornadas[0]?.id ?? null);
    }
    if (tipoRefrigerioId === null) {
      const refrigerio = contexto.refrigerios.find(
        (item) => item.jornadaId === (contexto.jornadaActiva?.id ?? contexto.jornadas[0]?.id),
      );
      setTipoRefrigerioId(refrigerio?.id ?? contexto.refrigerios[0]?.id ?? null);
    }
  }, [contexto, jornadaId, tipoRefrigerioId]);

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

  const registrarEnHistorial = useCallback(
    (entrada: EntradaHistorial) => {
      setHistorial((actual) => [entrada, ...actual].slice(0, 12));
    },
    [],
  );

  const enviar = useCallback(
    async (id: string, clave: string) => {
      const modoCola: TipoRegistroCola =
        modo === 'ingreso' ? 'ingreso' : modo === 'salida' ? 'salida' : 'refrigerio';

      const cuerpo =
        modo === 'refrigerio'
          ? { asistenteId: id, tipoRefrigerioId, dispositivo: 'navegador' }
          : { asistenteId: id, jornadaId, dispositivo: 'navegador' };

      const ruta =
        modo === 'ingreso'
          ? '/asistencias/ingreso'
          : modo === 'salida'
            ? '/asistencias/salida'
            : '/refrigerios/entregar';

      const registroCola: RegistroCola = {
        id: clave,
        tipo: modoCola,
        asistenteId: id,
        jornadaId: jornadaId ?? 0,
        tipoRefrigerioId: modo === 'refrigerio' ? tipoRefrigerioId : null,
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
      } catch (error) {
        if (error instanceof ErrorRed) {
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
    [
      enLinea,
      enfocarCampo,
      jornadaId,
      modo,
      refrescarCola,
      registrarEnHistorial,
      tipoRefrigerioId,
    ],
  );

  const manejarEnvio = useCallback(
    (evento?: React.FormEvent) => {
      evento?.preventDefault();
      const id = idTexto.trim();
      if (id.length === 0 || enviando) return;
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
      if (modo !== 'refrigerio' && !jornadaId) {
        setResultado({
          resultado: 'no_permitido',
          mensaje: 'No hay ninguna jornada configurada.',
          asistente: null,
          existente: null,
          requiereBusquedaManual: false,
        });
        return;
      }
      void enviar(id, nuevoClaveIdempotencia());
    },
    [enviando, enviar, idTexto, jornadaId, modo, tipoRefrigerioId],
  );

  const detectarEscaneo = useCallback(
    (texto: string) => {
      setIdTexto(texto.trim().toUpperCase());
      enfocarCampo();
    },
    [enfocarCampo],
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
              }
            : {
                asistenteId: registro.asistenteId,
                jornadaId: registro.jornadaId,
                dispositivo: 'navegador',
              };
        const ruta =
          registro.tipo === 'ingreso'
            ? '/asistencias/ingreso'
            : registro.tipo === 'salida'
              ? '/asistencias/salida'
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

  const jornadaSeleccionada = useMemo(
    () => contexto?.jornadas.find((jornada) => jornada.id === jornadaId) ?? null,
    [contexto, jornadaId],
  );

  const refrigeriosDisponibles = useMemo(
    () =>
      (contexto?.refrigerios ?? []).filter(
        (refrigerio) => refrigerio.jornadaId === jornadaId,
      ),
    [contexto, jornadaId],
  );

  if (isError) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4">
        <Aviso tono="error" titulo="Sin conexion con el servidor">
          No fue posible obtener la configuracion del seminario. Revise la conexion e intente de nuevo.
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
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-neutro-600">
            {jornadaSeleccionada ? (
              <>
                <span className="font-medium text-neutro-800">
                  Jornada: {jornadaSeleccionada.nombre}
                </span>
              </>
            ) : (
              'Sin jornada seleccionada'
            )}
          </p>
        </div>
        <div className="flex items-center gap-1">
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

      <div
        className="grid grid-cols-3 gap-2"
        role="tablist"
        aria-label="Modo de registro"
      >
        {MODOS.map(({ id, etiqueta, descripcion, Icono }) => {
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
              >                {descripcion}
              </span>
            </button>
          );
        })}
      </div>

      {contexto && contexto.jornadas.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto sin-barra-espacial pb-1">
          {contexto.jornadas.map((jornada) => (
            <button
              key={jornada.id}
              type="button"
              onClick={() => setJornadaId(jornada.id)}
              className={clsx(
                'min-h-[44px] shrink-0 rounded-2xl px-4 py-2 text-sm font-semibold transition-colors',
                jornadaId === jornada.id
                  ? 'bg-marca text-white shadow-marca'
                  : 'bg-white text-neutro-700 shadow-tarjeta',
              )}
            >
              {jornada.nombre}
            </button>
          ))}
        </div>
      ) : null}

      {modo === 'refrigerio' ? (
        <div className="flex gap-2 overflow-x-auto sin-barra-espacial pb-1">
          {refrigeriosDisponibles.length === 0 ? (
            <p className="text-sm text-neutro-600">
              No hay refrigerios configurados para la jornada seleccionada.
            </p>
          ) : (
            refrigeriosDisponibles.map((refrigerio) => (
              <button
                key={refrigerio.id}
                type="button"
                onClick={() => setTipoRefrigerioId(refrigerio.id)}
                className={clsx(
                  'min-h-[44px] shrink-0 rounded-2xl px-4 py-2 text-sm font-semibold transition-colors',
                  tipoRefrigerioId === refrigerio.id
                    ? 'bg-marca text-white shadow-marca'
                    : 'bg-white text-neutro-700 shadow-tarjeta',
                )}
              >
                {refrigerio.nombre}
              </button>
            ))
          )}
        </div>
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
            onChange={(evento) => setIdTexto(evento.target.value.toUpperCase())}
            className="campo flex-1 text-lg font-mono"
            placeholder="Ej: EST00001 o K7M4D2"
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
            onClick={() => setEscaneando(true)}
            aria-label="Escanear codigo QR con la camara"
          >
            <ScanLine className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <p id="ayuda-id" className="mt-2 text-xs text-neutro-500">
          Escriba el ID institucional (cedula o codigo estudiantil) o el codigo de registro de 6
          caracteres que viene en el QR. El campo queda listo para el siguiente.
        </p>
        <div className="mt-3 flex gap-2">
          <button
            type="submit"
            className="boton-primario flex-1"
            disabled={enviando || idTexto.trim().length === 0}
          >
            {enviando ? 'Registrando' : 'Registrar'}
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

      <ResultadoRegistro resultado={resultado} />

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
            <Insignia tono="primario">{nombreRol(asistente.rol as 'estudiante' | 'docente')}</Insignia>
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
