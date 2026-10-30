-- ============================================================================
-- Per-flat maintenance charges.
--
-- Run this whole file in the Supabase SQL editor. It is idempotent.
--
-- THE GAP THIS FILLS
--
-- charge_calculation_type could express a charge derived from the flat's
-- unit ('per_unit_type', 'per_sqft') or one that is the same for
-- everybody ('fixed'). It could not express a charge whose amount is
-- different for each flat and follows from nothing about the flat:
--
--   two-wheeler parking    flat 101 keeps two scooters, 102 keeps none
--   four-wheeler parking   one car here, three there, none upstairs
--   fines and penalties    levied on one flat for one reason
--   venue booking          whoever booked the hall last month
--
-- No rule derives these. Somebody decides them flat by flat, which is
-- why they need a row per flat rather than a rate on the head.
--
-- RECURRING AND ONE-OFF ARE BOTH PER FLAT
--
-- Parking recurs every month until the resident sells the car. A fine
-- is billed once. Both are "an amount for this flat under this head",
-- so they share a table and are told apart by for_period:
--
--   for_period null       every month, until deleted — parking
--   for_period '2026-11'  that month only — a fine, a hall booking
--
-- Storing only an amount would re-bill a ₹5,000 fine every month
-- forever. A committee would find that out from an angry resident
-- rather than from the software, which is the reason this column
-- exists rather than being left to a later version.
--
-- WHY A TABLE AND NOT JSON ON THE HEAD
--
-- unit_rates is JSON on the head because there are three or four unit
-- types and the committee edits them together. Per-flat amounts are one
-- per flat — two hundred rows on a large society — edited one or a few
-- at a time, often by two committee members at once. A JSON blob
-- rewritten whole on every edit would silently drop whichever change
-- landed second.
-- ============================================================================


-- ── 1. The calculation type ─────────────────────────────────────────────────

do $$
begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'charge_calculation_type' and e.enumlabel = 'per_flat'
  ) then
    alter type public.charge_calculation_type add value 'per_flat';
  end if;
end $$;


-- ── 2. The amounts ──────────────────────────────────────────────────────────

create table if not exists public.maintenance_flat_charges (
  id uuid primary key default gen_random_uuid(),
  society_id uuid not null references public.societies(id) on delete cascade,
  head_id uuid not null references public.maintenance_charge_heads(id) on delete cascade,
  flat_id uuid not null references public.flats(id) on delete cascade,

  -- Whole rupees and paise; never negative. A credit or waiver is not a
  -- negative charge — it belongs against the payment, where it can be
  -- explained, not buried in a bill line that reads as a discount
  -- nobody authorised.
  amount numeric(12, 2) not null check (amount >= 0),

  -- 'YYYY-MM' for a one-off, null for every month. Text rather than a
  -- date because a billing period is a month, and a date would invite
  -- the question of which day.
  for_period text check (for_period is null or for_period ~ '^\d{4}-(0[1-9]|1[0-2])$'),

  -- Why this flat owes this. Shown on the bill for a fine, where "Fine:
  -- ₹2,000" with no reason is what starts the argument.
  note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.maintenance_flat_charges is
  'Amounts for a per_flat charge head, one row per flat. for_period '
  'null means every month (parking); a YYYY-MM means that month only '
  '(a fine, a hall booking). See src/lib/billCalculation.ts.';


-- One recurring amount and one amount per month, per flat per head.
--
-- Two indexes rather than one unique constraint because Postgres counts
-- NULLs as distinct in a unique constraint, so a single
-- unique (head_id, flat_id, for_period) would happily store the same
-- flat's parking charge twice and bill it twice.
create unique index if not exists flat_charges_recurring_uniq
  on public.maintenance_flat_charges (head_id, flat_id)
  where for_period is null;

create unique index if not exists flat_charges_period_uniq
  on public.maintenance_flat_charges (head_id, flat_id, for_period)
  where for_period is not null;

-- The lookup a bill run makes: everything for this society, for this
-- month plus the recurring ones.
create index if not exists flat_charges_society_period_idx
  on public.maintenance_flat_charges (society_id, for_period);

create index if not exists flat_charges_flat_idx
  on public.maintenance_flat_charges (flat_id);

drop trigger if exists flat_charges_touch_updated_at on public.maintenance_flat_charges;
create trigger flat_charges_touch_updated_at
  before update on public.maintenance_flat_charges
  for each row execute function public.update_updated_at_column();


-- ── 3. RLS ──────────────────────────────────────────────────────────────────
--
-- Admins and managers of the society manage these. Residents read only
-- their own flat's, because a per-flat charge names what one household
-- was fined for and is nobody else's business — the kind of thing that
-- a shared bill PDF has leaked at other societies.

alter table public.maintenance_flat_charges enable row level security;

drop policy if exists "flat charges: admins manage own society" on public.maintenance_flat_charges;
create policy "flat charges: admins manage own society"
  on public.maintenance_flat_charges for all to authenticated
  using (society_id in (select p.society_id from public.profiles p
          where p.id = auth.uid()
            and (public.has_role(auth.uid(), 'admin')
              or public.has_role(auth.uid(), 'manager'))))
  with check (society_id in (select p.society_id from public.profiles p
          where p.id = auth.uid()
            and (public.has_role(auth.uid(), 'admin')
              or public.has_role(auth.uid(), 'manager'))));

drop policy if exists "flat charges: residents read own flat" on public.maintenance_flat_charges;
create policy "flat charges: residents read own flat"
  on public.maintenance_flat_charges for select to authenticated
  using (flat_id in (select f.id from public.flats f
          join public.profiles p on p.society_id = f.society_id
          where p.id = auth.uid()
            and f.wing = p.wing
            and f.flat_number = p.flat_number));


-- ── 4. Check it applied ─────────────────────────────────────────────────────

do $$
declare
  missing text := '';
begin
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                 where t.typname = 'charge_calculation_type' and e.enumlabel = 'per_flat')
  then missing := missing || ' charge_calculation_type.per_flat'; end if;

  if not exists (select 1 from information_schema.tables
                 where table_name = 'maintenance_flat_charges')
  then missing := missing || ' maintenance_flat_charges'; end if;

  if not exists (select 1 from pg_indexes
                 where indexname = 'flat_charges_recurring_uniq')
  then missing := missing || ' flat_charges_recurring_uniq'; end if;

  if missing <> '' then
    raise exception 'Did not apply:%', missing;
  end if;

  raise notice 'per_flat_charges.sql applied cleanly.';
end $$;
