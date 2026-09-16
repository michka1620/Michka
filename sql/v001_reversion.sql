-- v001_reversion.sql
-- Reversion exacta de v001_crear_tablas_billing.sql.
-- Solo borra las 4 tablas NUEVAS -- nunca toca ninguna de las 7 tablas
-- existentes de supreme-autopro-pro-staging.
-- NO EJECUTAR sin aprobacion explicita de Michelle.

DROP TABLE IF EXISTS fecha_servicio;
DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS asignaciones_invoice;
DROP TABLE IF EXISTS invoice_counter;
