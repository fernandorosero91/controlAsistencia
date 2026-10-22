-- =============================================================================
-- Migracion 0010: lotes de certificados DOCX generados
--
-- Cada vez que el administrador genera certificados desde el panel, se guardan
-- los .docx en disco dentro de la carpeta "certificadosGenerados" y se empaqueta
-- un ZIP. Aqui quedan los metadatos del lote para poder listarlo y descargarlo
-- despues con el boton de la interfaz.
-- =============================================================================

-- migrate:up

CREATE TABLE lotes_certificados_docx (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plantilla_id uuid REFERENCES plantillas_certificado(id) ON DELETE SET NULL,
  nombre_plantilla text NOT NULL,
  carpeta text NOT NULL,
  archivo_zip text NOT NULL,
  total integer NOT NULL DEFAULT 0,
  generados integer NOT NULL DEFAULT 0,
  omitidos integer NOT NULL DEFAULT 0,
  tamano_zip bigint,
  generado_por uuid REFERENCES usuarios_sistema(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX lotes_certificados_docx_created_idx
  ON lotes_certificados_docx (created_at DESC);

-- migrate:down

DROP INDEX IF EXISTS lotes_certificados_docx_created_idx;
DROP TABLE IF EXISTS lotes_certificados_docx;
