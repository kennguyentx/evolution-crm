-- Dropbox folder-move job tracking (review items 44, 45, 46, 50;
-- spec: docs/dropbox-folder-moves.md §5).
--
-- One row per folder-move attempt: inserted as 'pending' BEFORE the move is
-- attempted, then marked 'succeeded' (with the actual final path) or
-- 'failed' (with the error text + machine-readable code). The deal page
-- derives its "folder could not be moved" warning banner — with Retry —
-- from the latest failed row for the deal. Failed rows are never deleted:
-- they are the audit trail (and, for source = 'migration', the record of
-- the one-time deal-ID folder migration).
--
-- Apply by hand via the Supabase SQL Editor (there is no migration runner).

create table if not exists public.dropbox_move_jobs (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals (id) on delete cascade,
  from_path text not null,
  to_path text not null,
  final_path text,
  status text not null check (status in ('pending', 'succeeded', 'failed')),
  source text not null check (source in ('stage-change', 'retry', 'reconcile', 'migration')),
  code text,
  error text,
  attempts int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists dropbox_move_jobs_deal_id_idx
  on public.dropbox_move_jobs (deal_id, created_at desc);

-- RLS, following the repo convention (see rls_policies.sql): the browser
-- client inserts/updates job rows during stage changes; API routes use the
-- service-role key and bypass RLS.
alter table public.dropbox_move_jobs enable row level security;

drop policy if exists "authenticated_all" on public.dropbox_move_jobs;
create policy "authenticated_all" on public.dropbox_move_jobs
  for all to authenticated using (true) with check (true);
