-- Intake activity events, feeding the daily intake digest email.
-- One row per intake outcome (logged / queued / ambiguous / failed / skipped).
-- The digest cron (app/api/intake/daily-digest) sends unsent rows, then stamps
-- digest_sent_at. If the digest is never sent, rows accumulate — nothing is
-- lost, and the next digest picks them up grouped by event_date.

create table if not exists intake_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- America/Chicago calendar date of the intake activity (matches note_date).
  event_date date not null default ((now() at time zone 'America/Chicago')::date),
  kind text not null,
  summary text not null,
  -- Free-form detail: company, stage, deal_type, parent_portco, contact names,
  -- queue candidates, failure reason, file name, etc.
  detail jsonb not null default '{}'::jsonb,
  deal_id uuid references deals(id) on delete set null,
  contact_id uuid references contacts(id) on delete set null,
  queue_id uuid references intake_queue(id) on delete set null,
  message_id text,
  digest_sent_at timestamptz
);

create index if not exists intake_events_digest_sent_at_idx on intake_events (digest_sent_at);
create index if not exists intake_events_event_date_idx on intake_events (event_date);

alter table intake_events enable row level security;

drop policy if exists "authenticated_all" on intake_events;
create policy "authenticated_all" on intake_events for all to authenticated using (true) with check (true);
