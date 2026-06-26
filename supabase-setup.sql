-- ============================================================
-- SUPREME AutoPro LLC — Supabase Database Setup
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- 1. Create invoices table
CREATE TABLE IF NOT EXISTS invoices (
  number      TEXT PRIMARY KEY,
  data        JSONB NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- 2. Auto-update updated_at on changes
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER invoices_updated_at
  BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 3. Enable Row Level Security (only logged-in users can access data)
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

-- 4. Policy: authenticated users can read/write all invoices
CREATE POLICY "auth_users_all" ON invoices
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 5. Index for fast date-based sorting
CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices ((data->>'date') DESC);

-- Done! ✅
