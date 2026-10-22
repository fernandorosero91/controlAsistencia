-- =============================================================================
-- Migracion 0009: plantillas de certificado en formato DOCX
--
-- El administrador sube una plantilla .docx con los campos entre dobles llaves
-- ({{nombre}}, {{cedula}}, {{id}}, {{rol}}, {{semestre}}) y el sistema genera un
-- certificado por asistente reemplazando esos campos en el XML del documento.
-- La plantilla original se guarda en disco; aqui quedan sus metadatos.
-- =============================================================================

-- migrate:up

CREATE TABLE plantillas_certificado (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL CHECK (length(btrim(nombre)) >= 3),
  nombre_archivo text,
  ruta_archivo text NOT NULL,
  tamano_bytes bigint,
  campos_detectados text[] NOT NULL DEFAULT '{}',
  es_predeterminada boolean NOT NULL DEFAULT false,
  activa boolean NOT NULL DEFAULT true,
  creado_por uuid REFERENCES usuarios_sistema(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Solo puede existir una plantilla predeterminada a la vez.
CREATE UNIQUE INDEX plantillas_certificado_predeterminada_idx
  ON plantillas_certificado (es_predeterminada)
  WHERE es_predeterminada;

CREATE INDEX plantillas_certificado_activa_idx ON plantillas_certificado (activa);

CREATE TRIGGER plantillas_certificado_updated_at
  BEFORE UPDATE ON plantillas_certificado
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- migrate:down

DROP TRIGGER IF EXISTS plantillas_certificado_updated_at ON plantillas_certificado;
DROP INDEX IF EXISTS plantillas_certificado_activa_idx;
DROP INDEX IF EXISTS plantillas_certificado_predeterminada_idx;
DROP TABLE IF EXISTS plantillas_certificado;
