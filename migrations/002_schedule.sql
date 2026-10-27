-- Adds weekday schedules. Run once in Supabase: SQL Editor → New query → paste → Run.
-- days is a Mon..Sun mask: '1111111' = every day, '1111100' = weekdays only.
alter table public.habits
  add column if not exists days text not null default '1111111'
  check (days ~ '^[01]{7}$' and days <> '0000000');
