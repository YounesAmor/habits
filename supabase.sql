-- Run this once in Supabase: Dashboard → SQL Editor → New query → paste → Run.

create table public.habits (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  name       text not null,
  emoji      text not null default '✅',
  color      text not null default '#34c77b',
  days       text not null default '1111111' check (days ~ '^[01]{7}$' and days <> '0000000'), -- Mon..Sun
  archived   boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.checkins (
  habit_id uuid not null references public.habits on delete cascade,
  user_id  uuid not null default auth.uid() references auth.users on delete cascade,
  day      date not null,
  primary key (habit_id, day)
);

-- Only the signed-in owner can see or change their rows.
alter table public.habits   enable row level security;
alter table public.checkins enable row level security;

create policy "own habits" on public.habits
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own checkins" on public.checkins
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.habits, public.checkins to authenticated;
