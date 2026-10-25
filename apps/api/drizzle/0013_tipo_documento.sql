-- migrate:up

-- El documento de identidad puede ser cedula de ciudadania o tarjeta de identidad.
DO $$
BEGIN
  CREATE TYPE tipo_documento AS ENUM ('CC', 'TI');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

ALTER TABLE asistentes
  DROP CONSTRAINT IF EXISTS asistentes_semestre_rol;

ALTER TABLE asistentes
  ADD COLUMN tipo_documento tipo_documento NOT NULL DEFAULT 'CC';

-- migrate:down

ALTER TABLE asistentes
  DROP CONSTRAINT IF EXISTS asistentes_tipo_documento_check;

ALTER TABLE asistentes
  DROP COLUMN IF EXISTS tipo_documento;

DROP TYPE IF EXISTS tipo_documento;