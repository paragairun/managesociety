-- ============================================================================
-- Fix: "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification" when applying a per-flat charge.
--
-- Run this whole file in the Supabase SQL editor. It is idempotent, and
-- it changes no data — only how the uniqueness is indexed.
--
-- WHAT WENT WRONG
--
-- per_flat_charges.sql enforced "one recurring amount and one amount per
-- month, per flat per head" with two PARTIAL unique indexes:
--
--   (head_id, flat_id)             where for_period is null
--   (head_id, flat_id, for_period) where for_period is not null
--
-- Two of them, because Postgres counts NULLs as distinct in a plain
-- unique constraint, so a single one would have let the same flat's
-- parking charge be stored — and billed — twice.
--
-- The uniqueness was correct. What was wrong is that a partial index
-- cannot serve as an ON CONFLICT arbiter unless the statement repeats
-- its WHERE predicate, and PostgREST's on_conflict takes column names
-- only. So the upsert could never match either index and failed
-- outright. Plain INSERTs worked, which is how the original
-- verification missed it: it proved the constraints, not the path the
-- app actually takes.
--
-- THE FIX
--
-- One ordinary unique index over a generated column that folds NULL
-- into a value:
--
--   period_key = coalesce(for_period, '')
--
-- '' can never collide with a real period, because for_period is
-- already constrained to YYYY-MM. The index is total rather than
-- partial, so ON CONFLICT (head_id, flat_id, period_key) matches it.
--
-- A generated column rather than Postgres 15's UNIQUE NULLS NOT
-- DISTINCT, which would be one line but would silently need a server
-- version this cannot check from inside a migration that must also run
-- on older ones. Generated columns are Postgres 12 and up.
--
-- for_period itself is untouched: still nullable, still meaning "every
-- month", so nothing in the application changes except the column list
-- the upsert names as its arbiter.
-- ============================================================================


-- ── 1. The folded key ───────────────────────────────────────────────────────

alter table public.maintenance_flat_charges
  add column if not exists period_key text
    generated always as (coalesce(for_period, '')) stored;

comment on column public.maintenance_flat_charges.period_key is
  'for_period with NULL folded to the empty string, so one ordinary '
  'unique index covers both the recurring and the one-off case and can '
  'serve as an ON CONFLICT arbiter. Generated; never written directly.';


-- ── 2. One total unique index in place of the two partial ones ──────────────

-- Created before the old ones are dropped, so the table is never
-- briefly unprotected: a duplicate landing in that window would be a
-- charge billed twice.
create unique index if not exists flat_charges_uniq
  on public.maintenance_flat_charges (head_id, flat_id, period_key);

drop index if exists public.flat_charges_recurring_uniq;
drop index if exists public.flat_charges_period_uniq;


-- ── 3. Check it applied, and that it still refuses duplicates ───────────────

do $$
begin
  if not exists (select 1 from pg_indexes where indexname = 'flat_charges_uniq')
  then raise exception 'flat_charges_uniq was not created'; end if;

  if exists (select 1 from pg_indexes
             where indexname in ('flat_charges_recurring_uniq', 'flat_charges_period_uniq'))
  then raise exception 'the old partial indexes are still present'; end if;

  if not exists (select 1 from information_schema.columns
                 where table_name = 'maintenance_flat_charges' and column_name = 'period_key')
  then raise exception 'period_key was not added'; end if;

  raise notice 'per_flat_charges_upsert_fix.sql applied cleanly.';
end $$;
