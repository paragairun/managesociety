-- ============================================================
-- managesociety.in — EV charging
--
-- Run once in the Supabase SQL editor. Guarded; safe to re-run.
-- Runs in a single transaction: no enum value added here is used in
-- this file, so the 55P04 trap that caught manager_role.sql does not
-- apply. Where a status is checked, it is checked as text.
--
-- HOW A SESSION WORKS
--   1. Resident picks a charger and an amount to spend.
--   2. That amount buys an energy budget: amount / rate_per_kwh.
--      The rate is COPIED onto the session, so changing the society's
--      rate later cannot silently rewrite what an old session cost.
--   3. They pay on the society's printed UPI QR and enter the UTR.
--   4. Confirmation arrives either automatically - a service reads the
--      bank's credit alerts and matches that exact UTR - or manually,
--      from a guard or admin. Manual approval is never removed: a
--      co-op bank's alerts can be late, batched or absent, and a
--      parser written against today's template breaks when the bank
--      changes it.
--   5. The OCPP service remote-starts the charger, watches MeterValues,
--      and remote-stops when the budget is reached.
--   6. Actual kWh and cost are recorded. Any unspent balance is left
--      visible on the session rather than silently absorbed - how it
--      is settled (credit, refund, maintenance adjustment) is a policy
--      decision the data model deliberately does not pre-empt.
-- ============================================================


-- ─────────────────────────────────────────────
-- 1. SETTINGS, ONE ROW PER SOCIETY
-- ─────────────────────────────────────────────
create table if not exists public.ev_settings (
  society_id        uuid primary key references public.societies(id) on delete cascade,
  -- The figure asked for. numeric, not float: money and tariffs must
  -- not accumulate binary rounding error.
  rate_per_kwh      numeric(10,2) not null default 10.00,
  -- Smallest and largest a resident may pay into one session, so a
  -- mistyped amount cannot buy 500 kWh.
  min_amount        numeric(10,2) not null default 20.00,
  max_amount        numeric(10,2) not null default 1000.00,
  -- How long an unpaid session waits before it is abandoned and the
  -- charger released for someone else.
  payment_window_mins integer not null default 15,
  -- Automatic confirmation from bank alerts. Off until a real message
  -- format has been seen and the parser validated against it.
  auto_confirm_enabled boolean not null default false,
  -- Charge for occupying a bay after charging finishes. 0 = disabled.
  idle_fee_per_hour numeric(10,2) not null default 0,
  updated_at        timestamptz not null default now(),
  constraint ev_settings_rate_positive check (rate_per_kwh > 0),
  constraint ev_settings_amounts_sane  check (min_amount > 0 and max_amount >= min_amount)
);

comment on column public.ev_settings.rate_per_kwh is
  'Rupees per kWh. Copied onto each session at creation so a later change does not rewrite history.';


-- ─────────────────────────────────────────────
-- 2. THE CHARGERS
--    Added by the admin, so no assumption is made here about how many
--    there are or what they are.
-- ─────────────────────────────────────────────
create table if not exists public.ev_chargers (
  id              uuid primary key default gen_random_uuid(),
  society_id      uuid not null references public.societies(id) on delete cascade,
  name            text not null,
  location        text,
  -- What it is for. Text with a check rather than an enum, so adding a
  -- vehicle type later is a one-line change and never a 55P04.
  vehicle_type    text not null default 'four_wheeler',
  connector_type  text,
  power_kw        numeric(6,2),
  -- OCPP identity. charge_point_id is the string the unit sends in its
  -- BootNotification and in its WebSocket URL; connector_id is which
  -- socket on that unit (1-based; 0 means the station itself).
  ocpp_charge_point_id text,
  ocpp_connector_id    integer not null default 1,
  -- Last reported OCPP status: Available, Preparing, Charging,
  -- SuspendedEV, Finishing, Faulted, Unavailable.
  status          text not null default 'Unknown',
  last_seen_at    timestamptz,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  constraint ev_chargers_vehicle_type_valid
    check (vehicle_type in ('four_wheeler', 'two_wheeler')),
  constraint ev_chargers_connector_positive check (ocpp_connector_id >= 0)
);

-- One charge point reports per connector, and that pair must identify
-- exactly one charger row or an incoming meter reading is ambiguous.
create unique index if not exists ev_chargers_ocpp_identity_uniq
  on public.ev_chargers (ocpp_charge_point_id, ocpp_connector_id)
  where ocpp_charge_point_id is not null;

create index if not exists ev_chargers_society_idx
  on public.ev_chargers (society_id, is_active);


-- ─────────────────────────────────────────────
-- 3. SESSIONS
-- ─────────────────────────────────────────────
create table if not exists public.ev_sessions (
  id              uuid primary key default gen_random_uuid(),
  society_id      uuid not null references public.societies(id) on delete cascade,
  charger_id      uuid not null references public.ev_chargers(id) on delete restrict,
  user_id         uuid references auth.users(id) on delete set null,
  -- Kept as text alongside user_id so a session still says who it was
  -- for after an account is deleted.
  resident_label  text,

  status          text not null default 'awaiting_payment',

  -- Money in, and what it bought at the rate in force AT THE TIME.
  amount_paid     numeric(10,2),
  rate_per_kwh    numeric(10,2) not null,
  energy_budget_kwh numeric(10,3),

  -- The resident's own reference, and how it was confirmed.
  utr             text,
  confirmed_at    timestamptz,
  confirmed_by    uuid references auth.users(id) on delete set null,
  confirm_source  text,

  -- What the charger actually reported. meter values are Wh in OCPP;
  -- stored as given and converted once, at the point of display.
  ocpp_transaction_id integer,
  meter_start_wh  integer,
  meter_stop_wh   integer,
  kwh_consumed    numeric(10,3),
  cost            numeric(10,2),
  stop_reason     text,

  started_at      timestamptz,
  ended_at        timestamptz,
  created_at      timestamptz not null default now(),

  constraint ev_sessions_status_valid check (status in (
    'awaiting_payment',   -- created, resident has not paid yet
    'awaiting_approval',  -- UTR entered, not yet confirmed
    'authorized',         -- confirmed, waiting for the charger to start
    'charging',           -- StartTransaction received
    'completed',          -- StopTransaction received
    'cancelled',          -- abandoned or rejected
    'failed'              -- charger faulted or refused
  )),
  constraint ev_sessions_confirm_source_valid check (
    confirm_source is null or confirm_source in ('bank_email', 'bank_sms', 'manual')
  ),
  constraint ev_sessions_amount_positive check (amount_paid is null or amount_paid > 0)
);

create index if not exists ev_sessions_society_time_idx
  on public.ev_sessions (society_id, created_at desc);
create index if not exists ev_sessions_user_idx
  on public.ev_sessions (user_id, created_at desc);
create index if not exists ev_sessions_open_idx
  on public.ev_sessions (charger_id, status)
  where status in ('authorized', 'charging');

-- A UTR identifies one bank credit. Letting it be reused would let one
-- payment unlock two sessions.
create unique index if not exists ev_sessions_utr_uniq
  on public.ev_sessions (society_id, utr) where utr is not null;

-- A charger can only be mid-session once.
create unique index if not exists ev_sessions_one_open_per_charger
  on public.ev_sessions (charger_id)
  where status in ('authorized', 'charging');


-- ─────────────────────────────────────────────
-- 4. BANK MESSAGES
--
--    EVERY inbound message is stored, parsed or not. A message the
--    parser could not read is the single most useful signal that the
--    bank changed its template, and discarding it is how a silent
--    outage starts - the same mistake that hid the fare-logging
--    failure on metersahi for eight days.
-- ─────────────────────────────────────────────
create table if not exists public.ev_bank_messages (
  id            uuid primary key default gen_random_uuid(),
  society_id    uuid references public.societies(id) on delete cascade,
  source        text not null default 'email',
  -- Message-ID or equivalent, so a re-read mailbox does not double-file.
  external_id   text,
  received_at   timestamptz not null default now(),
  raw_subject   text,
  raw_body      text,
  -- Nulls here mean "could not parse", which is a reportable state.
  parsed_utr    text,
  parsed_amount numeric(10,2),
  parse_error   text,
  matched_session_id uuid references public.ev_sessions(id) on delete set null,
  created_at    timestamptz not null default now()
);

create unique index if not exists ev_bank_messages_external_uniq
  on public.ev_bank_messages (source, external_id) where external_id is not null;
create index if not exists ev_bank_messages_unparsed_idx
  on public.ev_bank_messages (received_at desc) where parsed_utr is null;
create index if not exists ev_bank_messages_utr_idx
  on public.ev_bank_messages (parsed_utr) where parsed_utr is not null;


-- ─────────────────────────────────────────────
-- 5. DEFAULT SETTINGS FOR EVERY EXISTING SOCIETY
--    Rs 10/kWh, as specified.
-- ─────────────────────────────────────────────
insert into public.ev_settings (society_id)
select s.id from public.societies s
 where not exists (select 1 from public.ev_settings e where e.society_id = s.id);


-- ─────────────────────────────────────────────
-- 6. THE BUDGET CALCULATION, IN ONE PLACE
--    Used by the app when creating a session and by the OCPP service
--    when deciding to stop. Two implementations of this would mean two
--    different answers to "how much charge did they buy".
-- ─────────────────────────────────────────────
create or replace function public.ev_energy_budget(
  _amount numeric, _rate numeric
) returns numeric
language sql
immutable
as $$
  -- Rounded down to the watt-hour: never sell more energy than was
  -- paid for.
  select case
    when _amount is null or _rate is null or _rate <= 0 then null
    else floor((_amount / _rate) * 1000) / 1000
  end
$$;

create or replace function public.ev_session_cost(
  _kwh numeric, _rate numeric
) returns numeric
language sql
immutable
as $$
  select case
    when _kwh is null or _rate is null then null
    else round(_kwh * _rate, 2)
  end
$$;


-- ─────────────────────────────────────────────
-- 7. RLS
--    Residents see and create their own sessions. Admins and managers
--    run the module - ev.manage and ev.settings are both manager
--    capabilities in src/lib/permissions.ts, and this mirrors that.
--    The OCPP service uses the service role and bypasses all of it.
-- ─────────────────────────────────────────────
alter table public.ev_settings      enable row level security;
alter table public.ev_chargers      enable row level security;
alter table public.ev_sessions      enable row level security;
alter table public.ev_bank_messages enable row level security;

-- Anyone in the society may see the chargers and the tariff.
drop policy if exists "ev: society reads chargers" on public.ev_chargers;
create policy "ev: society reads chargers" on public.ev_chargers
  for select to authenticated
  using (society_id = public.get_user_society_id(auth.uid()));

drop policy if exists "ev: society reads settings" on public.ev_settings;
create policy "ev: society reads settings" on public.ev_settings
  for select to authenticated
  using (society_id = public.get_user_society_id(auth.uid()));

-- Operators manage chargers and settings.
drop policy if exists "ev: operators manage chargers" on public.ev_chargers;
create policy "ev: operators manage chargers" on public.ev_chargers
  for all to authenticated
  using (public.is_staff_operator(auth.uid())
         and society_id = public.get_user_society_id(auth.uid()))
  with check (public.is_staff_operator(auth.uid())
         and society_id = public.get_user_society_id(auth.uid()));

drop policy if exists "ev: operators manage settings" on public.ev_settings;
create policy "ev: operators manage settings" on public.ev_settings
  for all to authenticated
  using (public.is_staff_operator(auth.uid())
         and society_id = public.get_user_society_id(auth.uid()))
  with check (public.is_staff_operator(auth.uid())
         and society_id = public.get_user_society_id(auth.uid()));

-- A resident sees only their own sessions.
drop policy if exists "ev: residents read own sessions" on public.ev_sessions;
create policy "ev: residents read own sessions" on public.ev_sessions
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "ev: residents create own sessions" on public.ev_sessions;
create policy "ev: residents create own sessions" on public.ev_sessions
  for insert to authenticated
  with check (user_id = auth.uid()
              and society_id = public.get_user_society_id(auth.uid()));

-- A resident may enter their UTR, and nothing else. Columns cannot be
-- restricted in a policy, so the app updates only those fields and a
-- trigger enforces it below.
drop policy if exists "ev: residents update own pending sessions" on public.ev_sessions;
create policy "ev: residents update own pending sessions" on public.ev_sessions
  for update to authenticated
  using (user_id = auth.uid()
         and status in ('awaiting_payment', 'awaiting_approval'))
  with check (user_id = auth.uid());

drop policy if exists "ev: operators manage sessions" on public.ev_sessions;
create policy "ev: operators manage sessions" on public.ev_sessions
  for all to authenticated
  using (public.is_staff_operator(auth.uid())
         and society_id = public.get_user_society_id(auth.uid()))
  with check (public.is_staff_operator(auth.uid())
         and society_id = public.get_user_society_id(auth.uid()));

-- Bank messages are operator-only: they are financial records and can
-- mention other people's payments.
drop policy if exists "ev: operators read bank messages" on public.ev_bank_messages;
create policy "ev: operators read bank messages" on public.ev_bank_messages
  for select to authenticated
  using (public.is_staff_operator(auth.uid())
         and (society_id is null
              or society_id = public.get_user_society_id(auth.uid())));


-- ─────────────────────────────────────────────
-- 8. A RESIDENT MAY SET THE UTR, NOT THE PRICE
--
--    The update policy above cannot restrict columns, so without this
--    a resident could set amount_paid, confirmed_at or kwh_consumed on
--    their own row and charge for free. The trigger pins every field
--    except the UTR back to its stored value.
-- ─────────────────────────────────────────────
create or replace function public.ev_guard_resident_session_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Service role (the OCPP service) and operators are unaffected.
  if auth.uid() is null or public.is_staff_operator(auth.uid()) then
    return new;
  end if;

  if new.user_id is distinct from old.user_id then
    raise exception 'Cannot reassign a charging session'
      using errcode = 'insufficient_privilege';
  end if;

  -- Everything the resident must not touch, restored from the old row.
  new.society_id        := old.society_id;
  new.charger_id        := old.charger_id;
  new.amount_paid       := old.amount_paid;
  new.rate_per_kwh      := old.rate_per_kwh;
  new.energy_budget_kwh := old.energy_budget_kwh;
  new.confirmed_at      := old.confirmed_at;
  new.confirmed_by      := old.confirmed_by;
  new.confirm_source    := old.confirm_source;
  new.ocpp_transaction_id := old.ocpp_transaction_id;
  new.meter_start_wh    := old.meter_start_wh;
  new.meter_stop_wh     := old.meter_stop_wh;
  new.kwh_consumed      := old.kwh_consumed;
  new.cost              := old.cost;
  new.started_at        := old.started_at;
  new.ended_at          := old.ended_at;

  -- They may move awaiting_payment -> awaiting_approval (by supplying a
  -- UTR) or cancel. Nothing else.
  if new.status not in ('awaiting_payment', 'awaiting_approval', 'cancelled') then
    new.status := old.status;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_ev_guard_resident_session_update on public.ev_sessions;
create trigger trg_ev_guard_resident_session_update
  before update on public.ev_sessions
  for each row execute function public.ev_guard_resident_session_update();


-- ─────────────────────────────────────────────
-- 9. A RESIDENT MAY NOT SET THEIR OWN TARIFF EITHER
--
--    The update guard above covers only UPDATE. The insert policy can
--    check WHICH row a resident creates but not WHAT is in it, so
--    without this a resident could insert a session with
--    rate_per_kwh = 0.01 and buy ten thousand units for a hundred
--    rupees. Found by testing the insert path after the update path
--    was already guarded.
--
--    The tariff is taken from ev_settings and the budget recomputed
--    from it, so whatever the client sends for those fields is
--    discarded rather than trusted.
-- ─────────────────────────────────────────────
create or replace function public.ev_guard_resident_session_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg public.ev_settings%rowtype;
begin
  if auth.uid() is null or public.is_staff_operator(auth.uid()) then
    return new;
  end if;

  select * into cfg from public.ev_settings where society_id = new.society_id;
  if not found then
    raise exception 'EV charging is not configured for this society'
      using errcode = 'insufficient_privilege';
  end if;

  if new.amount_paid is null
     or new.amount_paid < cfg.min_amount
     or new.amount_paid > cfg.max_amount then
    raise exception 'Amount must be between % and %', cfg.min_amount, cfg.max_amount
      using errcode = 'check_violation';
  end if;

  -- The tariff is the society's, not the client's.
  new.rate_per_kwh      := cfg.rate_per_kwh;
  new.energy_budget_kwh := public.ev_energy_budget(new.amount_paid, cfg.rate_per_kwh);

  -- A new session starts unpaid and unmetered, whatever was sent.
  new.status            := 'awaiting_payment';
  new.confirmed_at      := null;
  new.confirmed_by      := null;
  new.confirm_source    := null;
  new.ocpp_transaction_id := null;
  new.meter_start_wh    := null;
  new.meter_stop_wh     := null;
  new.kwh_consumed      := null;
  new.cost              := null;
  new.started_at        := null;
  new.ended_at          := null;

  return new;
end;
$$;

drop trigger if exists trg_ev_guard_resident_session_insert on public.ev_sessions;
create trigger trg_ev_guard_resident_session_insert
  before insert on public.ev_sessions
  for each row execute function public.ev_guard_resident_session_insert();

notify pgrst, 'reload schema';


-- ─────────────────────────────────────────────
-- 10. CHARGER AUTHENTICATION
--
--     The OCPP endpoint is on the public internet and, until now,
--     accepted any connection that named a charge point id. Someone
--     who learned a registered id could connect as that charger and
--     send a StopTransaction with a low meter reading, under-billing a
--     session. They could not draw free power - Authorize still needs
--     a confirmed, paid session - but they could corrupt the numbers.
--
--     OCPP 1.6 answers this with HTTP Basic auth on the WebSocket
--     upgrade: username is the charge point id, password is a key the
--     charger stores. Almost every unit has an "Authorization key" or
--     OCPP password field for it.
--
--     require_charger_auth starts FALSE so a new charger can connect
--     once and have its id discovered from the log. Turn it on from
--     the admin screen after commissioning; from then on a charger
--     with no key set is refused.
-- ─────────────────────────────────────────────
alter table public.ev_chargers
  add column if not exists ocpp_auth_key text;

alter table public.ev_settings
  add column if not exists require_charger_auth boolean not null default false;

comment on column public.ev_chargers.ocpp_auth_key is
  'Shared secret for OCPP HTTP Basic auth on the WebSocket upgrade. Null means this charger is unauthenticated.';

-- The key is a credential. Residents and guards can read ev_chargers
-- to see what is available, and must not see it. A view gives them
-- everything except the secret, and the base table is narrowed to
-- operators.
drop policy if exists "ev: society reads chargers" on public.ev_chargers;

-- security_invoker = OFF on purpose. With it on, the view would run
-- with the caller's permissions, hit the operator-only policy on the
-- base table and show a resident nothing - which is the opposite of
-- what this view is for. Running as the owner means the view must do
-- its own scoping, so the society filter is in the WHERE clause here
-- and is not optional.
drop view if exists public.ev_chargers_public;
create view public.ev_chargers_public
with (security_invoker = off) as
  select id, society_id, name, location, vehicle_type, connector_type,
         power_kw, status, last_seen_at, is_active,
         (ocpp_auth_key is not null) as is_secured
    from public.ev_chargers
   where society_id = public.get_user_society_id(auth.uid());

grant select on public.ev_chargers_public to authenticated;

-- Operators keep full access to the base table via the policy already
-- created in section 7; this re-adds society-wide SELECT only through
-- the view, which inherits the caller's permissions.
drop policy if exists "ev: society reads chargers via view" on public.ev_chargers;
create policy "ev: society reads chargers via view" on public.ev_chargers
  for select to authenticated
  using (society_id = public.get_user_society_id(auth.uid())
         and public.is_staff_operator(auth.uid()));

notify pgrst, 'reload schema';
