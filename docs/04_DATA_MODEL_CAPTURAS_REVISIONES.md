# Paso 6 — Modelo de tablas nuevas (diseño, SQL sin ejecutar)

Aditivas — no tocan `edits`, `deleted_keys`, `new_invoices` ni `sent_states`.

```sql
-- NO EJECUTAR TODAVIA — diseño para revisión de Michelle

CREATE TABLE IF NOT EXISTS capturas (
  id                TEXT PRIMARY KEY,      -- uuid
  r2_key            TEXT NOT NULL,         -- ruta del objeto en R2
  sha256            TEXT NOT NULL,         -- hash del archivo, para deduplicar
  technician        TEXT NOT NULL,         -- 'Luis' | 'John' | ...
  uploaded_at       INTEGER NOT NULL,      -- epoch ms
  billing_week      TEXT,                  -- fecha del miercoles de inicio de esa semana, ej '2026-08-05'
  wo_detected       TEXT,                  -- WO leido por la IA, puede quedar vacio
  invoice_key       TEXT,                  -- number|wo una vez enlazada a una factura
  processing_state  TEXT NOT NULL DEFAULT 'pending', -- pending | processing | done | error
  confidence_json   TEXT,                  -- {"client":"alta","wo":"media",...}
  original_filename TEXT,
  uploaded_by       TEXT                   -- quien subio (igual a technician por ahora, separado por si mas adelante sube otra persona)
);

CREATE TABLE IF NOT EXISTS revisiones (
  id                  TEXT PRIMARY KEY,
  captura_id          TEXT NOT NULL,        -- FK logica a capturas.id
  invoice_key         TEXT,                 -- factura relacionada si ya existe
  motivo              TEXT NOT NULL,        -- 'wo_ilegible' | 'cliente_no_reconocido' | 'posible_duplicado' | 'total_dudoso' | 'captura_incompleta' | 'tecnico_no_detectado' | 'imagen_borrosa' | 'horas_inconsistentes'
  campo_problematico  TEXT,
  dato_detectado      TEXT,
  estado              TEXT NOT NULL DEFAULT 'abierta', -- abierta | resuelta
  created_at          INTEGER NOT NULL,
  resolved_at         INTEGER,
  resolved_by         TEXT
);

CREATE INDEX IF NOT EXISTS idx_capturas_billing_week ON capturas(billing_week);
CREATE INDEX IF NOT EXISTS idx_capturas_technician ON capturas(technician);
CREATE INDEX IF NOT EXISTS idx_capturas_sha256 ON capturas(sha256);
CREATE INDEX IF NOT EXISTS idx_revisiones_estado ON revisiones(estado);
```

Ninguna columna de estas tablas guarda la imagen en sí — solo `r2_key` apunta al objeto real, que vive en Cloudflare R2 (ver `05_R2_ARCHITECTURE.md`). Así se cumple "no almacenar imágenes en D1 ni en `index.html`".
