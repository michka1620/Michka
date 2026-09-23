-- Run this once against the D1 database bound to the supremekv1 Worker
-- (Cloudflare dashboard -> Workers & Pages -> D1 -> your database -> Console).
CREATE TABLE IF NOT EXISTS edits (
  key TEXT PRIMARY KEY,
  diff TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deleted_keys (
  key TEXT PRIMARY KEY,
  deleted_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS new_invoices (
  key TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sent_states (
  key TEXT PRIMARY KEY,
  state INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
