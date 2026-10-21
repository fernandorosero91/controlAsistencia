import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router-dom';
import { KeyRound, LogIn } from 'lucide-react';
import { loginSchema } from '@seminario/shared';
import type { LoginInput } from '@seminario/shared';
import { api, ErrorPeticion } from '../lib/api';
import { useSesion } from '../estado/sesion';
import { Aviso } from '../componentes/comunes';

type DatosLogin = LoginInput;

export function Login() {
  const navegar = useNavigate();
  const establecerSesion = useSesion((estado) => estado.establecerSesion);
  const [error, setError] = useState<string | null>(null);

  const { data: evento } = useQuery({
    queryKey: ['publico', 'seminario'],
    queryFn: () =>
      api.obtener<{ nombre: string; lugar: string | null; facultad: string | null }>(
        '/publico/seminario',
      ),
    staleTime: 5 * 60_000,
    retry: false,
  });

  const seminarioNombre = evento?.nombre ?? 'Seminario';

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<DatosLogin>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const enviar = handleSubmit(async (datos) => {
    setError(null);
    try {
      const respuesta = await api.crear<{
        usuario: {
          id: string;
          nombre: string;
          email: string;
          rol: 'admin' | 'operador';
          activo: boolean;
        };
        tokenAcceso: string;
        expiraEn: number;
      }>('/auth/login', datos, { reintentar: false });

      establecerSesion(respuesta.usuario, respuesta.tokenAcceso, respuesta.expiraEn);
      navegar(respuesta.usuario.rol === 'admin' ? '/admin' : '/operador', { replace: true });
    } catch (problema) {
      setError(
        problema instanceof ErrorPeticion
          ? problema.message
          : 'No se pudo conectar con el servidor. Revise la red e intente de nuevo.',
      );
    }
  });

  return (
    <div className="flex min-h-dvh flex-col justify-center bg-primario-50 px-4 py-8">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-6 text-center">
          <img
            src="/logo-ucc.svg"
            alt="Universidad Cooperativa de Colombia"
            className="mx-auto h-12 w-auto"
          />
          <h1 className="mt-4 text-xl font-bold text-primario-900">Control de asistencia</h1>
          <p className="mt-1 text-sm text-neutro-600">
            {seminarioNombre} - Ingreso para administradores y operadores
          </p>
        </div>

        <form onSubmit={enviar} className="superficie space-y-4 p-5" noValidate>
          {error ? (
            <Aviso tono="error" titulo="No se pudo iniciar sesion">
              {error}
            </Aviso>
          ) : null}

          <div>
            <label htmlFor="email" className="etiqueta-campo">
              Correo electronico
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              inputMode="email"
              className="campo"
              aria-invalid={errors.email ? 'true' : 'false'}
              aria-describedby={errors.email ? 'error-email' : undefined}
              {...register('email')}
            />
            {errors.email ? (
              <p id="error-email" className="mt-1 text-sm text-error-600">
                {errors.email.message}
              </p>
            ) : null}
          </div>

          <div>
            <label htmlFor="password" className="etiqueta-campo">
              Contrasena
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              className="campo"
              aria-invalid={errors.password ? 'true' : 'false'}
              aria-describedby={errors.password ? 'error-password' : undefined}
              {...register('password')}
            />
            {errors.password ? (
              <p id="error-password" className="mt-1 text-sm text-error-600">
                {errors.password.message}
              </p>
            ) : null}
          </div>

          <button type="submit" className="boton-primario w-full" disabled={isSubmitting}>
            <LogIn className="h-5 w-5" aria-hidden="true" />
            {isSubmitting ? 'Verificando' : 'Entrar'}
          </button>

          <p className="flex items-start gap-2 text-xs text-neutro-500">
            <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Las credenciales son entregadas por la coordinacion del seminario.
          </p>
        </form>
      </div>
    </div>
  );
}
