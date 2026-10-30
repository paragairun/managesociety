-- ============================================================================
-- Unit types on a society registration request.
--
-- Run this whole file in the Supabase SQL editor. Idempotent.
--
-- WHY
--
-- The unit catalogue — which kinds of flat a society has, and the sizes
-- each comes in — was only editable after approval, from the admin
-- panel. But it is the same KIND of fact as the towers and wings: the
-- committee knows it at the moment they register, nobody else can
-- supply it afterwards, and billing is blocked until it exists. Asking
-- at registration means a society can bill from day one instead of
-- being held up by a setup step nobody mentioned.
--
-- The column mirrors society_structure.unit_types exactly, shape guard
-- included, so approve-society copies one into the other without
-- transforming anything.
--
-- ALSO FIXES an error message in the existing society_structure guard.
-- A BEFORE trigger runs ahead of a table's CHECK constraints, so a
-- non-array value reached jsonb_array_elements first and failed with
-- Postgres's own "cannot extract elements from an object" rather than
-- the constraint's explanation. The value was always rejected — the
-- data was never at risk — but the admin saw a message that named
-- neither the column nor what was wrong with it. Both trigger
-- functions below now check array-ness themselves.
-- ============================================================================


-- ── 1. The column ───────────────────────────────────────────────────────────

alter table public.society_registration_requests
  add column if not exists unit_types jsonb not null default '[]'::jsonb;

comment on column public.society_registration_requests.unit_types is
  'Array of { name, sizes: [{ sqft, label? }] }, as submitted at '
  'registration. Copied verbatim into society_structure.unit_types when '
  'the request is approved. See src/lib/societyUnits.ts for the shape.';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'registration_unit_types_is_array'
  ) then
    alter table public.society_registration_requests
      add constraint registration_unit_types_is_array
      check (jsonb_typeof(unit_types) = 'array');
  end if;
end $$;


-- ── 2. Per-entry rules, as triggers ─────────────────────────────────────────
--
-- A CHECK constraint cannot hold the subquery that inspecting each entry
-- needs (jsonb_array_elements), so these are triggers. Each one asserts
-- array-ness itself rather than leaning on the CHECK, because it runs
-- first and would otherwise fail with an unreadable message.

create or replace function public.check_registration_unit_types()
returns trigger
language plpgsql
as $$
declare
  bad_entry jsonb;
begin
  if jsonb_typeof(new.unit_types) <> 'array' then
    raise exception 'unit_types must be a JSON array, not %',
      jsonb_typeof(new.unit_types)
      using hint = 'An empty catalogue is [], not {} or null.';
  end if;

  select e into bad_entry
  from jsonb_array_elements(new.unit_types) as e
  where jsonb_typeof(e) <> 'object'
     or coalesce(e ->> 'name', '') = ''
     or jsonb_typeof(e -> 'sizes') <> 'array'
     or jsonb_array_length(e -> 'sizes') = 0
  limit 1;

  if bad_entry is not null then
    raise exception
      'Every unit type needs a name and at least one size. Offending entry: %',
      bad_entry
      using hint = 'See normalizeUnitTypes in src/lib/societyUnits.ts.';
  end if;

  return new;
end $$;

drop trigger if exists check_registration_unit_types on public.society_registration_requests;
create trigger check_registration_unit_types
  before insert or update of unit_types on public.society_registration_requests
  for each row execute function public.check_registration_unit_types();

-- The same correction for the society_structure guard added by
-- society_units_and_gate_mode.sql. Replacing the function is enough;
-- the trigger already points at it.
create or replace function public.check_unit_types_shape()
returns trigger
language plpgsql
as $$
declare
  bad_entry jsonb;
begin
  if jsonb_typeof(new.unit_types) <> 'array' then
    raise exception 'unit_types must be a JSON array, not %',
      jsonb_typeof(new.unit_types)
      using hint = 'An empty catalogue is [], not {} or null.';
  end if;

  select e into bad_entry
  from jsonb_array_elements(new.unit_types) as e
  where jsonb_typeof(e) <> 'object'
     or coalesce(e ->> 'name', '') = ''
     or jsonb_typeof(e -> 'sizes') <> 'array'
     or jsonb_array_length(e -> 'sizes') = 0
  limit 1;

  if bad_entry is not null then
    raise exception
      'Every unit type needs a name and at least one size. Offending entry: %',
      bad_entry
      using hint = 'See normalizeUnitTypes in src/lib/societyUnits.ts.';
  end if;

  return new;
end $$;


-- ── 3. Check it applied ─────────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_name = 'society_registration_requests'
                   and column_name = 'unit_types')
  then raise exception 'unit_types was not added to society_registration_requests'; end if;

  if not exists (select 1 from pg_proc where proname = 'check_registration_unit_types')
  then raise exception 'check_registration_unit_types was not created'; end if;

  raise notice 'registration_unit_types.sql applied cleanly.';
end $$;
