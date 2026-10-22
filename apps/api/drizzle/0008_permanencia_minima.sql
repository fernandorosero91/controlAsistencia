-- =============================================================================
-- Migracion 0008: permanencia minima por jornada
--
-- Para que el certificado tenga sentido, el asistente debe permanecer en cada
-- jornada exigida un minimo de horas. El valor es configurable por el
-- administrador (3 horas por defecto) y se aplica al calcular la elegibilidad,
-- que se recalcula en cada consulta: no hace falta ningun script.
-- =============================================================================

-- migrate:up

ALTER TABLE seminario_config
  ADD COLUMN IF NOT EXISTS minimo_permanencia_horas integer NOT NULL DEFAULT 3;

ALTER TABLE seminario_config
  ADD CONSTRAINT seminario_config_minimo_permanencia_check
  CHECK (minimo_permanencia_horas BETWEEN 0 AND 12);

-- migrate:down

ALTER TABLE seminario_config
  DROP CONSTRAINT IF EXISTS seminario_config_minimo_permanencia_check;

ALTER TABLE seminario_config
  DROP COLUMN IF EXISTS minimo_permanencia_horas;
