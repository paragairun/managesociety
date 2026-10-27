-- ============================================================
-- managesociety.in — device_push_tokens, defined in the repo at last
--
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- WHY THIS FILE EXISTS
-- Three places already read or write this table — the push hook, the
-- send-push-notification function and delete-own-account — and nothing
-- in the repository creates it. Either it was made in the dashboard
-- and its shape is unrecorded, or it does not exist at all and every
-- one of those calls has been failing quietly. Both are the same
-- problem: nobody can tell by reading the code.
--
-- Written to be safe in either case. It creates the table when it is
-- missing, and when it already exists it only widens what needs
-- widening. It drops no data.
--
-- THE iOS PART
-- The hook hardcoded platform = 'android'. A second platform is about
-- to start writing rows, so if an existing CHECK constraint allows
-- only 'android', every iOS registration would fail with a constraint
-- violation that surfaces nowhere — the hook logs to console and the
-- app carries on. Section 3 makes sure 'ios' is accepted.
-- ============================================================


-- ─────────────────────────────────────────────
-- 1. The table, if it is not already there
--
--    One row per device, not per user: a resident with a phone and a
--    tablet should receive both. The unique key is therefore
--    (user_id, token), which is also what the hook's upsert declares
--    as its conflict target — without it that upsert errors.
-- ─────────────────────────────────────────────
create table if not exists public.device_push_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  token      text not null,
  platform   text not null default 'android',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Named explicitly rather than relying on an inline UNIQUE, so the
-- upsert's ON CONFLICT target is stable no matter how the table was
-- originally made.
create unique index if not exists device_push_tokens_user_token_key
  on public.device_push_tokens (user_id, token);


-- ─────────────────────────────────────────────
-- 2. Columns a pre-existing copy might lack
--
--    If the table was created in the dashboard with fewer columns,
--    these add them. If it already has them, nothing happens.
-- ─────────────────────────────────────────────
alter table public.device_push_tokens add column if not exists platform   text not null default 'android';
alter table public.device_push_tokens add column if not exists created_at timestamptz not null default now();
alter table public.device_push_tokens add column if not exists updated_at timestamptz not null default now();


-- ─────────────────────────────────────────────
-- 3. Accept iOS
--
--    Drops whatever platform CHECK is there and puts back one that
--    allows all three. 'web' is included because a browser push
--    subscription is the obvious next step and a constraint is a poor
--    place to discover that.
--
--    NOT VALID so an existing row holding something unexpected cannot
--    stop this applying; new and updated rows are still checked.
-- ─────────────────────────────────────────────
alter table public.device_push_tokens
  drop constraint if exists device_push_tokens_platform_check;

alter table public.device_push_tokens
  add constraint device_push_tokens_platform_check
  check (platform in ('android', 'ios', 'web'))
  not valid;


-- ─────────────────────────────────────────────
-- 4. RLS
--
--    A device token is not secret, but it is a per-person identifier
--    and the table should not be readable across a society, let alone
--    across the platform. Each person manages their own rows only.
--
--    send-push-notification reads this with the service role, which
--    bypasses RLS, so tightening it here does not affect sending.
-- ─────────────────────────────────────────────
alter table public.device_push_tokens enable row level security;

grant select, insert, update, delete on public.device_push_tokens to authenticated;
revoke all on public.device_push_tokens from anon;

drop policy if exists "Own device tokens" on public.device_push_tokens;
create policy "Own device tokens" on public.device_push_tokens
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());


-- ─────────────────────────────────────────────
-- 5. What it looks like now
-- ─────────────────────────────────────────────
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public' and table_name = 'device_push_tokens'
 order by ordinal_position;

notify pgrst, 'reload schema';
