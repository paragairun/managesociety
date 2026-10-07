-- ============================================================
-- managesociety.in — device PIN directly on the person's record
-- Run after biometric_terminals.sql. Guarded; safe to re-run.
--
-- WHY THIS REPLACES device_user_map AS THE SOURCE OF TRUTH
-- A separate mapping table meant adding a row by hand for every person,
-- and the spreadsheet import could not carry the PIN. Holding it on the
-- staff record means one place to look, and bulk upload fills it in with
-- everything else.
--
-- TRADE-OFF, stated plainly: one PIN per person per society. If you ever
-- run two terminals and enrol the same person under DIFFERENT user ids on
-- each, this cannot express that - enrol them with the same id on both.
-- device_user_map is left in place for that case and is still read as an
-- override, but it is no longer required for normal use.
-- ============================================================

alter table public.staff_members
  add column if not exists device_pin text;

alter table public.house_helps
  add column if not exists device_pin text;

-- A PIN identifies exactly one person within a society, otherwise a punch
-- is ambiguous. Partial index so the many NULLs (PIN optional) don't clash.
create unique index if not exists staff_members_society_pin_uniq
  on public.staff_members (society_id, device_pin)
  where device_pin is not null;

create unique index if not exists house_helps_society_pin_uniq
  on public.house_helps (society_id, device_pin)
  where device_pin is not null;

-- Carry across anything already mapped the old way, so nothing is lost.
update public.staff_members s
   set device_pin = m.device_pin
  from public.device_user_map m
 where m.subject_id = s.id
   and m.subject_category = 'society_staff'
   and s.device_pin is null;

update public.house_helps h
   set device_pin = m.device_pin
  from public.device_user_map m
 where m.subject_id = h.id
   and m.subject_category = 'house_help'
   and h.device_pin is null;

-- ─────────────────────────────────────────────
-- Resolve a PIN to a person. Used by the push endpoint.
-- Checks the person records first, then falls back to device_user_map
-- for a multi-terminal override.
-- ─────────────────────────────────────────────
create or replace function public.resolve_device_pin(
  p_society_id uuid,
  p_pin        text
)
returns table (subject_id uuid, subject_category public.staff_category)
language sql
stable
as $$
  select s.id, 'society_staff'::public.staff_category
    from public.staff_members s
   where s.society_id = p_society_id and s.device_pin = p_pin
  union all
  select h.id, 'house_help'::public.staff_category
    from public.house_helps h
   where h.society_id = p_society_id and h.device_pin = p_pin
  union all
  select m.subject_id, m.subject_category
    from public.device_user_map m
   where m.society_id = p_society_id and m.device_pin = p_pin
     and not exists (select 1 from public.staff_members s2
                      where s2.society_id = p_society_id and s2.device_pin = p_pin)
     and not exists (select 1 from public.house_helps h2
                      where h2.society_id = p_society_id and h2.device_pin = p_pin)
  limit 1;
$$;

-- ─────────────────────────────────────────────
-- PINs that have punched but belong to nobody yet.
-- This is what the admin screen lists.
-- ─────────────────────────────────────────────
-- Dropped first: "create or replace view" refuses to run if the column
-- list differs at all from the existing view, and this definition changes
-- how the view is built.
drop view if exists public.unmapped_device_pins;
create view public.unmapped_device_pins
with (security_invoker = on)
as
select p.society_id,
       p.device_id,
       p.device_pin,
       count(*)          as punch_count,
       min(p.punched_at) as first_seen,
       max(p.punched_at) as last_seen
  from public.device_punches p
 where not exists (
         select 1 from public.staff_members s
          where s.society_id = p.society_id and s.device_pin = p.device_pin)
   and not exists (
         select 1 from public.house_helps h
          where h.society_id = p.society_id and h.device_pin = p.device_pin)
   and not exists (
         select 1 from public.device_user_map m
          where m.society_id = p.society_id and m.device_pin = p.device_pin)
 group by p.society_id, p.device_id, p.device_pin;

grant select on public.unmapped_device_pins to authenticated;
