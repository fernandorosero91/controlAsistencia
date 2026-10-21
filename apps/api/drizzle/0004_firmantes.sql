-- =============================================================================
-- Migracion 0004: firmantes configurables del certificado
--
-- Se guardan como JSONB una lista de hasta tres firmantes (nombre, cargo y
-- dependencia). Asi el administrador decide quien firma el certificado sin
-- tocar el codigo.
-- =============================================================================

-- migrate:up

ALTER TABLE seminario_config
  ADD COLUMN firmas jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE seminario_config
  ADD CONSTRAINT seminario_config_firmas_limite
  CHECK (jsonb_typeof(firmas) = 'array' AND jsonb_array_length(firmas) <= 3);

-- migrate:down

ALTER TABLE seminario_config
  DROP CONSTRAINT IF EXISTS seminario_config_firmas_limite;
ALTER TABLE seminario_config DROP COLUMN IF EXISTS firmas;
