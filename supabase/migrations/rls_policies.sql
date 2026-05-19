-- ============================================================
-- RLS Policies for Evolution Nexus CRM
-- Run once in Supabase → SQL Editor
-- Strategy: authenticated users can read/write all rows.
-- Service-role key (used in API routes) bypasses RLS entirely.
-- ============================================================

-- ── deals ────────────────────────────────────────────────────
ALTER TABLE deals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all" ON deals;
CREATE POLICY "authenticated_all" ON deals
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── contacts ─────────────────────────────────────────────────
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all" ON contacts;
CREATE POLICY "authenticated_all" ON contacts
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── notes ────────────────────────────────────────────────────
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all" ON notes;
CREATE POLICY "authenticated_all" ON notes
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── ndas ─────────────────────────────────────────────────────
ALTER TABLE ndas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all" ON ndas;
CREATE POLICY "authenticated_all" ON ndas
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── contact_deal_links ───────────────────────────────────────
ALTER TABLE contact_deal_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all" ON contact_deal_links;
CREATE POLICY "authenticated_all" ON contact_deal_links
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── deal_cims ────────────────────────────────────────────────
ALTER TABLE deal_cims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all" ON deal_cims;
CREATE POLICY "authenticated_all" ON deal_cims
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── portfolio_companies ──────────────────────────────────────
ALTER TABLE portfolio_companies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all" ON portfolio_companies;
CREATE POLICY "authenticated_all" ON portfolio_companies
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── assistant_threads ────────────────────────────────────────
-- Threads are user-scoped: each user only sees their own.
ALTER TABLE assistant_threads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_only" ON assistant_threads;
CREATE POLICY "owner_only" ON assistant_threads
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ── raise_participants (if exists) ───────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'raise_participants') THEN
    EXECUTE 'ALTER TABLE raise_participants ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "authenticated_all" ON raise_participants';
    EXECUTE $p$CREATE POLICY "authenticated_all" ON raise_participants
      FOR ALL TO authenticated USING (true) WITH CHECK (true)$p$;
  END IF;
END $$;

-- ── interactions (if exists) ─────────────────────────────────
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'interactions') THEN
    EXECUTE 'ALTER TABLE interactions ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "authenticated_all" ON interactions';
    EXECUTE $p$CREATE POLICY "authenticated_all" ON interactions
      FOR ALL TO authenticated USING (true) WITH CHECK (true)$p$;
  END IF;
END $$;

-- ── Pending schema additions ──────────────────────────────────
-- Add parent_portco column to deals (safe to run multiple times)
ALTER TABLE deals ADD COLUMN IF NOT EXISTS parent_portco TEXT;

-- Add user_id column to assistant_threads (safe to run multiple times)
ALTER TABLE assistant_threads ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

-- ── intake_queue ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS intake_queue (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now(),
  source TEXT NOT NULL,          -- 'email' | 'upload'
  doc_type TEXT,                 -- 'teaser' | 'cim'
  file_name TEXT,
  from_email TEXT,
  dropbox_path TEXT,
  extracted JSONB NOT NULL,      -- full Claude extraction object
  status TEXT DEFAULT 'pending', -- 'pending' | 'approved' | 'rejected'
  reviewed_at TIMESTAMPTZ,
  deal_id UUID REFERENCES deals(id)
);

-- Add message_id for Postmark idempotency (unique per inbound email)
ALTER TABLE intake_queue ADD COLUMN IF NOT EXISTS message_id TEXT;
ALTER TABLE intake_queue DROP CONSTRAINT IF EXISTS intake_queue_message_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS intake_queue_message_id_unique
  ON intake_queue (message_id)
  WHERE message_id IS NOT NULL;

ALTER TABLE intake_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "authenticated_all" ON intake_queue;
CREATE POLICY "authenticated_all" ON intake_queue
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
