-- =============================================================================
-- Migracion 0002: normaliza los codigos de registro al formato corto de 6 caracteres
--
-- La 0001 genero codigos de 8 caracteres con el hash md5. El formato definitivo,
-- que usan el QR, la escarapela y la busqueda del operador, es de 6 caracteres
-- del alfabeto sin O, I, 0 ni 1, que se puede dictar sin ambiguedad.
-- =============================================================================

-- migrate:up

-- Se suspende temporalmente el trigger de inmutabilidad para poder normalizar.
DROP TRIGGER IF EXISTS asistentes_codigo_registro_inmutable ON asistentes;

-- Generador de codigos en el servidor, con el mismo alfabeto que la aplicacion.
CREATE OR REPLACE FUNCTION generar_codigo_registro_pg() RETURNS text AS $$
DECLARE
  alfabeto constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  resultado text := '';
  i integer;
  pos integer;
BEGIN
  FOR i IN 1..6 LOOP
    pos := floor(random() * 32)::integer + 1;
    resultado := resultado || substr(alfabeto, pos, 1);
  END LOOP;
  RETURN resultado;
END;
$$ LANGUAGE plpgsql;

-- Se normalizan los codigos que no cumplen el formato definitivo.
UPDATE asistentes
SET codigo_registro = generar_codigo_registro_pg()
WHERE codigo_registro IS NULL
   OR length(codigo_registro) <> 6
   OR codigo_registro ~ '[OI01]';

-- Se resuelven posibles colisiones antes de dejar el indice unico vigente.
UPDATE asistentes a
SET codigo_registro = generar_codigo_registro_pg()
WHERE a.codigo_registro IN (
  SELECT codigo_registro
  FROM asistentes
  GROUP BY codigo_registro
  HAVING count(*) > 1
);

-- Se restablece la garantia de inmutabilidad del codigo de registro.
CREATE TRIGGER asistentes_codigo_registro_inmutable
  BEFORE UPDATE ON asistentes
  FOR EACH ROW EXECUTE FUNCTION disparador_codigo_registro_inmutable();

-- migrate:down

DROP FUNCTION IF EXISTS generar_codigo_registro_pg();
SELECT 1;
