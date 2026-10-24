-- =============================================================================
-- Migracion 0012: seguimiento del envio de la credencial por asistente
--
-- El envio se reparte en varios dias (20 correos por hora) para no caer en spam,
-- asi que hace falta saber a quien ya se le envio, a quien no y a quien le
-- fallo, para no duplicar ni perder a nadie.
-- =============================================================================

-- migrate:up

ALTER TABLE asistentes
  ADD COLUMN IF NOT EXISTS credencial_estado text,
  ADD COLUMN IF NOT EXISTS credencial_enviada_at timestamptz,
  ADD COLUMN IF NOT EXISTS credencial_error text;

ALTER TABLE asistentes
  ADD CONSTRAINT asistentes_credencial_estado_check
  CHECK (credencial_estado IS NULL OR credencial_estado IN ('en_cola', 'enviada', 'error'));

CREATE INDEX IF NOT EXISTS asistentes_credencial_estado_idx
  ON asistentes (credencial_estado);

-- migrate:down

DROP INDEX IF EXISTS asistentes_credencial_estado_idx;

ALTER TABLE asistentes
  DROP CONSTRAINT IF EXISTS asistentes_credencial_estado_check;

ALTER TABLE asistentes
  DROP COLUMN IF EXISTS credencial_error,
  DROP COLUMN IF EXISTS credencial_enviada_at,
  DROP COLUMN IF EXISTS credencial_estado;
