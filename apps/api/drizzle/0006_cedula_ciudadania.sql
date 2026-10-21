-- =============================================================================
-- Migracion 0006: cedula de ciudadania del asistente
--
-- Se agrega la cedula como dato de identificacion del asistente. Es opcional
-- (no todos los registros la traen) pero cuando existe es unica: dos personas
-- no pueden compartir la misma cedula. El indice es parcial, de modo que
-- cuantos asistentes no tengan cedula siguen siendo validos.
--
-- Con la cedula el operador tambien puede registrar a una persona escribiendo
-- su cedula en la app, cuando la escarapela esta danada o mal impresa.
-- =============================================================================

-- migrate:up

ALTER TABLE asistentes
  ADD COLUMN cedula_ciudadania text;

CREATE UNIQUE INDEX asistentes_cedula_ciudadania_idx
  ON asistentes (cedula_ciudadania)
  WHERE cedula_ciudadania IS NOT NULL;

-- migrate:down

DROP INDEX IF EXISTS asistentes_cedula_ciudadania_idx;

ALTER TABLE asistentes
  DROP COLUMN IF EXISTS cedula_ciudadania;
