import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { Firmante } from '@seminario/shared';
import { CalendarClock, Pencil, Plus, Save, ShieldAlert, Timer, Trash2 } from 'lucide-react';
import { api, ErrorPeticion } from '../../lib/api';
import { formatearFechaHora } from '../../lib/formato';
import { useSesion } from '../../estado/sesion';
import { Ayuda, Aviso, EsqueletoTarjeta, Insignia, Modal, Tarjeta } from '../../componentes/comunes';

const esquema = z.object({
  nombre: z.string().trim().min(3, 'El nombre es obligatorio').max(160),
  fecha: z.string().min(8, 'Indique la fecha del seminario'),
  horaFinSeminario: z.string().min(8, 'Indique la hora de fin'),
  toleranciaMinutos: z.coerce.number().int().min(0).max(240),
  exigirAmbasJornadas: z.boolean(),
  intensidadHoraria: z.coerce.number().int().min(1).max(24),
  minimoPermanenciaHoras: z.coerce.number().int().min(0).max(12),
  permitirRegistroFueraDeVentana: z.boolean(),
  lugar: z.string().trim().max(160).optional(),
  facultad: z.string().trim().max(160).optional(),
  contacto: z.string().trim().max(80).optional(),
  textoEncabezado: z.string().max(200).optional(),
  textoCierre: z.string().max(600).optional(),
  firmaNombre: z.string().max(120).optional(),
  firmaCargo: z.string().max(120).optional(),
  idRegex: z.string().min(1, 'La expresion regular es obligatoria').max(120),
  urlPublica: z.string().optional(),
});

type DatosConfig = z.infer<typeof esquema>;

interface Jornada {
  id: number;
  nombre: string;
  inicio: string;
  fin: string;
  ventanaCheckinInicio: string;
  ventanaCheckinFin: string;
  orden: number;
}

interface TipoRefrigerio {
  id: number;
  nombre: string;
  jornadaId: number;
  activo: boolean;
  orden: number;
}

function aLocal(iso: string): string {
  const fecha = new Date(iso);
  const desfase = fecha.getTimezoneOffset() * 60_000;
  return new Date(fecha.getTime() - desfase).toISOString().slice(0, 16);
}

const FIRMA_CAMPOS = ['Firmante 1', 'Firmante 2', 'Firmante 3'];

export function Configuracion() {
  const cliente = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [nuevaJornada, setNuevaJornada] = useState(false);
  const [nuevoRefrigerio, setNuevoRefrigerio] = useState(false);
  const [jornadaEnEdicion, setJornadaEnEdicion] = useState<Jornada | null>(null);
  const [jornadaAEliminar, setJornadaAEliminar] = useState<Jornada | null>(null);
  const [forzarEliminar, setForzarEliminar] = useState(false);
  const [errorJornada, setErrorJornada] = useState<string | null>(null);
  const [refrigerioEnEdicion, setRefrigerioEnEdicion] = useState<TipoRefrigerio | null>(null);
  const [firmas, setFirmas] = useState<Firmante[]>([]);

  const actualizarFirmante = (indice: number, campo: keyof Firmante, valor: string) => {
    setFirmas((actual) => {
      const copia = [...actual];
      while (copia.length <= indice) copia.push({ nombre: '', cargo: '', entidad: '' });
      copia[indice] = { ...copia[indice]!, [campo]: valor };
      return copia;
    });
  };

  const { data: config, isPending } = useQuery({
    queryKey: ['config'],
    queryFn: () => api.obtener<DatosConfig & { fecha: string; firmas: Firmante[] }>('/config'),
  });

  const { data: jornadas } = useQuery({
    queryKey: ['jornadas'],
    queryFn: () => api.obtener<{ jornadas: Jornada[] }>('/jornadas'),
  });

  const { data: refrigerios } = useQuery({
    queryKey: ['refrigerios', 'tipos'],
    queryFn: () => api.obtener<{ tipos: TipoRefrigerio[] }>('/refrigerios/tipos'),
  });

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isDirty },
  } = useForm<DatosConfig>({
    resolver: zodResolver(esquema),
    defaultValues: {
      nombre: '',
      fecha: '',
      horaFinSeminario: '',
      toleranciaMinutos: 15,
      exigirAmbasJornadas: true,
      intensidadHoraria: 8,
      minimoPermanenciaHoras: 3,
      permitirRegistroFueraDeVentana: false,
      lugar: '',
      facultad: '',
      contacto: '',
      textoEncabezado: '',
      textoCierre: '',
      firmaNombre: '',
      firmaCargo: '',
      idRegex: '^[A-Z0-9]{4,20}$',
      urlPublica: '',
    },
  });

  useEffect(() => {
    if (!config) return;
    reset({
      nombre: config.nombre,
      fecha: String(config.fecha).slice(0, 10),
      horaFinSeminario: aLocal(config.horaFinSeminario),
      toleranciaMinutos: config.toleranciaMinutos,
      exigirAmbasJornadas: config.exigirAmbasJornadas,
      intensidadHoraria: config.intensidadHoraria,
      minimoPermanenciaHoras: config.minimoPermanenciaHoras,
      permitirRegistroFueraDeVentana: config.permitirRegistroFueraDeVentana,
      lugar: config.lugar ?? '',
      facultad: config.facultad ?? '',
      contacto: config.contacto ?? '',
      textoEncabezado: config.textoEncabezado ?? '',
      textoCierre: config.textoCierre ?? '',
      firmaNombre: config.firmaNombre ?? '',
      firmaCargo: config.firmaCargo ?? '',
      idRegex: config.idRegex,
      urlPublica: config.urlPublica ?? '',
    });
    setFirmas(config.firmas ?? []);
  }, [config, reset]);

  const guardar = useMutation({
    mutationFn: async (datos: DatosConfig) =>      api.reemplazar('/config', {
        ...datos,
        fecha: new Date(`${datos.fecha}T12:00:00`).toISOString(),
        horaFinSeminario: new Date(datos.horaFinSeminario).toISOString(),
        urlPublica: datos.urlPublica?.trim() || undefined,
        firmas: firmas
          .filter((firma) => firma.nombre.trim().length >= 3 && firma.cargo.trim().length >= 3)
          .map((firma) => ({
            nombre: firma.nombre.trim(),
            cargo: firma.cargo.trim(),
            entidad: (firma.entidad ?? '').trim(),
          })),
      }),
    onSuccess: () => {
      setError(null);
      setExito('La configuracion se guardo. La elegibilidad se recalcula de inmediato.');
      void cliente.invalidateQueries({ queryKey: ['config'] });
    },
    onError: (problema) => {
      setExito(null);
      setError(
        problema instanceof ErrorPeticion
          ? problema.message
          : 'No se pudo guardar la configuracion',
      );
    },
  });

  const eliminarJornada = useMutation({
    mutationFn: async (datos: { id: number; forzar: boolean }) =>
      api.eliminar(`/jornadas/${datos.id}${datos.forzar ? '?forzar=true' : ''}`),
    onSuccess: () => {
      setErrorJornada(null);
      setJornadaAEliminar(null);
      setForzarEliminar(false);
      setExito('La jornada se elimino.');
      void cliente.invalidateQueries({ queryKey: ['jornadas'] });
      void cliente.invalidateQueries({ queryKey: ['config'] });
      void cliente.invalidateQueries({ queryKey: ['operador', 'contexto'] });
    },
    onError: (problema) => {
      setExito(null);
      setErrorJornada(
        problema instanceof ErrorPeticion
          ? problema.message
          : 'No se pudo eliminar la jornada. Intente de nuevo.',
      );
      void cliente.invalidateQueries({ queryKey: ['jornadas'] });
    },
  });

  if (isPending) {
    return (
      <div className="grid gap-3 lg:grid-cols-2">
        <EsqueletoTarjeta lineas={6} />
        <EsqueletoTarjeta lineas={6} />
      </div>
    );
  }

  const exigeAmbas = watch('exigirAmbasJornadas');

  return (
    <div className="space-y-4">
      {' '}
      <form onSubmit={handleSubmit((datos) => guardar.mutate(datos))}>
        <div className="grid gap-4 lg:grid-cols-2">
          <Tarjeta
            titulo="Datos del seminario"
            descripcion="Informacion que aparece en el certificado"
          >
            <div className="space-y-4">
              <div>
                <label htmlFor="nombre" className="etiqueta-campo">
                  Nombre del seminario
                </label>
                <input id="nombre" className="campo" {...register('nombre')} />
                {errors.nombre ? (
                  <p className="mt-1 text-sm text-error-600">{errors.nombre.message}</p>
                ) : null}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="fecha" className="etiqueta-campo">
                    Fecha
                  </label>
                  <input id="fecha" type="date" className="campo" {...register('fecha')} />
                  {errors.fecha ? (
                    <p className="mt-1 text-sm text-error-600">{errors.fecha.message}</p>
                  ) : null}
                </div>
                <div>
                  <label htmlFor="intensidadHoraria" className="etiqueta-campo">
                    Intensidad horaria
                  </label>
                  <input
                    id="intensidadHoraria"
                    type="number"
                    min={1}
                    max={24}
                    className="campo"
                    {...register('intensidadHoraria')}
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="lugar" className="etiqueta-campo">
                    Lugar del evento
                  </label>
                  <input id="lugar" className="campo" {...register('lugar')} />
                </div>
                <div>
                  <label htmlFor="facultad" className="etiqueta-campo">
                    Facultad o dependencia
                  </label>
                  <input id="facultad" className="campo" {...register('facultad')} />
                </div>
              </div>

              <div>
                <label htmlFor="minimoPermanenciaHoras" className="etiqueta-campo">
                  Permanencia minima por jornada (horas)
                </label>
                <input
                  id="minimoPermanenciaHoras"
                  type="number"
                  min={0}
                  max={12}
                  className="campo"
                  {...register('minimoPermanenciaHoras', { valueAsNumber: true })}
                />
                <Ayuda titulo="Como se aplica la permanencia minima" className="mt-2">
                  El asistente debe permanecer ese numero de horas en cada jornada exigida para que
                  sea elegible para el certificado. Con 0 la regla no se aplica.
                </Ayuda>
                {errors.minimoPermanenciaHoras ? (
                  <p className="mt-1 text-sm text-error-600">
                    {errors.minimoPermanenciaHoras.message}
                  </p>
                ) : null}
              </div>

              <div>
                <label htmlFor="contacto" className="etiqueta-campo">
                  Contacto para informacion
                </label>
                <input id="contacto" className="campo" {...register('contacto')} />
              </div>

              <div>
                <label htmlFor="textoEncabezado" className="etiqueta-campo">
                  Texto del encabezado del certificado
                </label>
                <textarea
                  id="textoEncabezado"
                  className="campo min-h-[80px]"
                  {...register('textoEncabezado')}
                />
              </div>

              <div>
                <label htmlFor="textoCierre" className="etiqueta-campo">
                  Texto de cierre del certificado
                </label>
                <textarea
                  id="textoCierre"
                  className="campo min-h-[80px]"
                  {...register('textoCierre')}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="firmaNombre" className="etiqueta-campo">
                    Nombre de la firma
                  </label>
                  <input id="firmaNombre" className="campo" {...register('firmaNombre')} />
                </div>
                <div>
                  <label htmlFor="firmaCargo" className="etiqueta-campo">
                    Cargo de quien firma
                  </label>
                  <input id="firmaCargo" className="campo" {...register('firmaCargo')} />
                </div>
              </div>

              <div className="rounded-2xl bg-neutro-50 p-4">
                <p className="text-sm font-semibold text-neutro-800">Firmantes del certificado</p>
                <p className="mt-0.5 text-xs text-neutro-600">
                  Hasta tres personas firman el certificado. Deje en blanco los que no correspondan.
                </p>
                <div className="mt-3 space-y-3">
                  {FIRMA_CAMPOS.map((etiqueta, indice) => (
                    <div key={etiqueta} className="grid gap-2 sm:grid-cols-3">
                      <input
                        className="campo"
                        placeholder={`${etiqueta} - nombre`}
                        aria-label={`${etiqueta}: nombre de quien firma`}
                        value={firmas[indice]?.nombre ?? ''}
                        onChange={(evento) =>
                          actualizarFirmante(indice, 'nombre', evento.target.value)
                        }
                      />
                      <input
                        className="campo"
                        placeholder="Cargo"
                        aria-label={`${etiqueta}: cargo`}
                        value={firmas[indice]?.cargo ?? ''}
                        onChange={(evento) =>
                          actualizarFirmante(indice, 'cargo', evento.target.value)
                        }
                      />
                      <input
                        className="campo"
                        placeholder="Dependencia (opcional)"
                        aria-label={`${etiqueta}: dependencia`}
                        value={firmas[indice]?.entidad ?? ''}
                        onChange={(evento) =>
                          actualizarFirmante(indice, 'entidad', evento.target.value)
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Tarjeta>

          <Tarjeta
            titulo="Reglas de asistencia y elegibilidad"
            descripcion="Estos valores se aplican de inmediato a todos los asistentes"
          >
            <div className="space-y-4">
              <div>
                <label htmlFor="horaFinSeminario" className="etiqueta-campo">
                  Hora de fin del seminario
                </label>
                <input
                  id="horaFinSeminario"
                  type="datetime-local"
                  className="campo"
                  {...register('horaFinSeminario')}
                />
                <p className="mt-1 text-xs text-neutro-500">
                  Quien haya registrado su salida a partir de esta hora (menos la tolerancia) es
                  elegible para el certificado.
                </p>
                {errors.horaFinSeminario ? (
                  <p className="mt-1 text-sm text-error-600">{errors.horaFinSeminario.message}</p>
                ) : null}
              </div>

              <div>
                <label htmlFor="toleranciaMinutos" className="etiqueta-campo">
                  Tolerancia en minutos
                </label>
                <input
                  id="toleranciaMinutos"
                  type="number"
                  min={0}
                  max={240}
                  className="campo"
                  {...register('toleranciaMinutos')}
                />
              </div>

              <label className="flex min-h-[48px] items-start gap-3 rounded-lg border border-neutro-200 px-3.5 py-3">
                <input
                  type="checkbox"
                  className="mt-0.5 h-5 w-5 accent-[#12505E]"
                  {...register('exigirAmbasJornadas')}
                />
                <span>
                  <span className="block text-sm font-medium text-neutro-900">
                    Exigir asistencia en ambas jornadas
                  </span>
                  <span className="block text-xs text-neutro-600">
                    {exigeAmbas
                      ? 'Al desactivarlo, basta con la asistencia y el cierre de la jornada final.'
                      : 'Ahora mismo solo se exige la asistencia y el cierre de la jornada final.'}
                  </span>
                </span>
              </label>

              <label className="flex min-h-[48px] items-start gap-3 rounded-lg border border-neutro-200 px-3.5 py-3">
                <input
                  type="checkbox"
                  className="mt-0.5 h-5 w-5 accent-[#12505E]"
                  {...register('permitirRegistroFueraDeVentana')}
                />
                <span>
                  <span className="block text-sm font-medium text-neutro-900">
                    Permitir registro fuera de la ventana
                  </span>
                  <span className="block text-xs text-neutro-600">
                    Util solo para eventos con filas o delays. Queda registrado en la auditoria.
                  </span>
                </span>
              </label>

              <div>
                <label htmlFor="idRegex" className="etiqueta-campo">
                  Formato del ID institucional
                </label>
                <input id="idRegex" className="campo font-mono" {...register('idRegex')} />
                <p className="mt-1 text-xs text-neutro-500">
                  Expresion regular aplicada al ID en la app del operador y en la importacion.
                </p>
                {errors.idRegex ? (
                  <p className="mt-1 text-sm text-error-600">{errors.idRegex.message}</p>
                ) : null}
              </div>

              <div>
                <label htmlFor="urlPublica" className="etiqueta-campo">
                  URL publica de verificacion
                </label>
                <input
                  id="urlPublica"
                  className="campo"
                  placeholder="https://seminario.universidad.edu.co"
                  {...register('urlPublica')}
                />
              </div>
            </div>
          </Tarjeta>
        </div>

        {error ? (
          <div className="mt-4">
            <Aviso tono="error">{error}</Aviso>
          </div>
        ) : null}
        {exito ? (
          <div className="mt-4">
            <Aviso tono="exito">{exito}</Aviso>
          </div>
        ) : null}

        <div className="mt-4 flex justify-end">
          <button type="submit" className="boton-primario" disabled={guardar.isPending || !isDirty}>
            <Save className="h-4 w-4" aria-hidden="true" />
            {guardar.isPending ? 'Guardando' : 'Guardar configuracion'}
          </button>
        </div>
      </form>
      <div className="grid gap-4 lg:grid-cols-2">
        <Tarjeta
          titulo="Jornadas"
          descripcion="Ventanas de registro de cada jornada"
          accion={
            <button
              type="button"
              className="boton-secundario"
              onClick={() => setNuevaJornada(true)}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Nueva jornada
            </button>
          }
        >
          <ul className="space-y-2">
            {(jornadas?.jornadas ?? []).map((jornada) => (
              <li key={jornada.id} className="rounded-lg border border-neutro-200 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-neutro-900">{jornada.nombre}</p>
                  <div className="flex items-center gap-1">
                    <Insignia tono="primario">Orden {jornada.orden}</Insignia>
                    <button
                      type="button"
                      className="boton-compacto text-neutro-600 hover:bg-neutro-100"
                      onClick={() => setJornadaEnEdicion(jornada)}
                      aria-label={`Editar la jornada ${jornada.nombre}`}
                      title="Editar jornada"
                    >
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="boton-compacto text-error-600 hover:bg-error-100"
                      onClick={() => {
                        setJornadaAEliminar(jornada);
                        setForzarEliminar(false);
                        setErrorJornada(null);
                      }}
                      aria-label={`Eliminar la jornada ${jornada.nombre}`}
                      title="Eliminar jornada"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-neutro-600">
                  <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                  {formatearFechaHora(jornada.inicio)} a {formatearFechaHora(jornada.fin)}
                </p>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-neutro-600">
                  <Timer className="h-3.5 w-3.5" aria-hidden="true" />
                  Registro abierto de {formatearFechaHora(jornada.ventanaCheckinInicio)} a{' '}
                  {formatearFechaHora(jornada.ventanaCheckinFin)}
                </p>
              </li>
            ))}
            {(jornadas?.jornadas.length ?? 0) === 0 ? (
              <li className="text-sm text-neutro-600">No hay jornadas configuradas.</li>
            ) : null}
          </ul>
        </Tarjeta>

        <Tarjeta
          titulo="Refrigerios"
          descripcion="Tipos de refrigerio disponibles por jornada"
          accion={
            <button
              type="button"
              className="boton-secundario"
              onClick={() => setNuevoRefrigerio(true)}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Nuevo refrigerio
            </button>
          }
        >
          <ul className="space-y-2">
            {(refrigerios?.tipos ?? []).map((tipo) => {
              const jornada = (jornadas?.jornadas ?? []).find((item) => item.id === tipo.jornadaId);
              return (
                <li
                  key={tipo.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-neutro-200 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-neutro-900">{tipo.nombre}</p>
                    <p className="truncate text-xs text-neutro-600">
                      {jornada?.nombre ?? 'Sin jornada'} - Orden {tipo.orden}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {tipo.activo ? (
                      <Insignia tono="exito">Activo</Insignia>
                    ) : (
                      <Insignia tono="neutro">Inactivo</Insignia>
                    )}
                    <button
                      type="button"
                      className="boton-compacto text-neutro-600 hover:bg-neutro-100"
                      onClick={() => setRefrigerioEnEdicion(tipo)}
                      aria-label={`Editar el refrigerio ${tipo.nombre}`}
                      title="Editar refrigerio"
                    >
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </li>
              );
            })}
            {(refrigerios?.tipos.length ?? 0) === 0 ? (
              <li className="text-sm text-neutro-600">No hay refrigerios configurados.</li>
            ) : null}
          </ul>
        </Tarjeta>
      </div>
      <AccesosOperador jornadas={jornadas?.jornadas ?? []} />
      <Souvenirs />
      <Mantenimiento />
      <Modal
        abierto={nuevaJornada || jornadaEnEdicion !== null}
        titulo={jornadaEnEdicion ? 'Editar jornada' : 'Nueva jornada'}
        alCerrar={() => {
          setNuevaJornada(false);
          setJornadaEnEdicion(null);
        }}
      >
        <FormularioJornada
          inicial={jornadaEnEdicion ?? undefined}
          etiqueta={jornadaEnEdicion ? 'Guardar cambios' : 'Crear jornada'}
          alGuardar={async (datos) => {
            if (jornadaEnEdicion) {
              await api.actualizar(`/jornadas/${jornadaEnEdicion.id}`, datos);
            } else {
              await api.crear('/jornadas', datos);
            }
            setNuevaJornada(false);
            setJornadaEnEdicion(null);
            void cliente.invalidateQueries({ queryKey: ['jornadas'] });
            void cliente.invalidateQueries({ queryKey: ['operador', 'contexto'] });
          }}
        />
      </Modal>
      <Modal
        abierto={jornadaAEliminar !== null}
        titulo="Eliminar jornada"
        alCerrar={() => {
          if (eliminarJornada.isPending) return;
          setJornadaAEliminar(null);
          setErrorJornada(null);
        }}
      >
        <Aviso
          tono="error"
          titulo={`Se eliminara la jornada "${jornadaAEliminar?.nombre ?? ''}"`}
        >
          Esta accion no se puede deshacer. Si la jornada tiene asistencias o refrigerios ligados,
          se deben borrar tambien.
        </Aviso>

        <label className="mt-4 flex items-start gap-3 rounded-lg border border-neutro-200 p-3">
          <input
            type="checkbox"
            checked={forzarEliminar}
            onChange={(evento) => setForzarEliminar(evento.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 accent-[#12505E]"
          />
          <span>
            <span className="block text-sm font-semibold text-neutro-800">
              Eliminar tambien sus asistencias y sus tipos de refrigerio
            </span>
            <span className="block text-xs text-neutro-500">
              Marque esta casilla solo si la jornada ya tiene registros que desea borrar. Queda
              auditado.
            </span>
          </span>
        </label>

        {errorJornada ? (
          <div className="mt-3">
            <Aviso tono="error">{errorJornada}</Aviso>
          </div>
        ) : null}

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            className="boton-secundario"
            onClick={() => {
              setJornadaAEliminar(null);
              setErrorJornada(null);
            }}
            disabled={eliminarJornada.isPending}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="boton-peligro"
            onClick={() => {
              if (!jornadaAEliminar) return;
              eliminarJornada.mutate({ id: jornadaAEliminar.id, forzar: forzarEliminar });
            }}
            disabled={eliminarJornada.isPending}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            {eliminarJornada.isPending ? 'Eliminando' : 'Eliminar jornada'}
          </button>
        </div>
      </Modal>
      <Modal
        abierto={nuevoRefrigerio || refrigerioEnEdicion !== null}
        titulo={refrigerioEnEdicion ? 'Editar refrigerio' : 'Nuevo refrigerio'}
        alCerrar={() => {
          setNuevoRefrigerio(false);
          setRefrigerioEnEdicion(null);
        }}
      >
        <FormularioRefrigerio
          jornadas={jornadas?.jornadas ?? []}
          inicial={refrigerioEnEdicion ?? undefined}
          etiqueta={refrigerioEnEdicion ? 'Guardar cambios' : 'Crear refrigerio'}
          alGuardar={async (datos) => {
            if (refrigerioEnEdicion) {
              await api.actualizar(`/refrigerios/tipos/${refrigerioEnEdicion.id}`, datos);
            } else {
              await api.crear('/refrigerios/tipos', datos);
            }
            setNuevoRefrigerio(false);
            setRefrigerioEnEdicion(null);
            void cliente.invalidateQueries({ queryKey: ['refrigerios', 'tipos'] });
            void cliente.invalidateQueries({ queryKey: ['operador', 'contexto'] });
          }}
        />
      </Modal>
      <Ayuda titulo="Cuando se recalculan los certificados">
        La elegibilidad de los certificados se recalcula con estos valores en cada consulta, sin
        necesidad de migraciones ni scripts.
      </Ayuda>
    </div>
  );
}

interface DatosAccesos {
  operadorIngresoHabilitado: boolean;
  operadorRefrigerioHabilitado: boolean;
  operadorSalidaHabilitado: boolean;
  operadorSouvenirHabilitado: boolean;
  margenCierreMinutos: number;
  jornadaForzadaId: number | null;
}

type ClaveModulo =
  | 'operadorIngresoHabilitado'
  | 'operadorRefrigerioHabilitado'
  | 'operadorSalidaHabilitado'
  | 'operadorSouvenirHabilitado';

const MODULOS_OPERADOR: { clave: ClaveModulo; titulo: string; descripcion: string }[] = [
  {
    clave: 'operadorIngresoHabilitado',
    titulo: 'Ingreso',
    descripcion: 'Registrar la entrada a la jornada',
  },
  {
    clave: 'operadorRefrigerioHabilitado',
    titulo: 'Refrigerio',
    descripcion: 'Entregar el refrigerio de la jornada',
  },
  {
    clave: 'operadorSalidaHabilitado',
    titulo: 'Salida',
    descripcion: 'Registrar la salida de la jornada',
  },
  {
    clave: 'operadorSouvenirHabilitado',
    titulo: 'Souvenir',
    descripcion: 'Entregar el souvenir o regalo del seminario',
  },
];

function horaCorta(iso: string): string {
  return new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

/**
 * Controla lo que ve el operador. La jornada se deduce sola del horario: aqui
 * solo se decide que modulos existen y, en caso de contingencia, cual es la
 * jornada en curso.
 */
function AccesosOperador({ jornadas }: { jornadas: Jornada[] }) {
  const cliente = useQueryClient();
  const [accesos, setAccesos] = useState<DatosAccesos | null>(null);
  const [servidor, setServidor] = useState<DatosAccesos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const { data: config } = useQuery({
    queryKey: ['config'],
    queryFn: () => api.obtener<DatosAccesos>('/config'),
  });

  const { data: contexto } = useQuery({
    queryKey: ['operador', 'contexto'],
    queryFn: () =>
      api.obtener<{
        jornadaActiva: { id: number; nombre: string; inicio: string; fin: string } | null;
      }>('/operador/contexto'),
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (!config) return;
    const valores: DatosAccesos = {
      operadorIngresoHabilitado: config.operadorIngresoHabilitado,
      operadorRefrigerioHabilitado: config.operadorRefrigerioHabilitado,
      operadorSalidaHabilitado: config.operadorSalidaHabilitado,
      operadorSouvenirHabilitado: config.operadorSouvenirHabilitado,
      margenCierreMinutos: config.margenCierreMinutos,
      jornadaForzadaId: config.jornadaForzadaId ?? null,
    };
    setServidor(valores);
    setAccesos(valores);
  }, [config]);

  const guardar = useMutation({
    mutationFn: (datos: Partial<DatosAccesos>) => api.actualizar('/config/operador', datos),
    onSuccess: () => {
      setError(null);
      setMensaje('Cambio aplicado. La app del operador lo ve de inmediato.');
      void cliente.invalidateQueries({ queryKey: ['config'] });
      void cliente.invalidateQueries({ queryKey: ['operador', 'contexto'] });
    },
    onError: (problema) => {
      setMensaje(null);
      setError(
        problema instanceof ErrorPeticion
          ? problema.message
          : 'No se pudo aplicar el cambio. Intente de nuevo.',
      );
      void cliente.invalidateQueries({ queryKey: ['config'] });
    },
  });

  /**
   * El valor se toma del evento, no del estado: React dispara el `onChange` de
   * un checkbox controlado cuando corrige el valor tras cargar los datos, y en
   * ese caso el estado y el evento coinciden. Si no coincide con lo que ya
   * tiene el servidor, no se envia nada.
   */
  const alternar = (clave: ClaveModulo, marcado: boolean) => {
    if (!accesos || !servidor) return;
    if (accesos[clave] === marcado) return;
    if (servidor[clave] === marcado) {
      setAccesos({ ...accesos, [clave]: marcado });
      return;
    }
    setAccesos({ ...accesos, [clave]: marcado });
    guardar.mutate({ [clave]: marcado });
  };

  return (
    <Tarjeta
      titulo="Accesos del operador"
      descripcion="Lo que el operador puede hacer desde el celular"
    >
      <Ayuda titulo="Como funciona la jornada y los interruptores">
        La jornada no la elige el operador: se deduce del horario de cada jornada. Lo que apague
        aqui desaparece de la app del operador, y la API tambien lo rechaza.
      </Ayuda>

      <div className="mt-4 space-y-3">
        {MODULOS_OPERADOR.map((modulo) => (
          <label
            key={modulo.clave}
            className="flex min-h-[48px] items-center justify-between gap-4 rounded-lg border border-neutro-200 px-3.5"
          >
            <span className="min-w-0">
              <span className="block text-sm font-medium text-neutro-800">{modulo.titulo}</span>
              <span className="block text-xs text-neutro-500">{modulo.descripcion}</span>
            </span>
            <input
              type="checkbox"
              checked={accesos ? accesos[modulo.clave] : false}
              disabled={!accesos}
              onChange={(evento) => alternar(modulo.clave, evento.target.checked)}
              className="h-5 w-5 shrink-0 accent-[#12505E]"
              aria-label={`Habilitar ${modulo.titulo.toLowerCase()} en la app del operador`}
            />
          </label>
        ))}
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="jornada-forzada" className="etiqueta-campo">
            Jornada en curso
          </label>
          <select
            id="jornada-forzada"
            className="campo"
            value={accesos?.jornadaForzadaId ?? ''}
            onChange={(evento) => {
              if (!accesos) return;
              setAccesos({
                ...accesos,
                jornadaForzadaId: evento.target.value === '' ? null : Number(evento.target.value),
              });
            }}
          >
            <option value="">Automatica (segun el horario)</option>
            {jornadas.map((jornada) => (
              <option key={jornada.id} value={jornada.id}>
                {jornada.nombre}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-neutro-500">
            Fijela solo si el evento se corre o se adelanta. En automatico el sistema usa la
            jornada del horario.
          </p>
        </div>

        <div>
          <label htmlFor="margen-cierre" className="etiqueta-campo">
            Minutos de margen despues del cierre
          </label>
          <input
            id="margen-cierre"
            type="number"
            min={0}
            max={180}
            className="campo"
            value={accesos?.margenCierreMinutos ?? 20}
            onChange={(evento) => {
              if (!accesos) return;
              setAccesos({ ...accesos, margenCierreMinutos: Number(evento.target.value) });
            }}
          />
          <p className="mt-1 text-xs text-neutro-500">
            Tiempo en el que la jornada sigue vigente para registrar las salidas.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="boton-primario"
          disabled={guardar.isPending || !accesos}
          onClick={() => {
            if (!accesos || !servidor) return;
            if (
              servidor.jornadaForzadaId === accesos.jornadaForzadaId &&
              servidor.margenCierreMinutos === accesos.margenCierreMinutos
            ) {
              return;
            }
            guardar.mutate({
              jornadaForzadaId: accesos.jornadaForzadaId,
              margenCierreMinutos: accesos.margenCierreMinutos,
            });
          }}
        >
          <Save className="h-4 w-4" aria-hidden="true" />
          {guardar.isPending ? 'Guardando' : 'Guardar jornada y margen'}
        </button>
        {contexto?.jornadaActiva ? (
          <Insignia tono="exito">
            Ahora: {contexto.jornadaActiva.nombre} ({horaCorta(contexto.jornadaActiva.inicio)} a{' '}
            {horaCorta(contexto.jornadaActiva.fin)})
          </Insignia>
        ) : (
          <Insignia tono="neutro">Ahora: no hay jornada activa</Insignia>
        )}
      </div>

      {error ? (
        <div className="mt-3">
          <Aviso tono="error">{error}</Aviso>
        </div>
      ) : null}
      {mensaje ? (
        <div className="mt-3">
          <Aviso tono="exito">{mensaje}</Aviso>
        </div>
      ) : null}
    </Tarjeta>
  );
}

/**
 * Limpieza de los datos operativos para volver a probar el sistema.
 *
 * Es la unica accion destructiva del panel: exige la contrasena del
 * administrador y escribir una frase exacta. Se conservan la configuracion, las
 * jornadas, los refrigerios y las cuentas.
 */
function Mantenimiento() {
  const cliente = useQueryClient();
  const sesion = useSesion((estado) => estado.usuario);
  const [abierto, setAbierto] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [borradas, setBorradas] = useState<Record<string, number> | null>(null);

  interface ResumenDatos {
    asistentes: number;
    asistencias: number;
    entregas: number;
    certificados: number;
    lotes: number;
    auditoria: number;
    idempotencia: number;
    fraseConfirmacion: string;
    habilitado: boolean;
  }

  const { data: resumen } = useQuery({
    queryKey: ['mantenimiento', 'resumen'],
    queryFn: () => api.obtener<ResumenDatos>('/mantenimiento/resumen'),
  });

  const limpiar = useMutation({
    mutationFn: () =>
      api.crear<{ mensaje: string; filasBorradas: Record<string, number> }>(
        '/mantenimiento/limpiar',
        { password, confirmacion },
      ),
    onSuccess: (datos) => {
      setError(null);
      setMensaje(datos.mensaje);
      setBorradas(datos.filasBorradas);
      setAbierto(false);
      setPassword('');
      setConfirmacion('');
      void cliente.invalidateQueries();
    },
    onError: (problema) => {
      setMensaje(null);
      setError(
        problema instanceof ErrorPeticion
          ? problema.message
          : 'No se pudo limpiar la base de datos. Intente de nuevo.',
      );
    },
  });

  const frase = resumen?.fraseConfirmacion ?? 'BORRAR TODOS LOS DATOS';
  const puedeBorrar = password.length > 0 && confirmacion.trim() === frase && !limpiar.isPending;

  const cifras = [
    { etiqueta: 'Asistentes', valor: resumen?.asistentes ?? 0 },
    { etiqueta: 'Asistencias', valor: resumen?.asistencias ?? 0 },
    { etiqueta: 'Refrigerios', valor: resumen?.entregas ?? 0 },
    { etiqueta: 'Certificados', valor: resumen?.certificados ?? 0 },
  ];

  return (
    <Tarjeta
      titulo="Mantenimiento de la base de datos"
      descripcion="Solo para pruebas: borra los datos operativos y deja el sistema en cero"
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {cifras.map((cifra) => (
          <div key={cifra.etiqueta} className="rounded-lg border border-neutro-200 px-3 py-2">
            <p className="text-xs text-neutro-500">{cifra.etiqueta}</p>
            <p className="font-mono text-lg font-bold text-primario-900">{cifra.valor}</p>
          </div>
        ))}
      </div>

      <Ayuda titulo="Que se borra y que se conserva" className="mt-3">
        Borra el padron, las asistencias, los refrigerios entregados, los certificados, los lotes
        de certificados (PDF y Word), la auditoria y los registros de idempotencia.{' '}
        <strong>Se conservan</strong> la configuracion del seminario, las jornadas, los
        refrigerios configurados, las plantillas de certificado y las cuentas de usuario.
      </Ayuda>

      <div className="mt-4">
        <button
          type="button"
          className="boton-peligro"
          onClick={() => {
            setError(null);
            setMensaje(null);
            setAbierto(true);
          }}
          disabled={!resumen?.habilitado}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          Borrar todos los datos
        </button>
        {resumen && !resumen.habilitado ? (
          <p className="mt-2 text-xs text-neutro-500">
            La limpieza esta deshabilitada en este servidor (variable LIMPIAR_BASE_HABILITADO).
          </p>
        ) : null}
      </div>

      {mensaje ? (
        <div className="mt-3">
          <Aviso tono="exito" titulo="Base de datos limpia">
            {mensaje}
            {borradas ? (
              <span className="mt-1 block text-xs text-neutro-600">
                Borrados: {borradas.asistentes ?? 0} asistentes, {borradas.asistencias ?? 0}{' '}
                asistencias, {borradas.entregas ?? 0} refrigerios, {borradas.certificados ?? 0}{' '}
                certificados, {borradas.auditoria ?? 0} registros de auditoria.
              </span>
            ) : null}
          </Aviso>
        </div>
      ) : null}

      <Modal
        abierto={abierto}
        titulo="Borrar todos los datos"
        alCerrar={() => {
          if (limpiar.isPending) return;
          setAbierto(false);
          setError(null);
        }}
      >
        <Aviso tono="error" titulo="Esta operacion no se puede deshacer">
          Se borraran {resumen?.asistentes ?? 0} asistentes con sus asistencias,{' '}
          {resumen?.entregas ?? 0} refrigerios entregados, {resumen?.certificados ?? 0}{' '}
          certificados y el historial de auditoria.
        </Aviso>

        <div className="mt-4 flex items-start gap-2 rounded-lg border border-error-200 bg-error-100/40 px-3.5 py-3">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-error-600" aria-hidden="true" />
          <p className="text-xs text-neutro-700">
            Se conservan la configuracion del seminario, las jornadas, los refrigerios configurados
            y las cuentas. El sistema queda listo para cargar un padron nuevo.
          </p>
        </div>

        <div className="mt-4 space-y-3">
          <div>
            <label htmlFor="limpiar-password" className="etiqueta-campo">
              Su contrasena de administrador
            </label>
            <input
              id="limpiar-password"
              type="password"
              className="campo"
              value={password}
              onChange={(evento) => setPassword(evento.target.value)}
              autoComplete="current-password"
            />
            <p className="mt-1 text-xs text-neutro-500">
              Se valida la contrasena de la cuenta con la que esta conectado
              {sesion ? ` (${sesion.email})` : ''}. Si hay varios administradores, cada uno debe
              escribir la suya.
            </p>
          </div>

          <div>
            <label htmlFor="limpiar-confirmacion" className="etiqueta-campo">
              Escriba <span className="font-mono text-error-700">{frase}</span> para confirmar
            </label>
            <input
              id="limpiar-confirmacion"
              className="campo font-mono"
              value={confirmacion}
              onChange={(evento) => setConfirmacion(evento.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder={frase}
            />
          </div>
        </div>

        {error ? (
          <div className="mt-3">
            <Aviso tono="error">{error}</Aviso>
          </div>
        ) : null}

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            className="boton-secundario"
            onClick={() => {
              setAbierto(false);
              setError(null);
            }}
            disabled={limpiar.isPending}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="boton-peligro"
            onClick={() => limpiar.mutate()}
            disabled={!puedeBorrar}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            {limpiar.isPending ? 'Borrando' : 'Borrar definitivamente'}
          </button>
        </div>
      </Modal>
    </Tarjeta>
  );
}

/**
 * Souvenirs o regalos que se entregan por la asistencia. Se controlan igual que
 * los refrigerios, pero sin jornada: uno por asistente.
 */
interface TipoSouvenir {
  id: number;
  nombre: string;
  activo: boolean;
  orden: number;
}

function Souvenirs() {
  const cliente = useQueryClient();
  const [nuevo, setNuevo] = useState(false);
  const [enEdicion, setEnEdicion] = useState<TipoSouvenir | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ['souvenirs', 'tipos'],
    queryFn: () => api.obtener<{ tipos: TipoSouvenir[] }>('/souvenirs/tipos'),
  });

  const guardar = useMutation({
    mutationFn: (datos: { id?: number; nombre: string; activo: boolean; orden: number }) =>
      datos.id
        ? api.actualizar(`/souvenirs/tipos/${datos.id}`, datos)
        : api.crear('/souvenirs/tipos', datos),
    onSuccess: () => {
      setError(null);
      setNuevo(false);
      setEnEdicion(null);
      void cliente.invalidateQueries({ queryKey: ['souvenirs', 'tipos'] });
      void cliente.invalidateQueries({ queryKey: ['operador', 'contexto'] });
    },
    onError: (problema) => {
      setError(
        problema instanceof ErrorPeticion
          ? problema.message
          : 'No se pudo guardar el souvenir. Intente de nuevo.',
      );
    },
  });

  return (
    <Tarjeta
      titulo="Souvenirs"
      descripcion="Regalo por la asistencia: uno por asistente, sin doble entrega"
      accion={
        <button type="button" className="boton-secundario" onClick={() => setNuevo(true)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Nuevo souvenir
        </button>
      }
    >
      {error ? (
        <div className="mb-3">
          <Aviso tono="error">{error}</Aviso>
        </div>
      ) : null}

      <ul className="space-y-2">
        {(data?.tipos ?? []).map((tipo) => (
          <li
            key={tipo.id}
            className="flex items-center justify-between gap-2 rounded-lg border border-neutro-200 px-3 py-2.5"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-neutro-900">{tipo.nombre}</p>
              <p className="truncate text-xs text-neutro-600">Orden {tipo.orden}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {tipo.activo ? (
                <Insignia tono="exito">Activo</Insignia>
              ) : (
                <Insignia tono="neutro">Inactivo</Insignia>
              )}
              <button
                type="button"
                className="boton-compacto text-neutro-600 hover:bg-neutro-100"
                onClick={() => setEnEdicion(tipo)}
                aria-label={`Editar el souvenir ${tipo.nombre}`}
                title="Editar souvenir"
              >
                <Pencil className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </li>
        ))}
        {(data?.tipos.length ?? 0) === 0 ? (
          <li className="text-sm text-neutro-600">No hay souvenirs configurados.</li>
        ) : null}
      </ul>

      <Ayuda titulo="Como se usa el souvenir en el evento" className="mt-3">
        Para usarlo en la app del operador, active el interruptor <strong>Souvenir</strong> en
        Accesos del operador. Se entrega <strong>una sola vez por persona</strong> y solo a quien
        registro su ingreso en la <strong>primera jornada</strong>; quien llego unicamente en la
        tarde no lo recibe. El reporte de entregas y pendientes esta en Reportes.
      </Ayuda>

      <Modal
        abierto={nuevo || enEdicion !== null}
        titulo={enEdicion ? 'Editar souvenir' : 'Nuevo souvenir'}
        alCerrar={() => {
          setNuevo(false);
          setEnEdicion(null);
          setError(null);
        }}
      >
        <FormularioSouvenir
          inicial={enEdicion ?? undefined}
          etiqueta={enEdicion ? 'Guardar cambios' : 'Crear souvenir'}
          alGuardar={async (datos) => guardar.mutateAsync(datos)}
        />
      </Modal>
    </Tarjeta>
  );
}

function FormularioSouvenir({
  alGuardar,
  inicial,
  etiqueta,
}: {
  alGuardar: (datos: { id?: number; nombre: string; activo: boolean; orden: number }) => Promise<unknown>;
  inicial?: TipoSouvenir;
  etiqueta: string;
}) {
  const [nombre, setNombre] = useState(inicial?.nombre ?? '');
  const [activo, setActivo] = useState(inicial?.activo ?? true);
  const [orden, setOrden] = useState(inicial?.orden ?? 1);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-3"
      onSubmit={async (evento) => {
        evento.preventDefault();
        setError(null);
        setGuardando(true);
        try {
          await alGuardar({ id: inicial?.id, nombre, activo, orden });
        } catch (problema) {
          setError(
            problema instanceof ErrorPeticion
              ? problema.message
              : 'No se pudo guardar el souvenir. Intente de nuevo.',
          );
        } finally {
          setGuardando(false);
        }
      }}
    >
      {error ? (
        <Aviso tono="error" titulo="No se pudo guardar el souvenir">
          {error}
        </Aviso>
      ) : null}

      <div>
        <label htmlFor="souvenir-nombre" className="etiqueta-campo">
          Nombre
        </label>
        <input
          id="souvenir-nombre"
          className="campo"
          value={nombre}
          onChange={(evento) => setNombre(evento.target.value)}
          placeholder="Camiseta del seminario"
          required
          minLength={2}
        />
      </div>

      <div>
        <label htmlFor="souvenir-orden" className="etiqueta-campo">
          Orden
        </label>
        <input
          id="souvenir-orden"
          type="number"
          min={0}
          max={50}
          className="campo"
          value={orden}
          onChange={(evento) => setOrden(Number(evento.target.value))}
        />
      </div>

      <label className="flex min-h-[48px] items-center justify-between gap-4 rounded-lg border border-neutro-200 px-3.5">
        <span className="text-sm font-medium text-neutro-800">Activo</span>
        <input
          type="checkbox"
          checked={activo}
          onChange={(evento) => setActivo(evento.target.checked)}
          className="h-5 w-5 accent-[#12505E]"
        />
      </label>

      <button type="submit" className="boton-primario w-full" disabled={guardando}>
        {guardando ? 'Guardando' : etiqueta}
      </button>
    </form>
  );
}

function FormularioJornada({
  alGuardar,
  inicial,
  etiqueta,
}: {
  alGuardar: (datos: unknown) => Promise<void>;
  inicial?: Jornada;
  etiqueta: string;
}) {
  const [datos, setDatos] = useState({
    nombre: inicial?.nombre ?? '',
    inicio: inicial ? aLocal(inicial.inicio) : '',
    fin: inicial ? aLocal(inicial.fin) : '',
    ventanaCheckinInicio: inicial ? aLocal(inicial.ventanaCheckinInicio) : '',
    ventanaCheckinFin: inicial ? aLocal(inicial.ventanaCheckinFin) : '',
    orden: inicial?.orden ?? 1,
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-3"
      onSubmit={async (evento) => {
        evento.preventDefault();
        setError(null);

        // Revision local: la base de datos tambien lo rechaza, pero alli el
        // error llega como un 500 sin explicacion.
        const aInstante = (valor: string) => new Date(valor).getTime();
        if (!Number.isNaN(aInstante(datos.fin)) && aInstante(datos.fin) <= aInstante(datos.inicio)) {
          setError('La hora de fin de la jornada debe ser posterior a la de inicio');
          return;
        }
        if (
          !Number.isNaN(aInstante(datos.ventanaCheckinFin)) &&
          aInstante(datos.ventanaCheckinFin) <= aInstante(datos.ventanaCheckinInicio)
        ) {
          setError('El cierre del registro debe ser posterior a su apertura');
          return;
        }

        setGuardando(true);
        try {
          await alGuardar({
            ...datos,
            inicio: new Date(datos.inicio).toISOString(),
            fin: new Date(datos.fin).toISOString(),
            ventanaCheckinInicio: new Date(datos.ventanaCheckinInicio).toISOString(),
            ventanaCheckinFin: new Date(datos.ventanaCheckinFin).toISOString(),
          });
        } catch (problema) {
          setError(
            problema instanceof ErrorPeticion
              ? problema.message
              : 'No se pudo guardar la jornada. Intente de nuevo.',
          );
        } finally {
          setGuardando(false);
        }
      }}
    >
      {error ? (
        <Aviso tono="error" titulo="No se pudo guardar la jornada">
          {error}
        </Aviso>
      ) : null}

      <div>
        <label htmlFor="jornada-nombre" className="etiqueta-campo">
          Nombre
        </label>
        <input
          id="jornada-nombre"
          className="campo"
          value={datos.nombre}
          onChange={(evento) => setDatos({ ...datos, nombre: evento.target.value })}
          required
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="jornada-inicio" className="etiqueta-campo">
            Inicio
          </label>
          <input
            id="jornada-inicio"
            type="datetime-local"
            className="campo"
            value={datos.inicio}
            onChange={(evento) => setDatos({ ...datos, inicio: evento.target.value })}
            required
          />
        </div>
        <div>
          <label htmlFor="jornada-fin" className="etiqueta-campo">
            Fin
          </label>
          <input
            id="jornada-fin"
            type="datetime-local"
            className="campo"
            value={datos.fin}
            onChange={(evento) => setDatos({ ...datos, fin: evento.target.value })}
            required
          />
        </div>
        <div>
          <label htmlFor="jornada-ventana-inicio" className="etiqueta-campo">
            Apertura de registro
          </label>
          <input
            id="jornada-ventana-inicio"
            type="datetime-local"
            className="campo"
            value={datos.ventanaCheckinInicio}
            onChange={(evento) => setDatos({ ...datos, ventanaCheckinInicio: evento.target.value })}
            required
          />
        </div>
        <div>
          <label htmlFor="jornada-ventana-fin" className="etiqueta-campo">
            Cierre de registro
          </label>
          <input
            id="jornada-ventana-fin"
            type="datetime-local"
            className="campo"
            value={datos.ventanaCheckinFin}
            onChange={(evento) => setDatos({ ...datos, ventanaCheckinFin: evento.target.value })}
            required
          />
        </div>
      </div>
      <div>
        <label htmlFor="jornada-orden" className="etiqueta-campo">
          Orden
        </label>
        <input
          id="jornada-orden"
          type="number"
          min={0}
          max={50}
          className="campo"
          value={datos.orden}
          onChange={(evento) => setDatos({ ...datos, orden: Number(evento.target.value) })}
          required
        />
      </div>
      <button type="submit" className="boton-primario w-full" disabled={guardando}>
        {guardando ? 'Guardando' : etiqueta}
      </button>
    </form>
  );
}

function FormularioRefrigerio({
  jornadas,
  alGuardar,
  inicial,
  etiqueta,
}: {
  jornadas: Jornada[];
  alGuardar: (datos: unknown) => Promise<void>;
  inicial?: TipoRefrigerio;
  etiqueta: string;
}) {
  const [nombre, setNombre] = useState(inicial?.nombre ?? '');
  const [jornadaId, setJornadaId] = useState<number>(inicial?.jornadaId ?? jornadas[0]?.id ?? 0);
  const [activo, setActivo] = useState(inicial?.activo ?? true);
  const [orden, setOrden] = useState(inicial?.orden ?? 1);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-3"
      onSubmit={async (evento) => {
        evento.preventDefault();
        setError(null);
        setGuardando(true);
        try {
          await alGuardar({ nombre, jornadaId, activo, orden });
        } catch (problema) {
          setError(
            problema instanceof ErrorPeticion
              ? problema.message
              : 'No se pudo guardar el refrigerio. Intente de nuevo.',
          );
        } finally {
          setGuardando(false);
        }
      }}
    >
      {error ? (
        <Aviso tono="error" titulo="No se pudo guardar el refrigerio">
          {error}
        </Aviso>
      ) : null}

      <div>
        <label htmlFor="refrigerio-nombre" className="etiqueta-campo">
          Nombre
        </label>
        <input
          id="refrigerio-nombre"
          className="campo"
          value={nombre}
          onChange={(evento) => setNombre(evento.target.value)}
          required
        />
      </div>
      <div>
        <label htmlFor="refrigerio-jornada" className="etiqueta-campo">
          Jornada
        </label>
        <select
          id="refrigerio-jornada"
          className="campo"
          value={jornadaId}
          onChange={(evento) => setJornadaId(Number(evento.target.value))}
        >
          {jornadas.map((jornada) => (
            <option key={jornada.id} value={jornada.id}>
              {jornada.nombre}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="refrigerio-orden" className="etiqueta-campo">
            Orden
          </label>
          <input
            id="refrigerio-orden"
            type="number"
            min={0}
            max={50}
            className="campo"
            value={orden}
            onChange={(evento) => setOrden(Number(evento.target.value))}
            required
          />
        </div>
        <label className="flex min-h-[48px] items-center gap-3 self-end rounded-lg border border-neutro-200 px-3.5">
          <input
            id="refrigerio-activo"
            type="checkbox"
            className="h-5 w-5 accent-[#12505E]"
            checked={activo}
            onChange={(evento) => setActivo(evento.target.checked)}
          />
          <span className="text-sm font-medium text-neutro-800">Activo</span>
        </label>
      </div>
      <button type="submit" className="boton-primario w-full" disabled={guardando}>
        {guardando ? 'Guardando' : etiqueta}
      </button>
    </form>
  );
}
