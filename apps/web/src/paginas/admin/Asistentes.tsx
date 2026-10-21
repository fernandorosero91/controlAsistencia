import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Search } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, ErrorPeticion } from '../../lib/api';
import { nombreRol } from '../../lib/formato';
import {
  Aviso,
  EstadoError,
  Insignia,
  Modal,
  Paginacion,
  Tarjeta,
} from '../../componentes/comunes';

interface Asistente {
  id: string;
  codigoRegistro: string | null;
  nombres: string;
  apellidos: string;
  email: string | null;
  rol: 'estudiante' | 'docente';
  semestre: number | null;
  activo: boolean;
}

interface RespuestaListado {
  datos: Asistente[];
  pagina: number;
  porPagina: number;
  total: number;
  totalPaginas: number;
}

const esquemaFormulario = z
  .object({
    id: z.string().trim().min(2, 'El ID es obligatorio').max(32),
    nombres: z.string().trim().min(1, 'Los nombres son obligatorios').max(80),
    apellidos: z.string().trim().min(1, 'Los apellidos son obligatorios').max(80),
    rol: z.enum(['estudiante', 'docente']),
    semestre: z.number().int().min(1).max(30).nullable(),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .email('Correo electronico invalido')
      .max(120)
      .optional()
      .or(z.literal('')),
  })
  .refine((datos) => datos.rol !== 'estudiante' || datos.semestre !== null, {
    message: 'El semestre es obligatorio para estudiantes',
    path: ['semestre'],
  })
  .refine((datos) => datos.rol !== 'docente' || datos.semestre === null, {
    message: 'El semestre no aplica para docentes',
    path: ['semestre'],
  });

type DatosFormulario = z.infer<typeof esquemaFormulario>;

export function Asistentes() {
  const cliente = useQueryClient();
  const [pagina, setPagina] = useState(1);
  const [consulta, setConsulta] = useState('');
  const [busquedaAplicada, setBusquedaAplicada] = useState('');
  const [rol, setRol] = useState<'' | 'estudiante' | 'docente'>('');
  const [editing, setEditing] = useState<Asistente | null>(null);
  const [creando, setCreando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data, isError, refetch } = useQuery({
    queryKey: ['asistentes', pagina, busquedaAplicada, rol],
    queryFn: () => {
      const parametros = new URLSearchParams({ pagina: String(pagina), porPagina: '25' });
      if (busquedaAplicada) parametros.set('q', busquedaAplicada);
      if (rol) parametros.set('rol', rol);
      return api.obtener<RespuestaListado>(`/asistentes?${parametros.toString()}`);
    },
  });

  const guardar = useMutation({
    mutationFn: async (datos: DatosFormulario & { idOriginal?: string }) => {
      const cuerpo = {
        nombres: datos.nombres,
        apellidos: datos.apellidos,
        rol: datos.rol,
        semestre: datos.rol === 'docente' ? null : datos.semestre,
        email: datos.email?.trim() ? datos.email.trim() : '',
        activo: true,
      };
      if (datos.idOriginal) {
        return api.actualizar<Asistente>(`/asistentes/${datos.idOriginal}`, cuerpo);
      }
      return api.crear<Asistente>('/asistentes', { ...cuerpo, id: datos.id });
    },
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['asistentes'] });
      setEditing(null);
      setCreando(false);
      setError(null);
    },
    onError: (problema) => {
      setError(
        problema instanceof ErrorPeticion ? problema.message : 'No se pudo guardar el asistente',
      );
    },
  });

  return (
    <div className="space-y-4">
      <Tarjeta
        titulo="Padron de asistentes"
        descripcion="Consulta, filtra y actualiza los datos del padron"
        accion={
          <button type="button" className="boton-primario" onClick={() => setCreando(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Nuevo asistente
          </button>
        }
      >
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(evento) => {
            evento.preventDefault();
            setBusquedaAplicada(consulta.trim());
            setPagina(1);
          }}
        >
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutro-400"
              aria-hidden="true"
            />
            <input
              className="campo pl-9"
              value={consulta}
              onChange={(evento) => setConsulta(evento.target.value)}
              placeholder="Buscar por nombre, apellido o ID"
              aria-label="Buscar asistentes"
            />
          </div>
          <select
            className="campo sm:w-48"
            value={rol}
            onChange={(evento) => {
              setRol(evento.target.value as '' | 'estudiante' | 'docente');
              setPagina(1);
            }}
            aria-label="Filtrar por rol"
          >
            <option value="">Todos los roles</option>
            <option value="estudiante">Estudiantes</option>
            <option value="docente">Docentes</option>
          </select>
          <button type="submit" className="boton-secundario">
            Filtrar
          </button>
        </form>

        {error ? (
          <div className="mt-3">
            <Aviso tono="error">{error}</Aviso>
          </div>
        ) : null}

        {isError ? (
          <div className="mt-3">
            <EstadoError alReintentar={() => void refetch()} />
          </div>
        ) : null}

        <div className="mt-4 overflow-x-auto sin-barra-espacial">
          <table className="tabla hidden md:table">
            <thead className="tabla-cabecera">
              <tr>
                <th scope="col">ID</th>
                <th scope="col">Codigo</th>
                <th scope="col">Nombre</th>
                <th scope="col">Rol</th>
                <th scope="col">Semestre</th>
                <th scope="col">Estado</th>
                <th scope="col" className="text-right">
                  Acciones
                </th>
              </tr>
            </thead>
            <tbody className="tabla-cuerpo">
              {(data?.datos ?? []).map((asistente) => (
                <tr key={asistente.id}>
                  <td className="font-mono text-neutro-800">{asistente.id}</td>
                  <td className="font-mono tracking-wider text-primario-700">
                    {asistente.codigoRegistro ?? '-'}
                  </td>
                  <td className="text-neutro-900">
                    {asistente.nombres} {asistente.apellidos}
                    {asistente.email ? (
                      <span className="block text-xs text-neutro-500">{asistente.email}</span>
                    ) : null}
                  </td>
                  <td>{nombreRol(asistente.rol)}</td>
                  <td>{asistente.semestre ?? '-'}</td>
                  <td>
                    {asistente.activo ? (
                      <Insignia tono="exito">Activo</Insignia>
                    ) : (
                      <Insignia tono="neutro">Inactivo</Insignia>
                    )}
                  </td>
                  <td className="text-right">
                    <button
                      type="button"
                      className="boton-compacto text-primario-700 hover:bg-primario-50"
                      onClick={() => setEditing(asistente)}
                      aria-label={`Editar a ${asistente.nombres} ${asistente.apellidos}`}
                    >
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Vista de tarjetas para pantallas pequenas */}
          <ul className="space-y-2 md:hidden">
            {(data?.datos ?? []).map((asistente) => (
              <li key={asistente.id} className="rounded-2xl bg-neutro-50 p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-neutro-900">
                      {asistente.nombres} {asistente.apellidos}
                    </p>
                    <p className="font-mono text-xs text-neutro-600">{asistente.id}</p>
                    <p className="font-mono text-sm font-bold tracking-widest text-primario-700">
                      {asistente.codigoRegistro ?? 'Sin codigo'}
                    </p>
                    {asistente.email ? (
                      <p className="truncate text-xs text-neutro-500">{asistente.email}</p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="boton-compacto shrink-0 bg-white text-primario-700 shadow-tarjeta"
                    onClick={() => setEditing(asistente)}
                    aria-label={`Editar a ${asistente.nombres} ${asistente.apellidos}`}
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Insignia tono="primario">{nombreRol(asistente.rol)}</Insignia>
                  {asistente.semestre !== null ? (
                    <Insignia tono="neutro">Semestre {asistente.semestre}</Insignia>
                  ) : null}
                  {asistente.activo ? (
                    <Insignia tono="exito">Activo</Insignia>
                  ) : (
                    <Insignia tono="neutro">Inactivo</Insignia>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {data && data.datos.length === 0 ? (
            <p className="py-8 text-center text-sm text-neutro-600">
              No hay asistentes que coincidan con el filtro.
            </p>
          ) : null}
        </div>

        {data ? (
          <Paginacion
            pagina={data.pagina}
            totalPaginas={data.totalPaginas}
            total={data.total}
            alCambiar={setPagina}
          />
        ) : null}
      </Tarjeta>

      <Modal
        abierto={creando || editing !== null}
        titulo={editing ? 'Editar asistente' : 'Nuevo asistente'}
        alCerrar={() => {
          setCreando(false);
          setEditing(null);
        }}
      >
        <FormularioAsistente
          asistente={editing}
          onGuardar={(datos) => guardar.mutate(datos)}
          guardando={guardar.isPending}
        />
      </Modal>
    </div>
  );
}

function FormularioAsistente({
  asistente,
  onGuardar,
  guardando,
}: {
  asistente: Asistente | null;
  onGuardar: (datos: DatosFormulario & { idOriginal?: string }) => void;
  guardando: boolean;
}) {
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<DatosFormulario>({
    resolver: zodResolver(esquemaFormulario),
    defaultValues: {
      id: asistente?.id ?? '',
      nombres: asistente?.nombres ?? '',
      apellidos: asistente?.apellidos ?? '',
      rol: asistente?.rol ?? 'estudiante',
      semestre: asistente?.semestre ?? 1,
      email: asistente?.email ?? '',
    },
  });

  const rol = watch('rol');

  return (
    <form
      className="space-y-4"
      onSubmit={handleSubmit((datos) => onGuardar({ ...datos, idOriginal: asistente?.id }))}
    >
      {asistente ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="id-edicion" className="etiqueta-campo">
              ID institucional
            </label>
            <input id="id-edicion" className="campo bg-neutro-200" value={asistente.id} disabled />
            <p className="mt-1 text-xs text-neutro-500">
              El ID institucional es inmutable: no se puede cambiar una vez creado.
            </p>
          </div>
          <div>
            <label htmlFor="codigo-edicion" className="etiqueta-campo">
              Codigo de registro
            </label>
            <input
              id="codigo-edicion"
              className="campo bg-neutro-200 font-mono tracking-widest"
              value={asistente.codigoRegistro ?? 'Sin codigo'}
              disabled
            />
            <p className="mt-1 text-xs text-neutro-500">
              Lo genera el sistema y es lo que codifica el QR. No se puede editar.
            </p>
          </div>
        </div>
      ) : (
        <div>
          <label htmlFor="id-nuevo" className="etiqueta-campo">
            ID institucional
          </label>
          <input
            id="id-nuevo"
            className="campo font-mono uppercase"
            {...register('id', { setValueAs: (valor) => String(valor).toUpperCase() })}
          />
          {errors.id ? (
            <p className="mt-1 text-sm text-error-600">{errors.id.message}</p>
          ) : null}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="nombres" className="etiqueta-campo">
            Nombres
          </label>
          <input id="nombres" className="campo" {...register('nombres')} />
          {errors.nombres ? (
            <p className="mt-1 text-sm text-error-600">{errors.nombres.message}</p>
          ) : null}
        </div>
        <div>
          <label htmlFor="apellidos" className="etiqueta-campo">
            Apellidos
          </label>
          <input id="apellidos" className="campo" {...register('apellidos')} />
          {errors.apellidos ? (
            <p className="mt-1 text-sm text-error-600">{errors.apellidos.message}</p>
          ) : null}
        </div>
      </div>

      <div>
        <label htmlFor="email" className="etiqueta-campo">
          Correo electronico
        </label>
        <input
          id="email"
          type="email"
          className="campo"
          placeholder="Para enviarle el codigo de registro y el QR"
          {...register('email')}
        />
        {errors.email ? (
          <p className="mt-1 text-sm text-error-600">{errors.email.message}</p>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="rol" className="etiqueta-campo">
            Rol
          </label>
          <select
            id="rol"
            className="campo"
            {...register('rol', {
              onChange: (evento) => {
                if (evento.target.value === 'docente') setValue('semestre', null);
                else if (watch('semestre') === null) setValue('semestre', 1);
              },
            })}
          >
            <option value="estudiante">Estudiante</option>
            <option value="docente">Docente</option>
          </select>
        </div>
        <div>
          <label htmlFor="semestre" className="etiqueta-campo">
            Semestre
          </label>
          <input
            id="semestre"
            type="number"
            min={1}
            max={30}
            className="campo"
            disabled={rol === 'docente'}
            {...register('semestre', {
              setValueAs: (valor) => (valor === '' || valor === null ? null : Number(valor)),
            })}
          />
          {errors.semestre ? (
            <p className="mt-1 text-sm text-error-600">{errors.semestre.message}</p>
          ) : null}
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button type="submit" className="boton-primario" disabled={guardando}>
          {guardando ? 'Guardando' : 'Guardar'}
        </button>
      </div>
    </form>
  );
}
