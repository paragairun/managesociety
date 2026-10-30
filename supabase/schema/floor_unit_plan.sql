-- ============================================================================
-- The floor plan: which unit type sits at each position on a floor.
--
-- Run this whole file in the Supabase SQL editor. It is idempotent.
--
-- WHY
--
-- A building's floor plate repeats. The flat at the end of the corridor
-- is a 3BHK of 1100 sq ft on the second floor and on the eleventh,
-- because the builder poured the same slab eleven times. So a committee
-- can describe one floor — 101 is a 2BHK, 102 a 3BHK, 103 a 3BHK, 104 a
-- 2BHK — and every floor above it follows.
--
-- This was the last join missing from the structure. A society had
-- towers, wings and flat numbers on one side, and a catalogue of unit
-- types and sizes on the other, with nothing connecting them: somebody
-- had to open two hundred flats and set each one by hand. Nobody does
-- that, so the flats stayed unstamped and every per-unit and per-sqft
-- charge quietly skipped them — the bills came out short and the
-- shortfall was invisible.
--
-- SHAPE
--
--   { "A": ["2BHK|950", "3BHK|1100", "3BHK|1100", "2BHK|950"],
--     "B": ["3BHK|1150", null, "2BHK|980"] }
--
-- Wing name → one entry per position on a floor, left to right, each a
-- "<type>|<sqft>" key from the society's catalogue or null where the
-- committee has not said. See src/lib/floorPlan.ts.
--
-- WHY A COLUMN BESIDE unit_types, NOT INSIDE structure
--
-- society_structure.structure is locked after approval and only the
-- platform team may change it. The floor plan is a billing concern the
-- committee owns, exactly like unit_types, and putting it inside the
-- structure would mean a support ticket every time a society corrected
-- a floor. Keyed by wing name so it survives any change to the
-- structure that keeps the wing.
-- ============================================================================


-- ── 1. The column ───────────────────────────────────────────────────────────

alter table public.society_structure
  add column if not exists unit_plan jsonb not null default '{}'::jsonb;

comment on column public.society_structure.unit_plan is
  'Wing name -> array of "<unit type>|<sqft>" keys, one per position on '
  'a floor, null where unset. The floor plate repeats, so this stamps '
  'every floor. Editable by the society admin, unlike structure. See '
  'src/lib/floorPlan.ts.';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'society_structure_unit_plan_is_object'
  ) then
    alter table public.society_structure
      add constraint society_structure_unit_plan_is_object
      check (jsonb_typeof(unit_plan) = 'object');
  end if;
end $$;


-- ── 2. Shape guard ──────────────────────────────────────────────────────────
--
-- A trigger rather than a CHECK, for the same reason as unit_types:
-- inspecting each entry needs jsonb_each, which is a subquery, and a
-- CHECK constraint cannot contain one. It asserts object-ness itself
-- because a BEFORE trigger runs ahead of the table's CHECK and would
-- otherwise fail with Postgres's own message rather than this one.
--
-- Deliberately NOT validating the keys against the catalogue. That
-- check needs unit_types from the same row and the structure's wing
-- list, and a database error is the wrong place to tell a committee
-- that flat 101 names a size they have not defined —
-- normalizeUnitPlan says it in their own words, naming the flat. This
-- is the backstop for a row arriving some other way.

create or replace function public.check_unit_plan_shape()
returns trigger
language plpgsql
as $$
declare
  bad_wing text;
begin
  if jsonb_typeof(new.unit_plan) <> 'object' then
    raise exception 'unit_plan must be a JSON object keyed by wing, not %',
      jsonb_typeof(new.unit_plan)
      using hint = 'An empty plan is {}, not [] or null.';
  end if;

  select key into bad_wing
  from jsonb_each(new.unit_plan) as e(key, value)
  where jsonb_typeof(value) <> 'array'
     or exists (
       select 1 from jsonb_array_elements(value) as p
       where jsonb_typeof(p) not in ('string', 'null')
     )
  limit 1;

  if bad_wing is not null then
    raise exception
      'Wing "%" must hold an array of unit keys or nulls.', bad_wing
      using hint = 'See normalizeUnitPlan in src/lib/floorPlan.ts.';
  end if;

  return new;
end $$;

drop trigger if exists check_unit_plan_shape on public.society_structure;
create trigger check_unit_plan_shape
  before insert or update of unit_plan on public.society_structure
  for each row execute function public.check_unit_plan_shape();


-- ── 3. Check it applied ─────────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_name = 'society_structure' and column_name = 'unit_plan')
  then raise exception 'unit_plan was not added to society_structure'; end if;

  if not exists (select 1 from pg_proc where proname = 'check_unit_plan_shape')
  then raise exception 'check_unit_plan_shape was not created'; end if;

  raise notice 'floor_unit_plan.sql applied cleanly.';
end $$;
