-- Dedupe calendar_events.
-- Keeps the OLDEST row (lowest created_at) for each unique (title, event_date, event_type) tuple
-- and deletes the rest. Run this manually in the Supabase SQL editor.

with ranked as (
  select
    id,
    row_number() over (
      partition by title, event_date, coalesce(event_type, '')
      order by created_at asc, id asc
    ) as rn
  from calendar_events
)
delete from calendar_events
where id in (select id from ranked where rn > 1);

-- Optional: see how many remain
-- select count(*) from calendar_events;
