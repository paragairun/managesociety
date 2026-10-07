-- ============================================================
-- managesociety.in — eSSL / ZKTeco push terminals (K90 Pro etc.)
-- Run in the Supabase SQL editor after staff_profiles_biometrics.sql.
-- Guarded throughout; safe to re-run.
--
-- These terminals match fingerprints ON THE DEVICE and push the result.
-- We therefore store NO biometric templates for them — only a mapping
-- from the device's user id ("PIN") to a staff member or house help.
-- That is a meaningful privacy improvement over PC-scanner enrolment:
-- the sensitive data never leaves the terminal.
-- ============================================================

-- ─────────────────────────────────────────────
-- 1. REGISTERED TERMINALS
--    A device authenticates only by its serial number in a query string,
--    which is weak, so an unregistered SN is refused outright and every
--    device starts inactive until an admin approves it.
-- ─────────────────────────────────────────────
create table if not exists public.biometric_devices (
  id              uuid primary key default gen_random_uuid(),
  society_id      uuid not null references public.societies(id) on delete cascade,
  serial_number   text not null unique,
  name            text,
  model           text,
  -- Device clock is local time with no offset; needed to convert punches.
  timezone_hours  numeric(4,2) not null default 5.5,
  is_active       boolean not null default false,
  last_seen_at    timestamptz,
  last_punch_at   timestamptz,
  firmware        text,
  created_at      timestamptz not null default now()
);

create index if not exists biometric_devices_society_idx
  on public.biometric_devices (society_id);

-- ─────────────────────────────────────────────
-- 2. DEVICE USER -> PERSON
--    The terminal knows people only as numeric PINs entered during
--    on-device enrolment. One PIN maps to one staff member or house help.
-- ─────────────────────────────────────────────
create table if not exists public.device_user_map (
  id                uuid primary key default gen_random_uuid(),
  society_id        uuid not null references public.societies(id) on delete cascade,
  device_id         uuid references public.biometric_devices(id) on delete cascade,
  -- Null device_id means "this PIN on any terminal in the society",
  -- which is what you want when the same person is enrolled on several.
  device_pin        text not null,
  subject_category  public.staff_category not null,
  subject_id        uuid not null,
  created_at        timestamptz not null default now(),
  unique (society_id, device_id, device_pin)
);

create index if not exists device_user_map_lookup_idx
  on public.device_user_map (society_id, device_pin);

-- ─────────────────────────────────────────────
-- 3. RAW PUNCHES
--    Every record the device sends is stored verbatim before it is
--    interpreted. Terminals re-send a whole batch whenever they do not
--    get a clean "OK", so punch_key makes ingestion idempotent: a repeat
--    hits the unique index and is ignored rather than double-logging.
--    It also means an unmapped PIN is not lost - it can be mapped later
--    and the history is still there.
-- ─────────────────────────────────────────────
create table if not exists public.device_punches (
  id            uuid primary key default gen_random_uuid(),
  society_id    uuid not null references public.societies(id) on delete cascade,
  device_id     uuid not null references public.biometric_devices(id) on delete cascade,
  punch_key     text not null unique,
  device_pin    text not null,
  punched_at    timestamptz not null,
  status_code   smallint not null default 0,
  verify_mode   smallint,
  direction     text,
  raw_line      text,
  -- Null until a mapping exists for the PIN.
  staff_log_id  uuid references public.staff_logs(id) on delete set null,
  processed     boolean not null default false,
  created_at    timestamptz not null default now()
);

create index if not exists device_punches_society_time_idx
  on public.device_punches (society_id, punched_at desc);
create index if not exists device_punches_unprocessed_idx
  on public.device_punches (society_id, processed) where processed = false;

-- ─────────────────────────────────────────────
-- 4. ENTRY METHOD
--    Distinguish a terminal punch from the PC-scanner path so reports can
--    tell them apart.
-- ─────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'entry_method' and e.enumlabel = 'biometric_terminal'
  ) then
    alter type public.entry_method add value 'biometric_terminal';
  end if;
end $$;

alter table public.staff_logs
  add column if not exists device_pin text,
  add column if not exists device_serial text;

-- ─────────────────────────────────────────────
-- 5. RLS
--    The push endpoint runs with the service role and bypasses RLS.
--    These policies are for the admin and guard UIs only.
-- ─────────────────────────────────────────────
alter table public.biometric_devices enable row level security;
alter table public.device_user_map   enable row level security;
alter table public.device_punches    enable row level security;

drop policy if exists "devices: admins manage own society" on public.biometric_devices;
create policy "devices: admins manage own society"
  on public.biometric_devices for all to authenticated
  using (society_id in (select p.society_id from public.profiles p
          where p.id = auth.uid() and public.has_role(auth.uid(), 'admin')))
  with check (society_id in (select p.society_id from public.profiles p
          where p.id = auth.uid() and public.has_role(auth.uid(), 'admin')));

drop policy if exists "devices: guards read own society" on public.biometric_devices;
create policy "devices: guards read own society"
  on public.biometric_devices for select to authenticated
  using (society_id in (select p.society_id from public.profiles p
          where p.id = auth.uid() and public.has_role(auth.uid(), 'guard')));

drop policy if exists "device map: admins manage own society" on public.device_user_map;
create policy "device map: admins manage own society"
  on public.device_user_map for all to authenticated
  using (society_id in (select p.society_id from public.profiles p
          where p.id = auth.uid() and public.has_role(auth.uid(), 'admin')))
  with check (society_id in (select p.society_id from public.profiles p
          where p.id = auth.uid() and public.has_role(auth.uid(), 'admin')));

drop policy if exists "punches: society staff read" on public.device_punches;
create policy "punches: society staff read"
  on public.device_punches for select to authenticated
  using (society_id in (select p.society_id from public.profiles p
          where p.id = auth.uid()
            and (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'guard'))));

-- ─────────────────────────────────────────────
-- 6. UNMAPPED PINS
--    What an admin needs after on-device enrolment: which PINs have been
--    punching that nobody has linked to a person yet.
-- ─────────────────────────────────────────────
create or replace view public.unmapped_device_pins
with (security_invoker = on)
as
select p.society_id,
       p.device_id,
       p.device_pin,
       count(*)            as punch_count,
       min(p.punched_at)   as first_seen,
       max(p.punched_at)   as last_seen
  from public.device_punches p
  left join public.device_user_map m
         on m.society_id = p.society_id
        and m.device_pin = p.device_pin
        and (m.device_id is null or m.device_id = p.device_id)
 where m.id is null
 group by p.society_id, p.device_id, p.device_pin;

grant select on public.unmapped_device_pins to authenticated;
