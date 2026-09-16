-- v001_crear_tablas_billing.sql
-- Crea las tablas NUEVAS para el modulo de Facturacion Semanal dentro de
-- BILLING_DB (misma base fisica que supreme-autopro-pro-staging, ligada
-- tambien a bold-mouse-3bc3-pro-staging).
--
-- NUNCA toca las 7 tablas existentes: _environment, _verify_hist88,
-- _verify_paid_refs, deleted_keys, edits, new_invoices, sent_states.
-- Solo usa CREATE TABLE IF NOT EXISTS -- nunca ALTER ni DROP sobre nada
-- existente.
--
-- NO EJECUTAR contra la base real sin: (1) wrangler d1 export --remote
-- validado, (2) aprobacion explicita de Michelle.

CREATE TABLE IF NOT EXISTS invoice_counter (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  siguiente_numero INTEGER NOT NULL
);
-- Nota: esta tabla se inicializa aparte (no en este script) con el maximo
-- real verificado contra toda la verdad del servidor (historico +
-- new_invoices), nunca con un valor arbitrario. Ver billing-db.js:
-- initCounterFromServerTruth().

CREATE TABLE IF NOT EXISTS asignaciones_invoice (
  wo TEXT NOT NULL UNIQUE,
  order_number INTEGER NOT NULL UNIQUE,
  bloque_id TEXT,
  asignado_en TEXT NOT NULL,
  asignado_por TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha_utc TEXT NOT NULL,
  usuario TEXT NOT NULL,
  accion TEXT NOT NULL,
  wo TEXT,
  order_number TEXT,
  bloque_id TEXT,
  valor_anterior TEXT,
  valor_nuevo TEXT,
  origen TEXT
);

CREATE TABLE IF NOT EXISTS fecha_servicio (
  wo TEXT PRIMARY KEY,
  fecha TEXT,
  hora TEXT,
  origen TEXT NOT NULL,
  bloque_id TEXT,
  confirmada_por TEXT,
  confirmada_en TEXT
);
