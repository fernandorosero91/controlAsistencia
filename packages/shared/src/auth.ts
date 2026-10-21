import { z } from 'zod';
import { ROLES_SISTEMA } from './enums.js';

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Correo electronico invalido'),
  password: z.string().min(8, 'La contrasena debe tener al menos 8 caracteres').max(128),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const usuarioSistemaSchema = z.object({
  id: z.string().uuid(),
  nombre: z.string(),
  email: z.string().email(),
  rol: z.enum(ROLES_SISTEMA),
  activo: z.boolean(),
});

export type UsuarioSistema = z.infer<typeof usuarioSistemaSchema>;

export const respuestaLoginSchema = z.object({
  usuario: usuarioSistemaSchema,
  tokenAcceso: z.string(),
  expiraEn: z.number(),
});

export type RespuestaLogin = z.infer<typeof respuestaLoginSchema>;

export const crearUsuarioSchema = z.object({
  nombre: z.string().trim().min(3).max(120),
  email: z.string().trim().toLowerCase().email('Correo electronico invalido'),
  password: z.string().min(8, 'La contrasena debe tener al menos 8 caracteres').max(128),
  rol: z.enum(ROLES_SISTEMA),
});

export type CrearUsuarioInput = z.infer<typeof crearUsuarioSchema>;

export const actualizarUsuarioSchema = z.object({
  nombre: z.string().trim().min(3).max(120).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  password: z.string().min(8).max(128).optional(),
  rol: z.enum(ROLES_SISTEMA).optional(),
  activo: z.boolean().optional(),
});

export type ActualizarUsuarioInput = z.infer<typeof actualizarUsuarioSchema>;

export const cambiarPasswordSchema = z.object({
  passwordActual: z.string().min(1).max(128),
  passwordNuevo: z.string().min(8).max(128),
});

export type CambiarPasswordInput = z.infer<typeof cambiarPasswordSchema>;
