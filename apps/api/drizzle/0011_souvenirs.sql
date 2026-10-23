-- =============================================================================
-- Migracion 0011: control de entrega de souvenirs y regalos
--
-- El seminario entrega un souvenir o regalo por la asistencia. Se controla con
-- el mismo criterio que los refrigerios: una sola entrega por asistente y tipo,
-- garantizada por el indice unico, y operada desde la app del operador con el
-- modo Souvenir.
--
-- A diferencia del refrigerio, el souvenir no pertenece a una jornada: se
-- entrega una vez por evento, a quien tenga al menos una asistencia registrada.
-- =============================================================================

-- migrate:up

CREATE TABLE tipos_souvenir (
  id integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  nombre text NOT NULL CHECK (length(btrim(nombre)) >= 2),
  activo boolean NOT NULL DEFAULT true,
  orden integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX tipos_souvenir_nombre_idx ON tipos_souvenir (lower(nombre));

CREATE TRIGGER tipos_souvenir_updated_at
  BEFORE UPDATE ON tipos_souvenir
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE entregas_souvenir (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  asistente_id text NOT NULL REFERENCES asistentes (id) ON DELETE RESTRICT,
  tipo_souvenir_id integer NOT NULL REFERENCES tipos_souvenir (id) ON DELETE RESTRICT,
  entregado_at timestamptz NOT NULL DEFAULT now(),
  entregado_por uuid REFERENCES usuarios_sistema (id) ON DELETE SET NULL,
  dispositivo text,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Una sola entrega por asistente y tipo: la garantia de "sin doble entrega".
CREATE UNIQUE INDEX entregas_souvenir_unica_idx
  ON entregas_souvenir (asistente_id, tipo_souvenir_id);
CREATE INDEX entregas_souvenir_tipo_idx
  ON entregas_souvenir (tipo_souvenir_id, entregado_at);
CREATE INDEX entregas_souvenir_hora_idx ON entregas_souvenir (entregado_at);

ALTER TABLE seminario_config
  ADD COLUMN IF NOT EXISTS operador_souvenir_habilitado boolean NOT NULL DEFAULT false;

-- Un tipo inicial para que el modulo funcione apenas se active.
INSERT INTO tipos_souvenir (nombre, activo, orden)
SELECT 'Souvenir del seminario', true, 1
WHERE NOT EXISTS (SELECT 1 FROM tipos_souvenir);

-- migrate:down

ALTER TABLE seminario_config DROP COLUMN IF EXISTS operador_souvenir_habilitado;

DROP TRIGGER IF EXISTS tipos_souvenir_updated_at ON tipos_souvenir;
DROP INDEX IF EXISTS entregas_souvenir_hora_idx;
DROP INDEX IF EXISTS entregas_souvenir_tipo_idx;
DROP INDEX IF EXISTS entregas_souvenir_unica_idx;
DROP TABLE IF EXISTS entregas_souvenir;
DROP INDEX IF EXISTS tipos_souvenir_nombre_idx;
DROP TABLE IF EXISTS tipos_souvenir;
