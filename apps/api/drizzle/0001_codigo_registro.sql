-- =============================================================================
-- Migracion 0001: correo electronico y codigo de registro por asistente
--
-- El codigo de registro es el identificador corto que la app genera para cada
-- asistente: unico, aleatorio y facil de dictar al digitarlo. Es lo que
-- codifica el QR de la escarapela. El operador puede escribir indistintamente
-- el ID institucional o este codigo.
-- =============================================================================

-- migrate:up

ALTER TABLE asistentes
  ADD COLUMN email text,
  ADD COLUMN codigo_registro text;

-- Codigo de registro para los asistentes existentes: seis caracteres del
-- alfabeto sin caracteres ambiguos (se excluyen O, I, 0 y 1).
UPDATE asistentes
SET codigo_registro = upper(
  translate(substring(md5(random()::text || id), 1, 8), 'oil', 'ABC')
);

-- Restriccion de unicidad del codigo de registro
CREATE UNIQUE INDEX asistentes_codigo_registro_idx
  ON asistentes (codigo_registro)
  WHERE codigo_registro IS NOT NULL;

-- Validacion basica del correo electronico cuando viene informado
ALTER TABLE asistentes
  ADD CONSTRAINT asistentes_email_formato
  CHECK (email IS NULL OR email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}$');

-- Indice para localizar asistentes por correo (envio de QR y comunicacion)
CREATE INDEX asistentes_email_idx ON asistentes (lower(email)) WHERE email IS NOT NULL;

-- El codigo de registro es inmutable, igual que el ID institucional
CREATE OR REPLACE FUNCTION disparador_codigo_registro_inmutable() RETURNS trigger AS $$
BEGIN
  IF OLD.codigo_registro IS DISTINCT FROM NEW.codigo_registro THEN
    RAISE EXCEPTION 'El codigo de registro de un asistente es inmutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER asistentes_codigo_registro_inmutable
  BEFORE UPDATE ON asistentes
  FOR EACH ROW EXECUTE FUNCTION disparador_codigo_registro_inmutable();

-- migrate:down

DROP TRIGGER IF EXISTS asistentes_codigo_registro_inmutable ON asistentes;
DROP FUNCTION IF EXISTS disparador_codigo_registro_inmutable();
DROP INDEX IF EXISTS asistentes_email_idx;
ALTER TABLE asistentes DROP CONSTRAINT IF EXISTS asistentes_email_formato;
DROP INDEX IF EXISTS asistentes_codigo_registro_idx;
ALTER TABLE asistentes
  DROP COLUMN IF EXISTS codigo_registro,
  DROP COLUMN IF EXISTS email;
