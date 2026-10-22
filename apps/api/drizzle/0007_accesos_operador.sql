-- =============================================================================
-- Migracion 0007: accesos del operador y jornada por horario
--
-- 1. La app del operador deja de mostrar un selector de jornada: la jornada se
--    deduce del horario. Para eso solo hacen falta las horas de cada jornada,
--    que ya existen, y un margen despues del cierre que permita registrar las
--    salidas (por defecto 20 minutos).
-- 2. El administrador decide que modulos ve el operador (ingreso, refrigerio y
--    salida) y puede fijar la jornada en curso si el evento se corre.
-- 3. Se ajustan las dos jornadas del seminario a 8:00-12:00 y 14:00-18:00
--    (hora de Bogota), con la ventana de registro abierta durante toda la
--    jornada. Solo se toca lo que siga con los horarios del sembrado inicial
--    (7:00-13:00 y 13:00-18:00); si el administrador ya los cambio, se
--    respetan.
-- =============================================================================

-- migrate:up

ALTER TABLE seminario_config
  ADD COLUMN IF NOT EXISTS operador_ingreso_habilitado boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS operador_refrigerio_habilitado boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS operador_salida_habilitado boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS margen_cierre_minutos integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS jornada_forzada_id integer;

ALTER TABLE seminario_config
  ADD CONSTRAINT seminario_config_margen_cierre_check
  CHECK (margen_cierre_minutos BETWEEN 0 AND 180);

ALTER TABLE seminario_config
  ADD CONSTRAINT seminario_config_jornada_forzada_fk
  FOREIGN KEY (jornada_forzada_id) REFERENCES jornadas (id) ON DELETE SET NULL;

-- Manana: 8:00 a 12:00 (hora de Bogota), registro abierto de 8:00 a 12:00.
WITH nuevo AS (
  SELECT
    id,
    ((inicio AT TIME ZONE 'America/Bogota')::date + time '08:00') AT TIME ZONE 'America/Bogota'
      AS nuevo_inicio,
    ((inicio AT TIME ZONE 'America/Bogota')::date + time '12:00') AT TIME ZONE 'America/Bogota'
      AS nuevo_fin
  FROM jornadas
  WHERE orden = 1
    AND (inicio AT TIME ZONE 'America/Bogota')::time = time '07:00'
    AND (fin AT TIME ZONE 'America/Bogota')::time = time '13:00'
)
UPDATE jornadas j
SET inicio = n.nuevo_inicio,
    fin = n.nuevo_fin,
    ventana_checkin_inicio = n.nuevo_inicio,
    ventana_checkin_fin = n.nuevo_fin
FROM nuevo n
WHERE j.id = n.id;

-- Tarde: 14:00 a 18:00 (hora de Bogota), registro abierto de 14:00 a 18:00.
WITH nuevo AS (
  SELECT
    id,
    ((inicio AT TIME ZONE 'America/Bogota')::date + time '14:00') AT TIME ZONE 'America/Bogota'
      AS nuevo_inicio,
    ((inicio AT TIME ZONE 'America/Bogota')::date + time '18:00') AT TIME ZONE 'America/Bogota'
      AS nuevo_fin
  FROM jornadas
  WHERE orden = 2
    AND (inicio AT TIME ZONE 'America/Bogota')::time = time '13:00'
    AND (fin AT TIME ZONE 'America/Bogota')::time = time '18:00'
)
UPDATE jornadas j
SET inicio = n.nuevo_inicio,
    fin = n.nuevo_fin,
    ventana_checkin_inicio = n.nuevo_inicio,
    ventana_checkin_fin = n.nuevo_fin
FROM nuevo n
WHERE j.id = n.id;

-- migrate:down

ALTER TABLE seminario_config DROP CONSTRAINT IF EXISTS seminario_config_jornada_forzada_fk;
ALTER TABLE seminario_config DROP CONSTRAINT IF EXISTS seminario_config_margen_cierre_check;

ALTER TABLE seminario_config
  DROP COLUMN IF EXISTS jornada_forzada_id,
  DROP COLUMN IF EXISTS margen_cierre_minutos,
  DROP COLUMN IF EXISTS operador_salida_habilitado,
  DROP COLUMN IF EXISTS operador_refrigerio_habilitado,
  DROP COLUMN IF EXISTS operador_ingreso_habilitado;

-- Se devuelven los horarios del sembrado anterior en las jornadas que sigan con
-- los nuevos, con la ventana que usaba la migracion 0005 (30 antes, 60 despues).
WITH anterior AS (
  SELECT
    id,
    ((inicio AT TIME ZONE 'America/Bogota')::date + time '07:00') AT TIME ZONE 'America/Bogota'
      AS viejo_inicio,
    ((inicio AT TIME ZONE 'America/Bogota')::date + time '13:00') AT TIME ZONE 'America/Bogota'
      AS viejo_fin
  FROM jornadas
  WHERE orden = 1
    AND (inicio AT TIME ZONE 'America/Bogota')::time = time '08:00'
    AND (fin AT TIME ZONE 'America/Bogota')::time = time '12:00'
)
UPDATE jornadas j
SET inicio = a.viejo_inicio,
    fin = a.viejo_fin,
    ventana_checkin_inicio = a.viejo_inicio - interval '30 minutes',
    ventana_checkin_fin = a.viejo_inicio + interval '60 minutes'
FROM anterior a
WHERE j.id = a.id;

WITH anterior AS (
  SELECT
    id,
    ((inicio AT TIME ZONE 'America/Bogota')::date + time '13:00') AT TIME ZONE 'America/Bogota'
      AS viejo_inicio,
    ((inicio AT TIME ZONE 'America/Bogota')::date + time '18:00') AT TIME ZONE 'America/Bogota'
      AS viejo_fin
  FROM jornadas
  WHERE orden = 2
    AND (inicio AT TIME ZONE 'America/Bogota')::time = time '14:00'
    AND (fin AT TIME ZONE 'America/Bogota')::time = time '18:00'
)
UPDATE jornadas j
SET inicio = a.viejo_inicio,
    fin = a.viejo_fin,
    ventana_checkin_inicio = a.viejo_inicio - interval '30 minutes',
    ventana_checkin_fin = a.viejo_inicio + interval '60 minutes'
FROM anterior a
WHERE j.id = a.id;
