-- ============================================================================
-- Fix: RLS policies matched profiles.id against auth.uid(), which is never
-- the same value — so they denied everything.
--
-- Run this whole file in the Supabase SQL editor. It is idempotent and
-- changes no data, only policy expressions.
--
-- WHAT WENT WRONG
--
-- public.profiles has BOTH columns:
--
--   id       the profile row's own key
--   user_id  the auth user it belongs to
--
-- Every query in the application matches on user_id — AuthContext, the
-- admin profile screen, the resident portal, both native apps, and
-- approve-society, which looks a profile up by user_id and then reads
-- its id as a separate value. auth.uid() returns the AUTH user id, so
--
--   where p.id = auth.uid()
--
-- matches no row, the subquery is empty, and "society_id in (empty)" is
-- false. Every policy written that way denies.
--
-- HOW IT SHOWED, AND DID NOT SHOW
--
-- On INSERT it is loud: "new row violates row-level security policy",
-- which is how this was found — applying a per-flat parking charge.
--
-- On SELECT it is silent. A denying policy returns no rows rather than
-- an error, so the affected screens show an empty list and look merely
-- unused: biometric devices, device punches, the notification log,
-- notification preferences, fingerprint enrolments. Worth checking
-- those once this is applied, because "we have no devices registered"
-- and "you are not allowed to see the devices" look identical.
--
-- WHY IT IS REWRITTEN RATHER THAN RETYPED
--
-- The statements below read each policy's CURRENT expression out of
-- pg_policies, swap the one token, and put it back. Retyping ten
-- policies by hand risks a transcription error in security rules, and
-- it would silently overwrite any policy that has been edited in the
-- dashboard since its file was written. This changes the column being
-- compared and nothing else.
--
-- Narrow on purpose: only policies whose expression selects FROM
-- profiles p are touched, so a policy that legitimately compares some
-- other table's id is left alone.
-- ============================================================================

do $$
declare
  r record;
  new_qual text;
  new_check text;
  stmt text;
  fixed int := 0;
begin
  for r in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') || coalesce(with_check, '')) like '%p.id = auth.uid()%'
      and (coalesce(qual, '') || coalesce(with_check, '')) like '%profiles p%'
  loop
    new_qual  := replace(coalesce(r.qual, ''),       'p.id = auth.uid()', 'p.user_id = auth.uid()');
    new_check := replace(coalesce(r.with_check, ''), 'p.id = auth.uid()', 'p.user_id = auth.uid()');

    stmt := format('alter policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    if r.qual is not null then
      stmt := stmt || format(' using (%s)', new_qual);
    end if;
    if r.with_check is not null then
      stmt := stmt || format(' with check (%s)', new_check);
    end if;

    execute stmt;
    fixed := fixed + 1;
    raise notice 'fixed %.% policy "%"', r.schemaname, r.tablename, r.policyname;
  end loop;

  raise notice '% policies corrected.', fixed;
end $$;


-- ── Check none are left ─────────────────────────────────────────────────────

do $$
declare
  leftover int;
begin
  select count(*) into leftover
  from pg_policies
  where schemaname = 'public'
    and (coalesce(qual, '') || coalesce(with_check, '')) like '%p.id = auth.uid()%'
    and (coalesce(qual, '') || coalesce(with_check, '')) like '%profiles p%';

  if leftover > 0 then
    raise exception '% policies still compare profiles.id to auth.uid()', leftover;
  end if;

  raise notice 'rls_profiles_user_id_fix.sql applied cleanly.';
end $$;
