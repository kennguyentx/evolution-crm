-- Seed notification recipient lists into app_settings.
-- These replace hardcoded email arrays in route files.
-- Edit recipients via the app_settings table without a code deploy.

insert into app_settings (key, value) values
  ('deal_notify_recipients',    '["ken@evolutionstrategy.com","sean@evolutionstrategy.com"]'),
  ('portfolio_news_recipients', '["ken@evolutionstrategy.com","sean@evolutionstrategy.com"]')
on conflict (key) do nothing;
