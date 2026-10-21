import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import type { Firmante } from '@seminario/shared';
import { CalendarClock, Plus, Save, Timer } from 'lucide-react';
import { api, ErrorPeticion } from '../../lib/api';
import { formatearFechaHora } from '../../lib/formato';
import { Aviso, EsqueletoTarjeta, Insignia, Modal, Tarjeta } from '../../componentes/comunes';

const esquema = z.object({
  nombre: z.string().trim().min(3, 'El nombre es obligatorio').max(160),
  fecha: z.string().min(8, 'Indique la fecha del seminario'),
  horaFinSeminario: z.string().min(8, 'Indique la hora de fin'),
  toleranciaMinutos: z.coerce.number().int().min(0).max(240),
  exigirAmbasJornadas: z.boolean(),
  intensidadHoraria: z.coerce.number().int().min(1).max(24),
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
    mutationFn: async (datos: DatosConfig) =>
      api.reemplazar('/config', {
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
                  <Insignia tono="primario">Orden {jornada.orden}</Insignia>
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
            {(refrigerios?.tipos ?? []).map((tipo) => (
              <li
                key={tipo.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-neutro-200 px-3 py-2.5"
              >
                <span className="text-sm font-medium text-neutro-900">{tipo.nombre}</span>
                {tipo.activo ? (
                  <Insignia tono="exito">Activo</Insignia>
                ) : (
                  <Insignia tono="neutro">Inactivo</Insignia>
                )}
              </li>
            ))}
            {(refrigerios?.tipos.length ?? 0) === 0 ? (
              <li className="text-sm text-neutro-600">No hay refrigerios configurados.</li>
            ) : null}
          </ul>
        </Tarjeta>
      </div>
      <Modal abierto={nuevaJornada} titulo="Nueva jornada" alCerrar={() => setNuevaJornada(false)}>
        <FormularioJornada
          alGuardar={async (datos) => {
            await api.crear('/jornadas', datos);
            setNuevaJornada(false);
            void cliente.invalidateQueries({ queryKey: ['jornadas'] });
          }}
        />
      </Modal>
      <Modal
        abierto={nuevoRefrigerio}
        titulo="Nuevo refrigerio"
        alCerrar={() => setNuevoRefrigerio(false)}
      >
        <FormularioRefrigerio
          jornadas={jornadas?.jornadas ?? []}
          alGuardar={async (datos) => {
            await api.crear('/refrigerios/tipos', datos);
            setNuevoRefrigerio(false);
            void cliente.invalidateQueries({ queryKey: ['refrigerios', 'tipos'] });
          }}
        />
      </Modal>
      <p className="text-xs text-neutro-500">
        La elegibilidad de los certificados se recalcula con estos valores en cada consulta, sin
        necesidad de migraciones ni scripts.
      </p>
    </div>
  );
}

function FormularioJornada({ alGuardar }: { alGuardar: (datos: unknown) => Promise<void> }) {
  const [datos, setDatos] = useState({
    nombre: '',
    inicio: '',
    fin: '',
    ventanaCheckinInicio: '',
    ventanaCheckinFin: '',
    orden: 1,
  });
  const [guardando, setGuardando] = useState(false);

  return (
    <form
      className="space-y-3"
      onSubmit={async (evento) => {
        evento.preventDefault();
        setGuardando(true);
        try {
          await alGuardar({
            ...datos,
            inicio: new Date(datos.inicio).toISOString(),
            fin: new Date(datos.fin).toISOString(),
            ventanaCheckinInicio: new Date(datos.ventanaCheckinInicio).toISOString(),
            ventanaCheckinFin: new Date(datos.ventanaCheckinFin).toISOString(),
          });
        } finally {
          setGuardando(false);
        }
      }}
    >
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
      <button type="submit" className="boton-primario w-full" disabled={guardando}>
        {guardando ? 'Guardando' : 'Crear jornada'}
      </button>
    </form>
  );
}

function FormularioRefrigerio({
  jornadas,
  alGuardar,
}: {
  jornadas: Jornada[];
  alGuardar: (datos: unknown) => Promise<void>;
}) {
  const [nombre, setNombre] = useState('');
  const [jornadaId, setJornadaId] = useState<number>(jornadas[0]?.id ?? 0);
  const [guardando, setGuardando] = useState(false);

  return (
    <form
      className="space-y-3"
      onSubmit={async (evento) => {
        evento.preventDefault();
        setGuardando(true);
        try {
          await alGuardar({ nombre, jornadaId, activo: true, orden: 1 });
        } finally {
          setGuardando(false);
        }
      }}
    >
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
      <button type="submit" className="boton-primario w-full" disabled={guardando}>
        {guardando ? 'Guardando' : 'Crear refrigerio'}
      </button>
    </form>
  );
}
