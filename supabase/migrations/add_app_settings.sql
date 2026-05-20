-- App-wide key-value settings table
create table if not exists app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz default now()
);

-- Seed pipeline email recipients
insert into app_settings (key, value)
values (
  'pipeline_email_recipients',
  '["stenning@evolutionstrategy.com","ken@evolutionstrategy.com","sean@evolutionstrategy.com","sachet@evolutionstrategy.com"]'::jsonb
)
on conflict (key) do nothing;

-- RLS
alter table app_settings enable row level security;

create policy "authenticated read app_settings"
  on app_settings for select
  using (auth.role() = 'authenticated');

create policy "authenticated update app_settings"
  on app_settings for update
  using (auth.role() = 'authenticated');

create policy "authenticated insert app_settings"
  on app_settings for insert
  with check (auth.role() = 'authenticated');
