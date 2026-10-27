-- ============================================================
-- managesociety.in — only the committee may create guard and
-- resident accounts
--
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- THE PROBLEM
-- registration_requests had one insert policy:
--
--   CREATE POLICY "Anyone can submit registration request"
--     ON public.registration_requests FOR INSERT WITH CHECK (true);
--
-- WITH CHECK (true) means exactly that. Anyone on the internet could
-- post a request naming any role, for any society, and it appeared in
-- that committee's approval queue carrying a name, an email and a flat
-- number they never asked to receive. A stranger could also learn
-- which flats exist by watching what the form accepted.
--
-- Guards and residents are now created BY the committee. The approval
-- queue stays for the committee's own accounts, which is the one case
-- where somebody outside the system legitimately asks to be let in.
--
-- WHO MAY INSERT WHAT, AFTER THIS
--   anon (signed out)   -> 'admin' or 'manager' only
--   admin or manager    -> any member role, for THEIR OWN society
--   anyone else         -> nothing
--
-- The frontend mirrors this in SELF_SERVICE_ROLES (src/lib/
-- permissions.ts), but that list only decides what the page offers.
-- This file is what makes it true, because the publishable key can
-- post to the REST endpoint directly.
--
-- NOTE ON ROLE LITERALS
-- requested_role is TEXT, and every comparison below is on text. No
-- app_role enum literal appears anywhere in this file, so it applies
-- in a single transaction even on a database where a role value was
-- added recently (Postgres 55P04 — a new enum value cannot be used in
-- the transaction that adds it).
-- ============================================================


-- ─────────────────────────────────────────────
-- 1. The outer bound: which roles may ever be requested
--
--    Independent of who is asking. super_admin is in the app_role
--    enum and is NOT society-scoped, so it must never be reachable
--    through this table whatever else goes wrong above it.
--
--    NOT VALID so a historical row with an unexpected value cannot
--    stop the file applying; new and updated rows are still checked.
-- ─────────────────────────────────────────────
alter table public.registration_requests
  drop constraint if exists registration_requests_role_allowlist;

alter table public.registration_requests
  add constraint registration_requests_role_allowlist
  check (requested_role in ('guard', 'resident', 'admin', 'manager'))
  not valid;


-- ─────────────────────────────────────────────
-- 2. Who is asking
--
--    Deliberately not is_manager() or has_role(): both live in files
--    whose deployment state varies, and has_role() takes an app_role,
--    which would put an enum literal back into this transaction.
--    Reading user_roles as text has neither problem.
--
--    SECURITY DEFINER so the policies below can call it without the
--    caller needing to read user_roles, and without re-entering that
--    table's own policies.
-- ─────────────────────────────────────────────
create or replace function public.is_committee(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles ur
     where ur.user_id = _user_id
       and ur.role::text in ('admin', 'manager')
  )
$$;

revoke all on function public.is_committee(uuid) from public;
grant execute on function public.is_committee(uuid) to authenticated;


-- ─────────────────────────────────────────────
-- 3. Replace the open insert policy
--
--    Postgres ORs permissive policies, so the old one has to GO. A
--    correct policy added beside it would grant nothing extra and
--    block nothing at all.
-- ─────────────────────────────────────────────
drop policy if exists "Anyone can submit registration request" on public.registration_requests;


-- 3a. Signed out: committee roles only.
--
--     This is the "our society wants to join the platform" path, and
--     the one case where the person asking has no account yet. A guard
--     or resident has a committee who can create them, so neither
--     needs this door.
drop policy if exists "Public may request committee roles only" on public.registration_requests;
create policy "Public may request committee roles only"
  on public.registration_requests
  for insert to anon
  with check (requested_role in ('admin', 'manager'));


-- 3b. Signed in as the committee: create members of your OWN society.
--
--     This is how BulkResidentUpload and the Add Guard form work —
--     they write a request and immediately approve it, so the account
--     is created by the committee rather than requested by a stranger.
--
--     society_id is pinned to the caller's own society, so an admin of
--     one society cannot seed a request into another's queue.
drop policy if exists "Committee creates members for own society" on public.registration_requests;
create policy "Committee creates members for own society"
  on public.registration_requests
  for insert to authenticated
  with check (
    public.is_committee(auth.uid())
    and society_id = public.get_user_society_id(auth.uid())
    and requested_role in ('guard', 'resident', 'admin', 'manager')
  );


-- ─────────────────────────────────────────────
-- 4. A message a human can act on
--
--    A bare RLS refusal reads as "new row violates row-level security
--    policy", which tells an admin nothing. This fires first for the
--    one mistake that is actually likely: trying to self-register as a
--    guard or resident.
-- ─────────────────────────────────────────────
create or replace function public.refuse_self_service_member_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null and new.requested_role in ('guard', 'resident') then
    raise exception
      'A % account is created by your society committee, not by registration. Please ask your committee to add you.',
      new.requested_role
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
-- 5. What is left
--
--    Expect no policy whose insert condition is just `true`. Any row
--    below showing with_check = 'true' means section 3 did not run.
-- ─────────────────────────────────────────────
select policyname, cmd, roles::text, coalesce(with_check, qual) as condition
  from pg_policies
 where schemaname = 'public' and tablename = 'registration_requests'
 order by cmd, policyname;

notify pgrst, 'reload schema';
