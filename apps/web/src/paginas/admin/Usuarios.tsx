import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Pencil, Plus, ShieldCheck, UserCog } from 'lucide-react';
import { api, ErrorPeticion } from '../../lib/api';
import { formatearFechaHora } from '../../lib/formato';
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

const esquema = z.object({
  nombre: z.string().trim().min(3, 'El nombre es obligatorio').max(120),
  email: z.string().trim().toLowerCase().email('Correo electronico invalido'),
  password: z.string().min(8, 'La contrasena debe tener al menos 8 caracteres').max(128),
  rol: z.enum(['admin', 'operador']),
});

type DatosUsuario = z.infer<typeof esquema>;

export function Usuarios() {
  const cliente = useQueryClient();
  const [creando, setCreando] = useState(false);
  const [editando, setEditando] = useState<Usuario | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        });
      }
      return api.crear('/usuarios', datos);
    },
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['usuarios'] });
      setCreando(false);
      setEditando(null);
      setError(null);
    },
    onError: (problema) => {
      setError(
        problema instanceof ErrorPeticion ? problema.message : 'No se pudo guardar el usuario',
      );
    },
  });

  const alternarActivo = useMutation({
    mutationFn: async (usuario: Usuario) =>
      api.actualizar(`/usuarios/${usuario.id}`, { activo: !usuario.activo }),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ['usuarios'] }),
  });

  return (
    <div className="space-y-4">
      <Tarjeta
        titulo="Usuarios del sistema"
        descripcion="Administradores con acceso total y operadores dedicados al registro"
        accion={
          <button type="button" className="boton-primario" onClick={() => setCreando(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Nuevo usuario
          </button>
        }
      >
        {error ? (
          <div className="mb-3">
            <Aviso tono="error">{error}</Aviso>
          </div>
        ) : null}

        <Aviso tono="primario" titulo="Permisos">
          El rol de administrador es el unico que puede emitir, descargar y revocar certificados.
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
                  <th scope="col">Ultimo acceso</th>
                  <th scope="col" className="text-right">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody className="tabla-cuerpo">
                {(data?.datos ?? []).map((usuario) => (
                  <tr key={usuario.id}>
                    <td className="text-neutro-900">{usuario.nombre}</td>
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
                          onClick={() => setEditando(usuario)}
                          aria-label={`Editar a ${usuario.nombre}`}
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="boton-compacto text-neutro-700 hover:bg-neutro-100"
                          onClick={() => alternarActivo.mutate(usuario)}
                          aria-label={`Cambiar el estado de ${usuario.nombre}`}
                        >
                          {usuario.activo ? 'Desactivar' : 'Activar'}
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
          setCreando(false);
          setEditando(null);
        }}
      >
        <FormularioUsuario
          usuario={editando}
          onGuardar={(datos) => guardar.mutate(datos)}
          guardando={guardar.isPending}
        />
      </Modal>
    </div>
  );
}

function FormularioUsuario({
  usuario,
  onGuardar,
  guardando,
}: {
  usuario: Usuario | null;
  onGuardar: (datos: DatosUsuario & { idOriginal?: string }) => void;
  guardando: boolean;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<DatosUsuario>({
    resolver: zodResolver(esquema),
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

      {!usuario ? (
        <div>
          <label htmlFor="usuario-password" className="etiqueta-campo">
            Contrasena
          </label>
          <input
            id="usuario-password"
            type="password"
            autoComplete="new-password"
            className="campo"
            {...register('password')}
          />
          {errors.password ? (
            <p className="mt-1 text-sm text-error-600">{errors.password.message}</p>
          ) : null}
        </div>
      ) : null}

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
