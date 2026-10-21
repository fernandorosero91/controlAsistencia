-- =============================================================================
-- Migracion 0003: datos de lugar, facultad y contacto del seminario
--
-- These campos appear on the certificate and allow the event to be identified
-- without having to edit the free texts.
-- =============================================================================

-- migrate:up

ALTER TABLE seminario_config
  ADD COLUMN lugar text,
  ADD COLUMN facultad text,
  ADD COLUMN contacto text;

-- migrate:down

ALTER TABLE seminario_config
  DROP COLUMN IF EXISTS contacto,
  DROP COLUMN IF EXISTS facultad,
  DROP COLUMN IF EXISTS lugar;
