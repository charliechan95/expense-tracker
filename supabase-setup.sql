-- Expense Tracker — Supabase backend schema
-- Run ONCE: Supabase dashboard → SQL Editor → New query → paste → Run.
-- Creates tables + Row Level Security so each signed-in user only ever
-- sees their own rows. Safe to re-run (if not exists guards).

-- 1) Expenses ------------------------------------------------------------
create table if not exists expenses (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  amount      numeric(12, 2) not null,
  currency    text not null default 'CNY',
  category    text not null default 'Other',
  merchant    text,
  description text,
  platform    text,
  expense_date date,
  external_id text,
  source      text,
  cat_source  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
-- One import row per user: re-importing the same bill won't duplicate.
create unique index if not exists expenses_user_external
  on expenses (user_id, external_id);

-- 2) Merchant memory (learned merchant -> category) -----------------------
create table if not exists merchant_memory (
  user_id    uuid not null references auth.users(id) on delete cascade,
  merchant   text not null,
  category   text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, merchant)
);

-- 3) User rules (pattern -> category) ------------------------------------
create table if not exists user_rules (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  pattern    text not null,
  category   text not null,
  created_at timestamptz not null default now()
);

-- 4) Budgets (per category, per month "YYYY-MM") --------------------------
create table if not exists budgets (
  user_id    uuid not null references auth.users(id) on delete cascade,
  category   text not null,
  month      text not null,
  amount     numeric(12, 2) not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, category, month)
);

-- 5) App settings (one row per user) -------------------------------------
create table if not exists app_settings (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  display_currency text not null default 'CNY',
  cny_hkd_rate     numeric(10, 4),
  updated_at       timestamptz not null default now()
);

-- 6) Row Level Security: users only touch their own rows ------------------
alter table expenses        enable row level security;
alter table merchant_memory enable row level security;
alter table user_rules      enable row level security;
alter table budgets         enable row level security;
alter table app_settings    enable row level security;

drop policy if exists "own rows" on expenses;
create policy "own rows" on expenses
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own rows" on merchant_memory;
create policy "own rows" on merchant_memory
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own rows" on user_rules;
create policy "own rows" on user_rules
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own rows" on budgets;
create policy "own rows" on budgets
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own rows" on app_settings;
create policy "own rows" on app_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
