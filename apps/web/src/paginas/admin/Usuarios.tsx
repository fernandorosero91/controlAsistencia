import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Pencil, Plus, ShieldCheck, Trash2, UserCog } from 'lucide-react';
import { api, ErrorPeticion } from '../../lib/api';
import { formatearFechaHora } from '../../lib/formato';
import { useSesion } from '../../estado/sesion';
import { Aviso, EsqueletoTarjeta, Insignia, Modal, Tarjeta } from '../../componentes/comunes';

interface Usuario {
  id: string;
  nombre: string;
  email: string;
  rol: 'admin' | 'operador';
  activo: boolean;
  ultimoAccesoAt: string | null;
  createdAt: string;
}

const camposBase = {
  nombre: z.string().trim().min(3, 'El nombre es obligatorio').max(120),
  email: z.string().trim().toLowerCase().email('Correo electronico invalido'),
  rol: z.enum(['admin', 'operador']),
};

/** Al crear la cuenta la contrasena es obligatoria. */
const esquemaCrear = z.object({
  ...camposBase,
  password: z.string().min(8, 'La contrasena debe tener al menos 8 caracteres').max(128),
});

/**
 * Al editar la contrasena es opcional: en blanco conserva la actual. Si se
 * escribe, debe cumplir el minimo. Antes el formulario la exigia siempre y,
 * como en modo edicion no se mostraba el campo, guardar no hacia nada.
 */
const esquemaEditar = z.object({
  ...camposBase,
  password: z
    .string()
    .max(128, 'La contrasena no puede superar 128 caracteres')
    .refine((valor) => valor === '' || valor.length >= 8, {
      message: 'Si cambia la contrasena debe tener al menos 8 caracteres',
    }),
});

type DatosUsuario = z.infer<typeof esquemaCrear>;

function mensajeDeError(problema: unknown, respaldo: string): string {
  return problema instanceof ErrorPeticion ? problema.message : respaldo;
}

export function Usuarios() {
  const cliente = useQueryClient();
  const sesion = useSesion((estado) => estado.usuario);
  const [creando, setCreando] = useState(false);
  const [editando, setEditando] = useState<Usuario | null>(null);
  const [eliminando, setEliminando] = useState<Usuario | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorEliminar, setErrorEliminar] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const { data, isPending } = useQuery({
    queryKey: ['usuarios'],
    queryFn: () => api.obtener<{ datos: Usuario[]; total: number }>('/usuarios?porPagina=100'),
  });

  const guardar = useMutation({
    mutationFn: async (datos: DatosUsuario & { idOriginal?: string }) => {
      if (datos.idOriginal) {
        return api.actualizar(`/usuarios/${datos.idOriginal}`, {
          nombre: datos.nombre,
          email: datos.email,
          rol: datos.rol,
          // En blanco significa "conservar la contrasena actual".
          ...(datos.password !== '' ? { password: datos.password } : {}),
        });
      }
      return api.crear('/usuarios', datos);
    },
    onSuccess: (_datos, variables) => {
      void cliente.invalidateQueries({ queryKey: ['usuarios'] });
      setMensaje(
        variables.idOriginal ? 'Usuario actualizado correctamente.' : 'Usuario creado correctamente.',
      );
      setCreando(false);
      setEditando(null);
      setError(null);
    },
    onError: (problema) => {
      setMensaje(null);
      setError(mensajeDeError(problema, 'No se pudo guardar el usuario'));
    },
  });

  const alternarActivo = useMutation({
    mutationFn: async (usuario: Usuario) =>
      api.actualizar(`/usuarios/${usuario.id}`, { activo: !usuario.activo }),
    onSuccess: (_datos, usuario) => {
      void cliente.invalidateQueries({ queryKey: ['usuarios'] });
      setError(null);
      setMensaje(usuario.activo ? 'Usuario desactivado.' : 'Usuario activado.');
    },
    onError: (problema) => {
      setMensaje(null);
      setError(mensajeDeError(problema, 'No se pudo cambiar el estado del usuario'));
    },
  });

  const eliminar = useMutation({
    mutationFn: async (usuario: Usuario) => api.eliminar(`/usuarios/${usuario.id}`),
    onSuccess: (_datos, usuario) => {
      void cliente.invalidateQueries({ queryKey: ['usuarios'] });
      setEliminando(null);
      setErrorEliminar(null);
      setError(null);
      setMensaje(`Se elimino la cuenta de ${usuario.nombre}.`);
    },
    onError: (problema) => {
      setErrorEliminar(mensajeDeError(problema, 'No se pudo eliminar el usuario'));
    },
  });

  const esPropia = (usuario: Usuario) => usuario.id === sesion?.id;

  return (
    <div className="space-y-4">
      <Tarjeta
        titulo="Usuarios del sistema"
        descripcion="Administradores con acceso total y operadores dedicados al registro"
        accion={
          <button
            type="button"
            className="boton-primario"
            onClick={() => {
              setError(null);
              setMensaje(null);
              setCreando(true);
            }}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Nuevo usuario
          </button>
        }
      >
        {mensaje ? (
          <div className="mb-3">
            <Aviso tono="exito">{mensaje}</Aviso>
          </div>
        ) : null}

        {error ? (
          <div className="mb-3">
            <Aviso tono="error">{error}</Aviso>
          </div>
        ) : null}

        <Aviso tono="primario" titulo="Permisos">
          El rol de administrador es el unico que puede emitir, descargar y revocar certificados,
          administrar usuarios y limpiar la base de datos.
        </Aviso>

        {isPending ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <EsqueletoTarjeta />
            <EsqueletoTarjeta />
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto sin-barra-espacial">
            <table className="tabla">
              <thead className="tabla-cabecera">
                <tr>
                  <th scope="col">Nombre</th>
                  <th scope="col">Correo</th>
                  <th scope="col">Rol</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Ultimo acceso</th>
                  <th scope="col" className="text-right">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody className="tabla-cuerpo">
                {(data?.datos ?? []).map((usuario) => (
                  <tr key={usuario.id}>
                    <td className="text-neutro-900">
                      {usuario.nombre}
                      {esPropia(usuario) ? (
                        <span className="ml-2 text-xs text-neutro-500">(su cuenta)</span>
                      ) : null}
                    </td>
                    <td className="text-neutro-700">{usuario.email}</td>
                    <td>
                      {usuario.rol === 'admin' ? (
                        <Insignia tono="primario">
                          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                          Administrador
                        </Insignia>
                      ) : (
                        <Insignia tono="neutro">
                          <UserCog className="h-3.5 w-3.5" aria-hidden="true" />
                          Operador
                        </Insignia>
                      )}
                    </td>
                    <td>
                      <Insignia tono={usuario.activo ? 'exito' : 'aviso'}>
                        {usuario.activo ? 'Activo' : 'Inactivo'}
                      </Insignia>
                    </td>
                    <td className="text-sm text-neutro-600">
                      {usuario.ultimoAccesoAt
                        ? formatearFechaHora(usuario.ultimoAccesoAt)
                        : 'Nunca'}
                    </td>
                    <td className="text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          className="boton-compacto text-primario-700 hover:bg-primario-50"
                          onClick={() => {
                            setError(null);
                            setMensaje(null);
                            setEditando(usuario);
                          }}
                          aria-label={`Editar a ${usuario.nombre}`}
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="boton-compacto text-neutro-700 hover:bg-neutro-100"
                          onClick={() => alternarActivo.mutate(usuario)}
                          disabled={alternarActivo.isPending || esPropia(usuario)}
                          title={
                            esPropia(usuario)
                              ? 'No puede desactivar su propia cuenta'
                              : undefined
                          }
                          aria-label={`Cambiar el estado de ${usuario.nombre}`}
                        >
                          {usuario.activo ? 'Desactivar' : 'Activar'}
                        </button>
                        <button
                          type="button"
                          className="boton-compacto text-error-700 hover:bg-error-100"
                          onClick={() => {
                            setErrorEliminar(null);
                            setMensaje(null);
                            setEliminando(usuario);
                          }}
                          disabled={esPropia(usuario)}
                          title={
                            esPropia(usuario)
                              ? 'No puede eliminar su propia cuenta'
                              : `Eliminar a ${usuario.nombre}`
                          }
                          aria-label={`Eliminar a ${usuario.nombre}`}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Tarjeta>

      <Modal
        abierto={creando || editando !== null}
        titulo={editando ? 'Editar usuario' : 'Nuevo usuario'}
        alCerrar={() => {
          if (guardar.isPending) return;
          setCreando(false);
          setEditando(null);
          setError(null);
        }}
      >
        <FormularioUsuario
          usuario={editando}
          onGuardar={(datos) => guardar.mutate(datos)}
          guardando={guardar.isPending}
          error={error}
        />
      </Modal>

      <Modal
        abierto={eliminando !== null}
        titulo="Eliminar usuario"
        alCerrar={() => {
          if (eliminar.isPending) return;
          setEliminando(null);
          setErrorEliminar(null);
        }}
      >
        <Aviso
          tono="error"
          titulo={`Se eliminara la cuenta de ${eliminando?.nombre ?? ''}`}
        >
          Esta accion no se puede deshacer. El historial de asistencias y entregas se conserva, pero
          la cuenta ya no podra iniciar sesion.
        </Aviso>

        <p className="mt-3 text-sm text-neutro-600">
          Si solo desea retirarle el acceso temporalmente, use <strong>Desactivar</strong> en lugar
          de eliminar. La cuenta se conserva y puede reactivarse despues.
        </p>

        {errorEliminar ? (
          <div className="mt-3">
            <Aviso tono="error">{errorEliminar}</Aviso>
          </div>
        ) : null}

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            className="boton-secundario"
            onClick={() => {
              setEliminando(null);
              setErrorEliminar(null);
            }}
            disabled={eliminar.isPending}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="boton-peligro"
            onClick={() => {
              if (!eliminando) return;
              eliminar.mutate(eliminando);
            }}
            disabled={eliminar.isPending}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            {eliminar.isPending ? 'Eliminando' : 'Eliminar usuario'}
          </button>
        </div>
      </Modal>
    </div>
  );
}

function FormularioUsuario({
  usuario,
  onGuardar,
  guardando,
  error,
}: {
  usuario: Usuario | null;
  onGuardar: (datos: DatosUsuario & { idOriginal?: string }) => void;
  guardando: boolean;
  error: string | null;
}) {
  const esEdicion = usuario !== null;
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<DatosUsuario>({
    resolver: zodResolver(esEdicion ? esquemaEditar : esquemaCrear),
    defaultValues: {
      nombre: usuario?.nombre ?? '',
      email: usuario?.email ?? '',
      password: '',
      rol: usuario?.rol ?? 'operador',
    },
  });

  return (
    <form
      className="space-y-4"
      onSubmit={handleSubmit((datos) => onGuardar({ ...datos, idOriginal: usuario?.id }))}
    >
      {error ? <Aviso tono="error">{error}</Aviso> : null}

      <div>
        <label htmlFor="usuario-nombre" className="etiqueta-campo">
          Nombre
        </label>
        <input id="usuario-nombre" className="campo" {...register('nombre')} />
        {errors.nombre ? (
          <p className="mt-1 text-sm text-error-600">{errors.nombre.message}</p>
        ) : null}
      </div>

      <div>
        <label htmlFor="usuario-email" className="etiqueta-campo">
          Correo electronico
        </label>
        <input id="usuario-email" type="email" className="campo" {...register('email')} />
        {errors.email ? (
          <p className="mt-1 text-sm text-error-600">{errors.email.message}</p>
        ) : null}
      </div>

      <div>
        <label htmlFor="usuario-password" className="etiqueta-campo">
          {esEdicion ? 'Nueva contrasena (opcional)' : 'Contrasena'}
        </label>
        <input
          id="usuario-password"
          type="password"
          autoComplete="new-password"
          className="campo"
          {...register('password')}
        />
        {esEdicion ? (
          <p className="mt-1 text-xs text-neutro-500">
            Dejela en blanco para conservar la contrasena actual.
          </p>
        ) : null}
        {errors.password ? (
          <p className="mt-1 text-sm text-error-600">{errors.password.message}</p>
        ) : null}
      </div>

      <div>
        <label htmlFor="usuario-rol" className="etiqueta-campo">
          Rol
        </label>
        <select id="usuario-rol" className="campo" {...register('rol')}>
          <option value="operador">Operador</option>
          <option value="admin">Administrador</option>
        </select>
      </div>

      <div className="flex justify-end">
        <button type="submit" className="boton-primario" disabled={guardando}>
          {guardando ? 'Guardando' : 'Guardar'}
        </button>
      </div>
    </form>
  );
}
