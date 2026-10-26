-- ============================================================
-- managesociety.in — stop the public from listing every society
--
-- Run once in the Supabase SQL editor. Safe to re-run.
--
-- THE PROBLEM
-- societies carried two things that together published the whole
-- customer list to the open internet:
--
--   GRANT SELECT ON public.societies TO anon;
--   CREATE POLICY "Public can view active societies" ON public.societies
--     FOR SELECT USING (status = 'active');
--
-- No role test, no society test. Anyone holding the publishable key —
-- which ships inside the JavaScript bundle and is meant to be public —
-- could read the name, slug, city and state of every active society.
-- Removing the picker from the UI would not have changed that: the UI
-- was one caller of an endpoint anybody can call.
--
-- WHAT REPLACES IT
--   1. Signed-in users read their OWN society, and nothing else.
--   2. super_admin keeps full access (its existing FOR ALL policy).
--   3. Anonymous callers lose table access entirely and get one
--      function instead: society_public(), which resolves a SINGLE
--      society from a slug or an id it was already given.
--
-- Resolving a known handle is not the same as listing. A caller who
-- has the link their society sent them gets that one row; a caller
-- with nothing gets nothing, because there is no query that returns
-- more than one row.
--
-- HONEST LIMIT: a slug is derived from the society's name, so someone
-- determined can still guess handles one at a time and learn whether
-- each exists. That is a far smaller surface than an enumerable list,
-- but it is not zero. Supabase rate limiting is the remaining control,
-- and an invite code per society would close it completely if you ever
-- want that.
-- ============================================================


-- ─────────────────────────────────────────────
-- 1. Remove the public read
--
--    Both halves. Dropping the policy alone would already return zero
--    rows to anon, but leaving the table grant in place means the next
--    person to add a policy re-opens the hole without noticing. Taking
--    the grant away makes anon fail at the door instead.
-- ─────────────────────────────────────────────
drop policy if exists "Public can view active societies" on public.societies;

revoke select on public.societies from anon;


-- ─────────────────────────────────────────────
-- 2. A signed-in user reads their own society
--
--    AuthContext needs the name and slug of the society the user
--    belongs to, immediately after sign-in, to build their dashboard
--    URL. get_user_society_id() is SECURITY DEFINER and reads profiles,
--    so this does not recurse through this table's own policies.
--
--    Scoped to the one row. A resident of one society still cannot see
--    another society exists.
-- ─────────────────────────────────────────────
drop policy if exists "Members read their own society" on public.societies;
create policy "Members read their own society" on public.societies
  for select to authenticated
  using (id = public.get_user_society_id(auth.uid()));


-- ─────────────────────────────────────────────
-- 3. Resolve ONE society from a handle the caller already has
--
--    Takes a slug (from /{slug}/register, /{slug}/visitor/form) or an
--    id (the ?s= parameter printed into visitor QR codes). A UUID is
--    not guessable; a slug is, which is the limit noted at the top.
--
--    LIMIT 1 and the status test are inside the function, so there is
--    no argument that makes it return a list. Passing neither argument
--    returns nothing rather than everything — the WHERE is false, not
--    absent, which is the failure mode that matters here.
--
--    SECURITY DEFINER so it can read the table that anon can no longer
--    touch. search_path is pinned, as every definer function must be.
-- ─────────────────────────────────────────────
create or replace function public.society_public(
  _slug text default null,
  _id   uuid default null
)
returns table (id uuid, name text, slug text, city text, state text)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.name, s.slug, s.city, s.state
    from public.societies s
   where s.status = 'active'
     and (
       (_slug is not null and s.slug = _slug)
       or (_id is not null and s.id = _id)
     )
   limit 1
$$;

-- Postgres grants EXECUTE to PUBLIC by default, which would also cover
-- roles added later. Stated explicitly instead.
revoke all on function public.society_public(text, uuid) from public;
grant execute on function public.society_public(text, uuid) to anon, authenticated;


-- ─────────────────────────────────────────────
-- 4. What is left on the table
--
--    Expect exactly three policies: the super_admin FOR ALL, the
--    members SELECT added above, and the admins UPDATE. If
--    "Public can view active societies" still appears, section 1 did
--    not run.
-- ─────────────────────────────────────────────
select policyname, cmd, roles::text, coalesce(qual, with_check) as condition
  from pg_policies
 where schemaname = 'public' and tablename = 'societies'
 order by policyname;

notify pgrst, 'reload schema';
