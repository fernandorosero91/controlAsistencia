import argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { construirAplicacion } from '../../src/app.js';
import { db } from '../../src/db/cliente.js';
import {
  asistencias,
  asistentes,
  entregasRefrigerio,
  jornadas,
  seminarioConfig,
  tiposRefrigerio,
  tiposSouvenir,
  usuariosSistema,
} from '../../src/db/esquema.js';
import { aplicarMigraciones } from '../../src/db/migrate.js';

export const CORREO_ADMIN = 'admin@pruebas.local';
export const CLAVE_ADMIN = 'Pruebas2026';
export const ID_ASISTENTE = 'PRUEBA0001';
export const ID_ASISTENTE_2 = 'PRUEBA0002';
export const ID_ASISTENTE_3 = 'PRUEBA0003';

export function hayBaseDePruebas(): boolean {
  return Boolean(process.env.DATABASE_URL_TEST);
}

/** Deja la base de datos de pruebas en un estado conocido y minimo. */
export async function prepararBaseDePruebas(): Promise<void> {
  await aplicarMigraciones();

  await db.execute(
    `TRUNCATE TABLE auditoria, idempotencia, certificados, certificados_lotes,
       lotes_certificados_docx, plantillas_certificado,
       entregas_souvenir, tipos_souvenir,
       entregas_refrigerio, asistencias, asistentes, tipos_refrigerio, jornadas,
       refresh_tokens, usuarios_sistema, seminario_config RESTART IDENTITY CASCADE`,
  );

  const hash = await argon2.hash(CLAVE_ADMIN, { type: argon2.argon2id });
  await db.insert(usuariosSistema).values({
    nombre: 'Administrador de pruebas',
    email: CORREO_ADMIN,
    passwordHash: hash,
    rol: 'admin',
  });

  const ahora = new Date();
  const inicio = new Date(ahora.getTime() - 24 * 60 * 60 * 1000);
  const fin = new Date(ahora.getTime() + 24 * 60 * 60 * 1000);

  await db.insert(seminarioConfig).values({
    id: 1,
    nombre: 'Seminario de pruebas',
    fecha: ahora.toISOString().slice(0, 10),
    horaFinSeminario: new Date(ahora.getTime() - 30 * 60 * 1000),
    toleranciaMinutos: 15,
    exigirAmbasJornadas: true,
    intensidadHoraria: 8,
    permitirRegistroFueraDeVentana: true,
    idRegex: '^[A-Z0-9]{4,20}$',
  });

  const jornadasCreadas = await db
    .insert(jornadas)
    .values([
      {
        nombre: 'Manana',
        inicio,
        fin,
        ventanaCheckinInicio: inicio,
        ventanaCheckinFin: fin,
        orden: 1,
      },
      {
        nombre: 'Tarde',
        inicio,
        fin,
        ventanaCheckinInicio: inicio,
        ventanaCheckinFin: fin,
        orden: 2,
      },
    ])
    .returning({ id: jornadas.id });

  await db.insert(tiposRefrigerio).values({
    nombre: 'Refrigerio de pruebas',
    jornadaId: jornadasCreadas[0]!.id,
    activo: true,
    orden: 1,
  });

  await db.insert(tiposSouvenir).values({
    nombre: 'Souvenir de pruebas',
    activo: true,
    orden: 1,
  });

  await db.insert(asistentes).values([
    {
      id: ID_ASISTENTE,
      nombres: 'Ana',
      apellidos: 'Prueba Integracion',
      rol: 'estudiante',
      semestre: 3,
    },
    {
      id: ID_ASISTENTE_2,
      nombres: 'Luis',
      apellidos: 'Prueba Integracion',
      rol: 'estudiante',
      semestre: 5,
    },
    {
      id: ID_ASISTENTE_3,
      nombres: 'Sofia',
      apellidos: 'Prueba Integracion',
      rol: 'docente',
      semestre: null,
    },
  ]);
}

export async function crearAplicacionDePruebas(): Promise<FastifyInstance> {
  const app = await construirAplicacion();
  await app.ready();
  return app;
}

export async function contarAsistencias(asistenteId: string): Promise<number> {
  const filas = await db
    .select({ id: asistencias.id })
    .from(asistencias)
    .where(eq(asistencias.asistenteId, asistenteId));
  return filas.length;
}

export async function contarEntregas(asistenteId: string): Promise<number> {
  const filas = await db
    .select({ id: entregasRefrigerio.id })
    .from(entregasRefrigerio)
    .where(eq(entregasRefrigerio.asistenteId, asistenteId));
  return filas.length;
}
