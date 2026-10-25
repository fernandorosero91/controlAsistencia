-- migrate:up

-- El semestre no es obligatorio para estudiantes: el archivo institucional
-- puede traerlo como N/A.
ALTER TABLE asistentes
  DROP CONSTRAINT IF EXISTS asistentes_semestre_rol;

-- migrate:down

ALTER TABLE asistentes
  ADD CONSTRAINT asistentes_semestre_rol
  CHECK ((rol = 'estudiante') = (semestre IS NOT NULL));
