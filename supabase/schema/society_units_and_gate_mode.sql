-- ============================================================================
-- Unit types and sizes, optional address fields, and the gate entry mode.
--
-- Run this whole file in the Supabase SQL editor. It is idempotent: every
-- statement guards itself, so running it twice changes nothing the second
-- time.
--
-- WHAT THIS ADDS, AND WHY
--
-- 1. A UNIT CATALOGUE per society.
--    A society does not have flats of arbitrary square footage. It has a
--    handful of unit types — 1BHK, 2BHK, 3BHK — each existing in a few
--    specific sizes, because the building was built that way: the 3BHKs
--    are 1000, 1050 and 1100 sq ft and nothing in between.
--
--    Recording that is what makes maintenance billing tractable. Most
--    charge heads apply by unit type or by area, so once each flat is
--    stamped with its type and size a bill becomes arithmetic. It also
--    stops somebody typing 1O50 and creating a size nothing bills
--    against.
--
--    Stored as JSON on society_structure rather than as its own table:
--    it is a small list, always read whole, always written whole, and it
--    lives beside the towers and wings it describes.
--
-- 2. A PER-UNIT-TYPE charge calculation.
--    charge_calculation_type already had 'fixed' (same for every flat)
--    and 'per_sqft' (rate times area). Neither expresses "₹1,200 for a
--    2BHK and ₹1,800 for a 3BHK", which is how most societies actually
--    bill. 'per_unit_type' adds it, with the rates in a JSON map.
--
-- 3. THE GATE ENTRY MODE.
--    A society using RFID boom barriers — Park+ and the like — never
--    scans a QR sticker, and the Scan button is then dead weight on a
--    guard's home screen. One setting, read by both the website and the
--    native guard app.
-- ============================================================================


-- ── 1. The unit catalogue ───────────────────────────────────────────────────

alter table public.society_structure
  add column if not exists unit_types jsonb not null default '[]'::jsonb;

comment on column public.society_structure.unit_types is
  'Array of { name, sizes: [{ sqft, label? }] }. The unit types this '
  'society has and the sizes each comes in. Written whole by the admin '
  'structure builder; see src/lib/societyUnits.ts for the shape and its '
  'validation.';

-- Shape guard, in two parts.
--
-- A CHECK constraint can only assert that the column is an array:
-- Postgres forbids subqueries inside one, and inspecting each entry
-- needs jsonb_array_elements, which is a subquery. So the per-entry
-- rules live in a trigger instead.
--
-- Worth the machinery because billing reads this. An entry with no name
-- or no sizes does not fail here — it produces flats that match no
-- charge head, and nobody notices until the bills are short.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'society_structure_unit_types_is_array'
  ) then
    alter table public.society_structure
      add constraint society_structure_unit_types_is_array
      check (jsonb_typeof(unit_types) = 'array');
  end if;
end $$;

create or replace function public.check_unit_types_shape()
returns trigger
language plpgsql
as $$
declare
  bad_entry jsonb;
begin
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

drop trigger if exists check_unit_types_shape on public.society_structure;
create trigger check_unit_types_shape
  before insert or update of unit_types on public.society_structure
  for each row execute function public.check_unit_types_shape();


-- ── 2. Flats carry their unit ───────────────────────────────────────────────
--
-- flats already had flat_type (free text) and area_sqft. What was missing
-- is that the pair must come FROM the catalogue — otherwise a flat can
-- hold a size the society does not have, fall out of every per-size
-- charge, and nobody notices until the bills are short.
--
-- Enforced in the app (isKnownUnit) rather than by a database constraint,
-- because the catalogue lives in another table's JSON and a cross-table
-- JSON check would need a trigger on both. The index below is what makes
-- billing by unit fast enough to be worth doing this way.

create index if not exists flats_society_unit_idx
  on public.flats (society_id, flat_type, area_sqft)
  where is_active;

comment on column public.flats.flat_type is
  'The unit type name from society_structure.unit_types, e.g. "3BHK". '
  'Null for a flat registered before the society defined its catalogue.';


-- ── 3. Per-unit-type charges ────────────────────────────────────────────────

do $$
begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'charge_calculation_type' and e.enumlabel = 'per_unit_type'
  ) then
    alter type public.charge_calculation_type add value 'per_unit_type';
  end if;
end $$;

-- The rates, one per unit type: { "1BHK": 900, "2BHK": 1200, "3BHK": 1800 }.
-- Null for the two older calculation types, which do not need it.
alter table public.maintenance_charge_heads
  add column if not exists unit_rates jsonb;

comment on column public.maintenance_charge_heads.unit_rates is
  'For calculation_type = per_unit_type: { "<unit type name>": rate }. '
  'A unit type absent from this map is not charged for this head, which '
  'is deliberate — a lift charge may genuinely not apply to ground-floor '
  'shops.';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'charge_heads_unit_rates_shape'
  ) then
    alter table public.maintenance_charge_heads
      add constraint charge_heads_unit_rates_shape check (
        unit_rates is null or jsonb_typeof(unit_rates) = 'object'
      );
  end if;
end $$;


-- ── 4. The gate entry mode ──────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_type where typname = 'gate_entry_mode') then
    create type public.gate_entry_mode as enum ('qr_sticker', 'rfid');
  end if;
end $$;

alter table public.societies
  add column if not exists gate_entry_mode public.gate_entry_mode
    not null default 'qr_sticker';

comment on column public.societies.gate_entry_mode is
  'qr_sticker: guards scan our QR stickers and passes. '
  'rfid: the society uses RFID boom barriers (Park+ and similar), so the '
  'guard app hides the Scan button — scanning is not how anyone gets in '
  'there, and a dead button at a gate is worse than a missing one. '
  'Guest passes and delivery registration work the same either way.';


-- ── 5. Check it applied ─────────────────────────────────────────────────────

do $$
declare
  missing text := '';
begin
  if not exists (select 1 from information_schema.columns
                 where table_name = 'society_structure' and column_name = 'unit_types')
  then missing := missing || ' society_structure.unit_types'; end if;

  if not exists (select 1 from information_schema.columns
                 where table_name = 'maintenance_charge_heads' and column_name = 'unit_rates')
  then missing := missing || ' maintenance_charge_heads.unit_rates'; end if;

  if not exists (select 1 from information_schema.columns
                 where table_name = 'societies' and column_name = 'gate_entry_mode')
  then missing := missing || ' societies.gate_entry_mode'; end if;

  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                 where t.typname = 'charge_calculation_type' and e.enumlabel = 'per_unit_type')
  then missing := missing || ' charge_calculation_type.per_unit_type'; end if;

  if missing <> '' then
    raise exception 'Did not apply:%', missing;
  end if;

  raise notice 'society_units_and_gate_mode.sql applied cleanly.';
end $$;
