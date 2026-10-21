-- Ajustes que se aplican al crear el servidor de PostgreSQL por primera vez.
-- El limite de sentencia se fija aqui (y no en el cliente) porque en modo
-- transaction de PgBouncer los parametros de arranque se descartan.

ALTER ROLE app SET statement_timeout = '10s';
ALTER ROLE app SET idle_in_transaction_session_timeout = '30s';
ALTER DATABASE seminario SET statement_timeout = '10s';
