-- migrate:up

-- El administrador puede entregar el souvenir a quien no cumple la condicion
-- (no registro su ingreso en la primera jornada). Queda marcado como excepcion
-- con el motivo obligatorio, para poder auditarlo y reportarlo.
ALTER TABLE entregas_souvenir
  ADD COLUMN excepcion_manual boolean NOT NULL DEFAULT false,
  ADD COLUMN motivo_excepcion text;

-- migrate:down

ALTER TABLE entregas_souvenir
  DROP COLUMN IF EXISTS motivo_excepcion,
  DROP COLUMN IF EXISTS excepcion_manual;
