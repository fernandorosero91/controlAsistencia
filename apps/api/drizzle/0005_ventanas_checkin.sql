-- =============================================================================
-- Migracion 0005: ventanas de registro de las jornadas
--
-- El seed inicial armo las ventanas de check-in sumando horas donde debian
-- sumar minutos: la ventana de la manana quedo entre el 27/10 a las 00:00 y el
-- 29/10 a las 20:00, y la de la tarde entre el 27/10 a las 00:00 y el 30/10 a
-- las 01:00. Ningun registro quedaba bloqueado, pero las ventanas no
-- correspondian a lo que el panel muestra.
--
-- La regla correcta es la que usa el seed: la ventana abre 30 minutos antes
-- del inicio de la jornada y cierra 60 minutos despues de ese inicio.
--
-- Solo se corrigen las jornadas con la ventana rota (mas de tres horas de
-- duracion). Las que el administrador haya ajustado a mano se respetan.
-- =============================================================================

-- migrate:up

UPDATE jornadas
SET ventana_checkin_inicio = inicio - interval '30 minutes',
    ventana_checkin_fin = inicio + interval '60 minutes'
WHERE ventana_checkin_fin > inicio + interval '3 hours';

-- migrate:down

-- Se restaura el valor anterior (la ventana larga del seed original). Es una
-- restauracion aproximada: no guarda memoria de como quedo cada jornada antes
-- de la correccion.
UPDATE jornadas
SET ventana_checkin_inicio = date_trunc('day', inicio - interval '5 hours') + interval '5 hours',
    ventana_checkin_fin = inicio + interval '60 hours'
WHERE ventana_checkin_fin <= inicio + interval '3 hours';
