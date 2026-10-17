-- ============================================================
-- managesociety.in — the Manager role
--
-- Run once in the Supabase SQL editor. Guarded; safe to re-run.
--
-- A manager is an administrator with two powers removed:
--   * they may not modify registered members or their profiles
--   * they may not modify or delete any admin profile
-- Everything else an admin does, they do.
--
-- DESIGN: GRANT, DO NOT SUBTRACT
-- A manager holds ONLY the 'manager' role, never 'admin'. Every policy
-- and every Edge Function in this project already gates on
-- has_role(..., 'admin'), so a manager is refused by all of them from
-- the moment the role exists, before a single policy below is read.
-- Access is then granted back deliberately, table by table.
--
-- The alternative — giving managers the admin role and subtracting —
-- was rejected: it means every present and future admin check is open
-- to managers unless someone remembers to exclude them. Forgetting
-- would silently hand a manager the power to delete residents. With
-- grant-only, forgetting means a manager cannot do something they
-- should, which is visible, complained about, and harmless.
--
-- NOTE ON delete-user AND list-users
-- Member deletion runs through the delete-user Edge Function using the
-- service role, which bypasses RLS entirely. No policy here can stop
-- it. It already requires has_role(caller,'admin'), so a manager is
-- refused — that check is the real boundary and must stay. list-users
-- is handled in section 5.
-- ============================================================


-- ─────────────────────────────────────────────
-- 1. THE ROLE
-- ─────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
     where t.typname = 'app_role' and e.enumlabel = 'manager'
  ) then
    alter type public.app_role add value 'manager';
  end if;
end $$;

-- RUNS IN ONE PASTE. Postgres refuses to USE a new enum value in the
-- same transaction that adds it (error 55P04), and the Supabase SQL
-- editor wraps a script in one transaction. An earlier version of this
-- file told you to run section 1 separately; relying on a human reading
-- a comment is not a fix. Nothing below ever writes 'manager' as an
-- enum literal - every check compares role::text against a string, so
-- the new value is never materialised and the ordering problem simply
-- does not arise.


-- ─────────────────────────────────────────────
-- 2. HELPERS
--    SECURITY DEFINER, mirroring has_role(), so a policy that calls
--    them does not re-enter the table it is protecting.
-- ─────────────────────────────────────────────

-- Admin or manager: the test for "may run the society".
create or replace function public.is_staff_operator(_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles ur
     where ur.user_id = _user
       and ur.role::text in ('admin', 'manager')
  )
$$;

-- Is this person an administrator? Used to protect admin rows from
-- managers.
create or replace function public.is_admin_user(_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles ur
     where ur.user_id = _user and ur.role::text = 'admin'
  )
$$;

-- Is this person a manager? Used by every policy below in place of
-- has_role(..., 'manager'::app_role), which would be an enum literal.
create or replace function public.is_manager(_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles ur
     where ur.user_id = _user and ur.role::text = 'manager'
  )
$$;

grant execute on function public.is_manager(uuid)        to authenticated;
grant execute on function public.is_staff_operator(uuid) to authenticated;
grant execute on function public.is_admin_user(uuid)     to authenticated;


-- ─────────────────────────────────────────────
-- 3. WHAT A MANAGER MAY RUN
--    Operational tables only. Each policy is additive: the existing
--    admin policies are untouched, these sit alongside them.
--
--    Deliberately NOT included: profiles (members) and user_roles.
--    Those are the two things a manager must not change.
-- ─────────────────────────────────────────────
do $$
declare
  t text;
  op_tables text[] := array[
    'staff_members', 'house_helps', 'staff_logs',
    'vehicles', 'access_logs', 'entry_logs',
    'barrier_devices', 'amenities', 'amenity_bookings',
    'maintenance_bills', 'maintenance_charge_heads',
    'biometric_devices', 'device_user_map', 'device_punches'
  ];
begin
  foreach t in array op_tables loop
    -- Skip anything this database does not have, so the file works
    -- against a partially-migrated schema instead of aborting.
    if to_regclass('public.' || t) is null then
      raise notice 'skipping %, table not present', t;
      continue;
    end if;

    execute format('drop policy if exists %I on public.%I',
                   'managers operate ' || t, t);
    execute format($f$
      create policy %I on public.%I
        for all to authenticated
        using (
          public.is_manager(auth.uid())
          and society_id = public.get_user_society_id(auth.uid())
        )
        with check (
          public.is_manager(auth.uid())
          and society_id = public.get_user_society_id(auth.uid())
        )
    $f$, 'managers operate ' || t, t);
  end loop;
end $$;


-- ─────────────────────────────────────────────
-- 4. MEMBERS AND ADMINS: READ ONLY
--
--    A manager can look a resident up — they cannot approve a booking
--    or chase a bill otherwise — but cannot change anything. SELECT
--    only, and no insert, update or delete policy is created, so those
--    remain denied.
-- ─────────────────────────────────────────────
drop policy if exists "managers read profiles" on public.profiles;
create policy "managers read profiles" on public.profiles
  for select to authenticated
  using (
    public.is_manager(auth.uid())
    and society_id = public.get_user_society_id(auth.uid())
  );

drop policy if exists "managers read roles" on public.user_roles;
create policy "managers read roles" on public.user_roles
  for select to authenticated
  using (public.is_manager(auth.uid()));


-- ─────────────────────────────────────────────
-- 5. BELT AND BRACES: STOP A MANAGER EDITING AN ADMIN
--
--    Section 4 grants managers no write policy on profiles, so this
--    should be unreachable. It exists because the cost of being wrong
--    is a manager deleting an administrator, and because a future
--    migration could add a broad "operators manage profiles" policy
--    without anyone remembering this constraint. A trigger refuses the
--    write regardless of which policy allowed it.
--
--    Does NOT fire for the service role, which is how delete-user runs
--    — that function's own has_role(caller,'admin') check covers it.
-- ─────────────────────────────────────────────
create or replace function public.refuse_manager_touching_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- auth.uid() is null under the service role; nothing to check.
  if auth.uid() is null then
    return coalesce(new, old);
  end if;

  if public.is_manager(auth.uid())
     and not public.is_admin_user(auth.uid())
  then
    if public.is_admin_user(coalesce(old.id, new.id)) then
      raise exception
        'A manager cannot modify or delete an administrator account'
        using errcode = 'insufficient_privilege';
    end if;
    raise exception
      'A manager cannot modify member profiles'
      using errcode = 'insufficient_privilege';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_refuse_manager_touching_admin on public.profiles;
create trigger trg_refuse_manager_touching_admin
  before update or delete on public.profiles
  for each row execute function public.refuse_manager_touching_admin();

notify pgrst, 'reload schema';
