-- ============================================================
-- managesociety.in — close the last public registration door,
-- and stop a manager from making themselves an admin
--
-- Run once in the Supabase SQL editor. Safe to re-run.
-- Requires registration_lockdown.sql to have been run first.
--
-- TWO CHANGES.
--
-- 1. NOBODY REGISTERS THEMSELVES ANY MORE.
--    registration_lockdown.sql left one door open: an anonymous
--    visitor could still request 'admin' or 'manager'. That was for
--    new committees, but it is not how a new committee actually
--    arrives — approve-society creates the society, the auth user, the
--    profile and the admin role in one step. So the door led nowhere
--    useful and did let a stranger who knew a slug drop an admin
--    request into a society's queue, where a busy reviewer might
--    approve it and hand over full access to members and other admins.
--
--    /register-society stays public. It is now the only way in from
--    outside, and a super admin reviews every one.
--
-- 2. A MANAGER MAY NO LONGER CREATE AN ADMIN.
--    This is a bug in registration_lockdown.sql, shipped yesterday.
--    Its policy gated on is_committee(), which is true for admin AND
--    manager, and then allowed any of the four roles. A manager could
--    therefore create an admin account and read the temporary password
--    the approval returns — a straight escalation past the two
--    capabilities the manager role exists to withhold.
--
--    The capability model already answers who may create whom:
--    a manager is denied members.edit and admins.edit, and granted
--    guards.manage. So:
--
--      admin    -> admin, manager, guard, resident
--      manager  -> guard only
--      anyone else -> nothing
--
--    Mirrored by rolesCreatableBy() in src/lib/permissions.ts, but
--    enforced here, because the page is not a control.
--
-- No app_role enum literal appears in this file; every role comparison
-- is on text, so it applies in a single transaction (55P04).
-- ============================================================


-- ─────────────────────────────────────────────
-- 1. No anonymous registration requests at all
--
--    Policy first, then the grant. With the grant gone, anon fails at
--    the door rather than silently matching no policy, and a future
--    policy cannot quietly re-open the table.
-- ─────────────────────────────────────────────
drop policy if exists "Public may request committee roles only" on public.registration_requests;
drop policy if exists "Anyone can submit registration request" on public.registration_requests;

revoke insert on public.registration_requests from anon;


-- ─────────────────────────────────────────────
-- 2. Who holds which role, as text
--
--    Replaces is_committee(), which lumped admin and manager together
--    and was the cause of the escalation above. Text comparison keeps
--    enum literals out of this transaction.
-- ─────────────────────────────────────────────
create or replace function public.has_role_text(_user_id uuid, _role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles ur
     where ur.user_id = _user_id
       and ur.role::text = _role
  )
$$;

revoke all on function public.has_role_text(uuid, text) from public;
grant execute on function public.has_role_text(uuid, text) to authenticated;


-- ─────────────────────────────────────────────
-- 3. Creation rights, split by role
--
--    society_id is pinned to the caller's own society in both
--    branches, so neither an admin nor a manager can seed a request
--    into another society's queue.
-- ─────────────────────────────────────────────
drop policy if exists "Committee creates members for own society" on public.registration_requests;
create policy "Committee creates members for own society"
  on public.registration_requests
  for insert to authenticated
  with check (
    society_id = public.get_user_society_id(auth.uid())
    and (
      -- An admin may create anyone, including another admin.
      (
        public.has_role_text(auth.uid(), 'admin')
        and requested_role in ('guard', 'resident', 'admin', 'manager')
      )
      -- A manager may create guards and nothing else: they are denied
      -- members.edit and admins.edit, and granted guards.manage.
      or (
        public.has_role_text(auth.uid(), 'manager')
        and not public.has_role_text(auth.uid(), 'admin')
        and requested_role = 'guard'
      )
    )
  );


-- ─────────────────────────────────────────────
-- 4. is_committee() is no longer used
--
--    Dropped rather than left behind. A SECURITY DEFINER function that
--    answers "is this person admin OR manager" is exactly the thing
--    someone reaches for next time, and reaching for it is what caused
--    the escalation.
-- ─────────────────────────────────────────────
drop function if exists public.is_committee(uuid);


-- ─────────────────────────────────────────────
-- 5. A message a human can act on
--
--    Supersedes the trigger from registration_lockdown.sql, which only
--    covered guard and resident because anon could still request the
--    committee roles. Anon can request nothing now.
-- ─────────────────────────────────────────────
create or replace function public.refuse_self_service_member_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception
      'Accounts are created by your society, not by registration. Ask your society committee to add you. A new society registers at /register-society.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_refuse_self_service_member_role on public.registration_requests;
create trigger trg_refuse_self_service_member_role
  before insert on public.registration_requests
  for each row execute function public.refuse_self_service_member_role();


-- ─────────────────────────────────────────────
-- 6. What is left
--
--    Expect exactly one INSERT policy, for `authenticated`. Any INSERT
--    row naming {anon} or {public} means section 1 did not run.
-- ─────────────────────────────────────────────
select policyname, cmd, roles::text, coalesce(with_check, qual) as condition
  from pg_policies
 where schemaname = 'public' and tablename = 'registration_requests'
 order by cmd, policyname;

notify pgrst, 'reload schema';
