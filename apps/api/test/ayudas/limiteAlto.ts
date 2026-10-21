/**
 * Sube el limite de escaneo antes de que se cargue la aplicacion.
 *
 * El limite de 80 peticiones por minuto y por operador es una proteccion
 * valida en produccion, pero las pruebas de concurrencia mandan cien
 * peticiones simultaneas al mismo registro: lo que se debe medir ahi es la
 * unicidad garantizada por la base de datos, no el limitador de tasa.
 *
 * Este modulo se importa antes que la aplicacion porque el limite se fija
 * cuando se registran las rutas.
 */
process.env.RATE_LIMIT_ESCANEO_MAX = '1000';

export {};
