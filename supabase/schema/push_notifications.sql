-- ============================================================
-- managesociety.in — push notifications, end to end
--
-- Run once in the Supabase SQL editor, AFTER device_push_tokens.sql.
-- Guarded throughout; safe to re-run.
--
-- WHAT THIS REPLACES
-- Nothing. Until this file, the app collected FCM device tokens and
-- never sent a single notification: no trigger, no page and no function
-- called send-push-notification. The hook, the table and the Firebase
-- dependency were all in place around an empty middle.
--
--
-- HOW IT WORKS — an outbox, not direct calls
--
--   1. Something happens in a table (a resident asks for a vehicle
--      change, a guard logs a delivery, an admin approves a booking).
--   2. A row-level trigger works out WHO should hear about it and
--      inserts one row into notification_events. That row is the
--      message: recipients, title, body, and a little JSON saying
--      which screen to open.
--   3. The first message queued in a transaction — and only the first —
--      makes a single HTTP call to the send-push-notification Edge
--      Function asking it to drain the outbox.
--   4. The function sends each message through FCM and writes the
--      result back onto the row.
--
-- WHY AN OUTBOX, AND WHY ONE CALL PER TRANSACTION
-- The obvious design — call the Edge Function directly from each row
-- trigger — breaks on the operations that matter most. Generating
-- maintenance bills inserts one row per flat; for a 200-flat society
-- that is 200 HTTP calls from inside one transaction. A bulk resident
-- import or a CSV vehicle upload is the same shape. Dispatching once
-- per transaction makes that ONE call no matter how many messages were
-- queued, and the function drains everything pending.
--
-- See request_notification_dispatch() in section 5 for why this is a
-- transaction-local flag rather than a statement-level trigger. The
-- short version: a statement-level trigger on notification_events
-- fires once per INSERT against it, and every message is its own
-- INSERT, so it batched nothing.
--
-- The outbox also makes failure visible, which direct calls do not.
-- pg_net is fire-and-forget: if the function is down, a direct call
-- disappears with no trace. Here the row simply stays pending, which
-- is a query anyone can run:
--
--   select * from public.notification_events
--    where dispatched_at is null order by created_at;
--
-- And it is an audit log. "Did the admin actually get told?" has an
-- answer.
--
-- NOTHING HERE CAN BREAK THE APP
-- Every trigger returns NULL from an AFTER trigger, so it cannot alter
-- the row. Every dispatch failure is a WARNING, never an exception. A
-- resident's booking must not roll back because Firebase is down.
--
--
-- WHAT THIS FILE DOES NOT DO
-- iOS delivery. Apple push needs an APNs key from a paid Apple
-- Developer account, which this project does not have yet. iOS devices
-- can register and their tokens will be stored; FCM will refuse to
-- deliver to them until that key is uploaded to Firebase. Nothing here
-- needs changing when it is.
-- ============================================================


-- ─────────────────────────────────────────────
-- 0. pg_net, which is how Postgres makes an HTTP call
--
--    Already enabled on most Supabase projects. If this errors, enable
--    "pg_net" under Database -> Extensions and re-run.
-- ─────────────────────────────────────────────
create extension if not exists pg_net;


-- ─────────────────────────────────────────────
-- 1. THE OUTBOX
--
--    recipient_user_ids is an array rather than one row per person on
--    purpose: a notification is one event with an audience, and
--    collapsing it keeps the log readable and the FCM batching simple.
-- ─────────────────────────────────────────────
create table if not exists public.notification_events (
  id                 uuid primary key default gen_random_uuid(),
  society_id         uuid not null references public.societies(id) on delete cascade,
  -- Dotted, e.g. 'vehicle_request.created'. The prefix is the subject,
  -- the suffix is what happened. Doubles as the preferences key.
  event_key          text not null,
  recipient_user_ids uuid[] not null,
  title              text not null,
  body               text not null,
  -- Deep-link hints for the app: { role, view, id }. FCM only carries
  -- string values in `data`, so the Edge Function flattens this.
  data               jsonb not null default '{}'::jsonb,
  source_table       text,
  source_id          uuid,
  -- Who caused it, where that is known. NULL for anything done by an
  -- Edge Function with the service role — the visitor form, for one.
  actor_user_id      uuid,
  created_at         timestamptz not null default now(),
  -- Taken by claim_notifications() so two overlapping drains cannot
  -- both send the same message. Expires, so a crashed invocation does
  -- not strand it. See section 5b.
  claimed_at         timestamptz,
  -- Set by the Edge Function once it has tried. NULL means pending.
  dispatched_at      timestamptz,
  sent_count         integer,
  failed_count       integer,
  error              text
);

-- For a database that ran an earlier version of this file.
alter table public.notification_events add column if not exists claimed_at timestamptz;

-- The drain query is "everything still pending, oldest first". A
-- partial index keeps that cheap as the log grows, and it will grow.
create index if not exists notification_events_pending_idx
  on public.notification_events (created_at)
  where dispatched_at is null;

create index if not exists notification_events_society_idx
  on public.notification_events (society_id, created_at desc);


-- ─────────────────────────────────────────────
-- 2. PER-SOCIETY ON/OFF SWITCHES
--
--    Some of these events are useful to one society and noise to
--    another — 'staff.qr_issued' fires every time a house help is
--    added, which is nothing in a small building and constant during
--    an onboarding week. An absent row means enabled, so a new event
--    starts on and a society stores only what it switched off.
-- ─────────────────────────────────────────────
create table if not exists public.notification_preferences (
  society_id uuid not null references public.societies(id) on delete cascade,
  event_key  text not null,
  enabled    boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (society_id, event_key)
);

create or replace function public.notification_enabled(_society uuid, _event_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select enabled from public.notification_preferences
      where society_id = _society and event_key = _event_key),
    true)
$$;


-- ─────────────────────────────────────────────
-- 3. WHO HEARS ABOUT IT
--
--    These run SECURITY DEFINER because a trigger fires as the person
--    who made the change, and a resident cannot read user_roles to
--    find their society's admins.
--
--    Every one of them scopes on profiles.society_id rather than
--    user_roles.society_id. profiles.user_id is unique and is where
--    AuthContext reads a person's society from, whereas user_roles
--    rows can carry NULL (a super admin) — and a NULL there would
--    otherwise match a society it has nothing to do with.
--
--    EXECUTE is revoked from clients at the end of this section. They
--    would otherwise let any signed-in resident enumerate the user ids
--    of every admin and guard in their society. Triggers are
--    unaffected: a SECURITY DEFINER trigger runs as the owner.
-- ─────────────────────────────────────────────

create or replace function public.notify_by_role(_society uuid, _roles text[])
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct ur.user_id), '{}'::uuid[])
    from public.user_roles ur
    join public.profiles p on p.user_id = ur.user_id
   where p.society_id = _society
     and ur.role::text = any(_roles)
$$;

-- Admins and managers. A manager runs the society day to day, so they
-- want the approval queue as much as an admin does — they are denied
-- only the power to change members and other admins, which is not what
-- any of these notifications are about.
create or replace function public.notify_admins(_society uuid)
returns uuid[]
language sql stable security definer set search_path = public
as $$ select public.notify_by_role(_society, array['admin', 'manager']) $$;

create or replace function public.notify_guards(_society uuid)
returns uuid[]
language sql stable security definer set search_path = public
as $$ select public.notify_by_role(_society, array['guard']) $$;

-- Everyone who lives in a flat.
--
-- Two sources, unioned, because this schema records where somebody
-- lives in two places: resident_flats (authoritative, supports more
-- than one flat per person) and profiles.wing/flat_number (the older
-- single-flat copy). Reading only one silently misses people, and
-- which one it misses depends on how their account was created — the
-- worst kind of bug to diagnose from a complaint that says "I never
-- get notifications".
--
-- _wing is matched only when given. visitor_requests carries a flat
-- number and no wing at all, so for that event any matching flat
-- number in the society is notified. In a society with wings that is
-- imprecise, and deliberately so: telling A-101 about a visitor for
-- B-101 is a small annoyance, telling nobody leaves a person at the
-- gate. Callers pass nullif(wing, '') so an empty string behaves like
-- "no wing given" rather than matching nothing.
create or replace function public.notify_flat(_society uuid, _wing text, _flat text)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct uid), '{}'::uuid[])
    from (
      select rf.user_id as uid
        from public.resident_flats rf
       where rf.society_id = _society
         and rf.flat_number = _flat
         and (_wing is null or rf.wing = _wing)
      union
      select p.user_id
        from public.profiles p
       where p.society_id = _society
         and p.flat_number = _flat
         and (_wing is null or p.wing = _wing)
    ) s
   where uid is not null
$$;


-- ─────────────────────────────────────────────
-- 4. QUEUEING ONE MESSAGE
--
--    Every trigger below ends in a call to this. It is the only thing
--    that writes to the outbox, so the three rules that must hold for
--    all events — respect the society's preferences, never notify the
--    person who caused it, never queue a message with no audience —
--    are stated once here instead of once per trigger.
-- ─────────────────────────────────────────────
create or replace function public.queue_notification(
  _society      uuid,
  _event_key    text,
  _recipients   uuid[],
  _title        text,
  _body         text,
  _data         jsonb default '{}'::jsonb,
  _source_table text default null,
  _source_id    uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  _actor uuid := auth.uid();
  _final uuid[];
  _id    uuid;
begin
  if _society is null or _recipients is null or array_length(_recipients, 1) is null then
    return null;
  end if;

  if not public.notification_enabled(_society, _event_key) then
    return null;
  end if;

  -- Never tell somebody what they just did. This is why the approving
  -- admin gets no "booking approved" notification of their own, and why
  -- a resident who cancels their own booking hears nothing.
  if _actor is null then
    _final := array(select distinct u from unnest(_recipients) as u where u is not null);
  else
    _final := array(
      select distinct u from unnest(_recipients) as u
       where u is not null and u <> _actor
    );
  end if;

  if array_length(_final, 1) is null then
    return null;
  end if;

  insert into public.notification_events (
    society_id, event_key, recipient_user_ids, title, body, data,
    source_table, source_id, actor_user_id
  ) values (
    _society, _event_key, _final, _title, _body, coalesce(_data, '{}'::jsonb),
    _source_table, _source_id, _actor
  )
  returning id into _id;

  -- Ask for a drain. Self-limiting to one call per transaction, so a
  -- 200-flat billing run makes one HTTP request, not 200.
  perform public.request_notification_dispatch();

  return _id;
end
$$;


-- ─────────────────────────────────────────────
-- 5. DISPATCH
--
--    The service role key is a secret and must not live in this file.
--    It is read from Supabase Vault, with a database setting as a
--    fallback for projects without Vault. Set ONE of them yourself,
--    once — see section 9.
--
--    If neither is set, every insert still lands in the outbox and a
--    warning goes to the Postgres log. Nothing is lost and nothing
--    fails; messages sit pending until the key exists, at which point
--    the next event drains all of them.
-- ─────────────────────────────────────────────
create or replace function public.notification_service_key()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  k text;
begin
  -- Vault lives in its own schema and may not be installed. A missing
  -- schema raises rather than returning no rows, hence the block.
  begin
    select decrypted_secret into k
      from vault.decrypted_secrets
     where name = 'service_role_key'
     limit 1;
  exception when others then
    k := null;
  end;

  if k is null or k = '' then
    k := nullif(current_setting('app.settings.service_role_key', true), '');
  end if;

  return k;
end
$$;

/**
 * Ask the Edge Function to drain the outbox. ONCE PER TRANSACTION,
 * however many messages that transaction queued.
 *
 * WHY A TRANSACTION-LOCAL FLAG AND NOT A TRIGGER
 * The obvious implementation is a statement-level AFTER INSERT trigger
 * on notification_events, and it does not work. "Statement" there means
 * each INSERT executed against that table — and every message is
 * inserted by its own INSERT inside queue_notification(). Generating
 * 200 bills would run 200 separate single-row inserts and fire the
 * trigger 200 times, which is the exact thing the outbox was supposed
 * to avoid. Measured, not assumed: that trigger produced one call per
 * message, not one per statement.
 *
 * set_config(..., is_local => true) is scoped to the transaction and
 * reset on commit or rollback, so this fires on the first message and
 * is a no-op for the rest, then arms itself again for the next
 * transaction.
 *
 * This is safe to do before commit because pg_net does not make the
 * request inline: http_post writes to pg_net's own queue table and a
 * background worker sends it afterwards. So the single call lands after
 * this transaction commits and sees every row it wrote — and if the
 * transaction rolls back, the queued request rolls back with it and no
 * spurious call is made at all.
 */
create or replace function public.request_notification_dispatch()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  _key text;
begin
  if coalesce(current_setting('push.dispatch_requested', true), '') = 'yes' then
    return;
  end if;

  _key := public.notification_service_key();

  if _key is null then
    -- Deliberately a warning and not an exception: a missing key must
    -- never roll back the resident's booking or the guard's delivery
    -- entry. The message waits in the outbox instead.
    raise warning 'push: no service role key configured; % notification(s) pending. See supabase/schema/push_notifications.sql section 9.',
      (select count(*) from public.notification_events where dispatched_at is null);
    return;
  end if;

  -- Same reasoning for the call itself. pg_net missing, misconfigured
  -- or refusing is not the resident's problem.
  begin
    perform net.http_post(
      -- The project ref is public: it is the subdomain of the Supabase
      -- URL and ships inside the JavaScript bundle. Only the key is a
      -- secret.
      url     := 'https://lfmwrdtzyuveyvkfbsjn.supabase.co/functions/v1/send-push-notification',
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'Authorization', 'Bearer ' || _key
                 ),
      body    := jsonb_build_object('drain', true)
    );
    -- Set only AFTER the call was successfully queued, so that a
    -- failure here leaves the next message free to try again.
    perform set_config('push.dispatch_requested', 'yes', true);
  exception when others then
    raise warning 'push: dispatch failed (%), notifications left pending', sqlerrm;
  end;
end
$$;

-- An earlier version of this file dispatched from a statement-level
-- trigger. Removed rather than left in place: it would double every
-- notification on a database that had run both versions.
drop trigger if exists trg_dispatch_notifications on public.notification_events;
drop function if exists public.dispatch_notifications();


-- ─────────────────────────────────────────────
-- 5b. CLAIMING WORK, ATOMICALLY
--
--     The Edge Function asks for its batch through this rather than
--     selecting pending rows itself. Two drains can overlap easily —
--     a guard logging a delivery while a billing run is still going —
--     and two invocations that both SELECT the same pending rows both
--     send them, which the resident experiences as a duplicate
--     notification.
--
--     FOR UPDATE SKIP LOCKED is the fix, and it cannot be expressed
--     through the REST API, which is the real reason this is a
--     function and not a query in the function's TypeScript.
--
--     The claim expires after two minutes so that an invocation which
--     was killed mid-batch does not strand its messages for ever. The
--     cost of that is a possible duplicate if a send genuinely takes
--     longer than two minutes; the cost of no expiry is a message that
--     never arrives at all, which is worse.
-- ─────────────────────────────────────────────
create or replace function public.claim_notifications(_limit integer default 200)
returns setof public.notification_events
language sql
volatile
security definer
set search_path = public
as $$
  with picked as (
    select id
      from public.notification_events
     where dispatched_at is null
       and (claimed_at is null or claimed_at < now() - interval '2 minutes')
     -- Oldest first: a visitor waiting at the gate must not sit behind
     -- a billing run.
     order by created_at
     limit greatest(1, least(coalesce(_limit, 200), 500))
     for update skip locked
  )
  update public.notification_events e
     set claimed_at = now()
    from picked p
   where e.id = p.id
  returning e.*;
$$;

-- Called by the Edge Function as service_role, so that one role needs
-- an explicit grant once the default PUBLIC grant is revoked.
revoke all on function public.claim_notifications(integer) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.claim_notifications(integer) to service_role';
    execute 'grant select, update on public.notification_events to service_role';
    execute 'grant select, delete on public.device_push_tokens to service_role';
  else
    raise notice 'push: no service_role role here (not a Supabase database), skipping its grants.';
  end if;
end
$$;


-- ─────────────────────────────────────────────
-- 6. PERMISSIONS
--
--    The helpers above are SECURITY DEFINER, which means EXECUTE must
--    be taken away from clients explicitly — PostgreSQL grants it to
--    PUBLIC by default. Without these revokes, any signed-in resident
--    could call queue_notification() and push arbitrary text to every
--    person in their society, or call notify_admins() to list them.
--
--    Triggers keep working: a SECURITY DEFINER trigger function runs
--    as its owner, and the owner's own privileges are not revoked.
-- ─────────────────────────────────────────────
revoke all on function public.notification_service_key()                      from public, anon, authenticated;
revoke all on function public.request_notification_dispatch()                 from public, anon, authenticated;
revoke all on function public.notify_by_role(uuid, text[])                    from public, anon, authenticated;
revoke all on function public.notify_admins(uuid)                             from public, anon, authenticated;
revoke all on function public.notify_guards(uuid)                             from public, anon, authenticated;
revoke all on function public.notify_flat(uuid, text, text)                   from public, anon, authenticated;
revoke all on function public.notification_enabled(uuid, text)                from public, anon, authenticated;
revoke all on function public.queue_notification(uuid, text, uuid[], text, text, jsonb, text, uuid)
                                                                              from public, anon, authenticated;

-- The outbox itself. The Edge Function reads and writes it with the
-- service role, which bypasses RLS, so these policies govern only what
-- the app can see. The committee gets read access to their own
-- society's log because "was the resident actually told?" is a support
-- question they will be asked. Nobody writes to it from a client.
alter table public.notification_events enable row level security;
alter table public.notification_preferences enable row level security;

revoke all on public.notification_events      from anon;
revoke all on public.notification_preferences from anon;
grant select on public.notification_events to authenticated;
grant select, insert, update, delete on public.notification_preferences to authenticated;

drop policy if exists "Committee reads own society notification log" on public.notification_events;
create policy "Committee reads own society notification log"
  on public.notification_events
  for select to authenticated
  using (
    society_id = public.get_user_society_id(auth.uid())
    and exists (
      select 1 from public.user_roles ur
       where ur.user_id = auth.uid()
         and ur.role::text in ('admin', 'manager')
    )
  );

drop policy if exists "Admins manage notification preferences" on public.notification_preferences;
create policy "Admins manage notification preferences"
  on public.notification_preferences
  for all to authenticated
  using (
    society_id = public.get_user_society_id(auth.uid())
    and exists (select 1 from public.user_roles ur
                 where ur.user_id = auth.uid() and ur.role::text = 'admin')
  )
  with check (
    society_id = public.get_user_society_id(auth.uid())
    and exists (select 1 from public.user_roles ur
                 where ur.user_id = auth.uid() and ur.role::text = 'admin')
  );


-- ═════════════════════════════════════════════
-- 7. THE EVENTS
--
--    Grouped by direction. Each trigger function is named for its
--    table, compares statuses as TEXT (several of these columns are
--    enums, and text comparison keeps this file runnable in a single
--    transaction), and fires only when the status actually changed —
--    `is distinct from` rather than `<>`, so a NULL on either side
--    does not swallow the event.
--
--    Money is formatted as '₹' || to_char(...). The rupee sign cannot
--    go inside a to_char format string: it is not a format code, and
--    relying on to_char to pass unknown characters through is how you
--    get a notification that says "9,990.00" with no currency at all.
-- ═════════════════════════════════════════════

-- ── RESIDENT → ADMIN, and the reply back ─────

-- A resident asks to add, change or remove a vehicle; the committee
-- answers. Both halves live in one function because they are one
-- conversation about one row.
create or replace function public.notify_vehicle_change_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _flat text := coalesce(nullif(new.wing, '') || '-', '') || new.flat_number;
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    perform public.queue_notification(
      new.society_id, 'vehicle_request.created',
      public.notify_admins(new.society_id),
      'New vehicle request',
      format('%s (%s) asked to %s %s.', new.owner_name, _flat,
             case new.request_type
               when 'add' then 'add' when 'remove' then 'remove' else 'change' end,
             new.vehicle_number),
      jsonb_build_object('role','admin','view','vehicle-management','id', new.id::text),
      'vehicle_change_requests', new.id
    );

  elsif tg_op = 'UPDATE'
    and new.status is distinct from old.status
    and new.status in ('approved','rejected')
  then
    perform public.queue_notification(
      new.society_id, 'vehicle_request.reviewed',
      array[new.requested_by],
      case new.status when 'approved' then 'Vehicle request approved'
                      else 'Vehicle request declined' end,
      format('Your request for %s was %s.%s', new.vehicle_number, new.status,
             case when nullif(new.notes,'') is not null then ' ' || new.notes else '' end),
      jsonb_build_object('role','resident','view','vehicles','id', new.id::text),
      'vehicle_change_requests', new.id
    );
  end if;

  return null;
end
$$;

drop trigger if exists trg_notify_vehicle_change_request on public.vehicle_change_requests;
create trigger trg_notify_vehicle_change_request
  after insert or update on public.vehicle_change_requests
  for each row execute function public.notify_vehicle_change_request();


-- A resident books an amenity, and the committee answers.
create or replace function public.notify_amenity_booking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _amenity text;
  _flat text := coalesce(nullif(new.wing,'') || '-', '') || new.flat_number;
begin
  select name into _amenity from public.amenities where id = new.amenity_id;
  _amenity := coalesce(_amenity, 'an amenity');

  if tg_op = 'INSERT' and new.status::text = 'pending_approval' then
    perform public.queue_notification(
      new.society_id, 'amenity_booking.created',
      public.notify_admins(new.society_id),
      'Amenity booking needs approval',
      format('%s requested %s on %s, %s to %s.', _flat, _amenity,
             to_char(new.booking_date, 'DD Mon'),
             to_char(new.start_time::time, 'HH12:MI am'),
             to_char(new.end_time::time, 'HH12:MI am')),
      jsonb_build_object('role','admin','view','amenity-management','id', new.id::text),
      'amenity_bookings', new.id
    );

  elsif tg_op = 'UPDATE'
    and new.status is distinct from old.status
    and new.status::text in ('approved','rejected','cancelled')
  then
    perform public.queue_notification(
      new.society_id, 'amenity_booking.reviewed',
      array[new.booked_by],
      case new.status::text
        when 'approved'  then 'Booking confirmed'
        when 'rejected'  then 'Booking declined'
        else 'Booking cancelled' end,
      format('%s on %s: %s.%s', _amenity, to_char(new.booking_date, 'DD Mon'),
             new.status::text,
             case when nullif(new.rejection_reason,'') is not null
                  then ' ' || new.rejection_reason else '' end),
      jsonb_build_object('role','resident','view','amenities','id', new.id::text),
      'amenity_bookings', new.id
    );
  end if;

  return null;
end
$$;

drop trigger if exists trg_notify_amenity_booking on public.amenity_bookings;
create trigger trg_notify_amenity_booking
  after insert or update on public.amenity_bookings
  for each row execute function public.notify_amenity_booking();


-- ── ADMIN → RESIDENT ─────────────────────────

-- A maintenance bill is issued, or falls overdue.
--
-- This is the event that justified the outbox: generating a quarter's
-- bills inserts one row per flat in a single statement.
create or replace function public.notify_maintenance_bill()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _flat text := coalesce(nullif(new.wing,'') || '-', '') || new.flat_number;
begin
  if tg_op = 'INSERT' then
    perform public.queue_notification(
      new.society_id, 'bill.issued',
      public.notify_flat(new.society_id, nullif(new.wing,''), new.flat_number),
      'New maintenance bill',
      format('%s is due by %s for %s.',
             '₹' || to_char(new.total_amount, 'FM999,999,990.00'),
             to_char(new.due_date, 'DD Mon'), _flat),
      jsonb_build_object('role','resident','view','dues','id', new.id::text),
      'maintenance_bills', new.id
    );

  elsif tg_op = 'UPDATE'
    and new.status is distinct from old.status
    and new.status::text = 'overdue'
  then
    perform public.queue_notification(
      new.society_id, 'bill.overdue',
      public.notify_flat(new.society_id, nullif(new.wing,''), new.flat_number),
      'Maintenance bill overdue',
      format('%s was due on %s and is still unpaid.',
             '₹' || to_char(new.total_amount - coalesce(new.amount_paid, 0),
                            'FM999,999,990.00'),
             to_char(new.due_date, 'DD Mon')),
      jsonb_build_object('role','resident','view','dues','id', new.id::text),
      'maintenance_bills', new.id
    );
  end if;

  return null;
end
$$;

drop trigger if exists trg_notify_maintenance_bill on public.maintenance_bills;
create trigger trg_notify_maintenance_bill
  after insert or update on public.maintenance_bills
  for each row execute function public.notify_maintenance_bill();


-- A payment is recorded against a bill. Receipt-style confirmation to
-- the flat, which comes from the bill — the payment row carries no
-- wing or flat of its own.
create or replace function public.notify_maintenance_payment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _wing text;
  _flat text;
begin
  select nullif(wing,''), flat_number into _wing, _flat
    from public.maintenance_bills where id = new.bill_id;

  if _flat is null then
    return null;
  end if;

  perform public.queue_notification(
    new.society_id, 'payment.recorded',
    public.notify_flat(new.society_id, _wing, _flat),
    'Payment recorded',
    format('%s received by %s. Thank you.',
           '₹' || to_char(new.amount, 'FM999,999,990.00'),
           replace(new.payment_method::text, '_', ' ')),
    jsonb_build_object('role','resident','view','dues','id', new.bill_id::text),
    'maintenance_payments', new.id
  );

  return null;
end
$$;

drop trigger if exists trg_notify_maintenance_payment on public.maintenance_payments;
create trigger trg_notify_maintenance_payment
  after insert on public.maintenance_payments
  for each row execute function public.notify_maintenance_payment();


-- ── GATE → RESIDENT, and the reply back ──────

-- Somebody is at the gate asking for a flat.
--
-- Inserted by the submit-visitor-request Edge Function, which runs
-- with the service role — so auth.uid() is NULL here and nobody is
-- excluded as the actor. That is correct: the visitor is not a user.
create or replace function public.notify_visitor_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    perform public.queue_notification(
      new.society_id, 'visitor.at_gate',
      -- visitor_requests has no wing column, so match on flat alone.
      public.notify_flat(new.society_id, null, new.flat_number),
      'Visitor at the gate',
      format('%s is here to see flat %s.%s', new.visitor_name, new.flat_number,
             case when nullif(new.purpose,'') is not null
                  then ' ' || new.purpose else '' end),
      jsonb_build_object('role','resident','view','home','id', new.id::text),
      'visitor_requests', new.id
    );

  elsif tg_op = 'UPDATE'
    and new.status is distinct from old.status
    and new.status in ('approved','rejected')
  then
    -- RESIDENT → GUARD. The guard is standing at the gate waiting for
    -- exactly this answer, which makes it the most time-critical
    -- notification in the system.
    perform public.queue_notification(
      new.society_id, 'visitor.reviewed',
      public.notify_guards(new.society_id),
      case new.status when 'approved' then 'Visitor approved' else 'Visitor denied' end,
      format('Flat %s %s %s.', new.flat_number,
             case new.status when 'approved' then 'approved' else 'denied' end,
             new.visitor_name),
      jsonb_build_object('role','guard','view','approvals','id', new.id::text),
      'visitor_requests', new.id
    );
  end if;

  return null;
end
$$;

drop trigger if exists trg_notify_visitor_request on public.visitor_requests;
create trigger trg_notify_visitor_request
  after insert or update on public.visitor_requests
  for each row execute function public.notify_visitor_request();


-- A delivery agent is at the gate, and the resident answers.
create or replace function public.notify_delivery_visit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _flat text := coalesce(nullif(new.wing,'') || '-', '') || new.flat_number;
  _who  text := coalesce(nullif(new.agent_name,''),
                         initcap(replace(new.delivery_type, '_', ' ')));
begin
  if tg_op = 'INSERT' and new.status::text = 'pending_approval' then
    perform public.queue_notification(
      new.society_id, 'delivery.at_gate',
      public.notify_flat(new.society_id, nullif(new.wing,''), new.flat_number),
      'Delivery at the gate',
      format('%s has a delivery for %s. Approve it or have it held at the gate.',
             _who, _flat),
      jsonb_build_object('role','resident','view','deliveries','id', new.id::text),
      'delivery_visits', new.id
    );

  elsif tg_op = 'UPDATE'
    and new.status is distinct from old.status
    and new.status::text in ('approved','rejected')
  then
    -- RESIDENT → GUARD. Sent to the guard who logged it where that is
    -- recorded, so the person actually holding the parcel is told
    -- rather than every guard in the society; falls back to all of
    -- them when guard_id is null.
    perform public.queue_notification(
      new.society_id, 'delivery.reviewed',
      case when new.guard_id is not null then array[new.guard_id]
           else public.notify_guards(new.society_id) end,
      case new.status::text when 'approved' then 'Delivery approved'
                            else 'Delivery refused' end,
      format('%s for %s: %s.%s', _who, _flat, new.status::text,
             case when nullif(new.rejection_note,'') is not null
                  then ' ' || new.rejection_note else '' end),
      jsonb_build_object('role','guard','view','delivery','id', new.id::text),
      'delivery_visits', new.id
    );
  end if;

  return null;
end
$$;

drop trigger if exists trg_notify_delivery_visit on public.delivery_visits;
create trigger trg_notify_delivery_visit
  after insert or update on public.delivery_visits
  for each row execute function public.notify_delivery_visit();


-- A house help arrives or leaves.
--
-- Recipients come from house_help_flats.resident_id, which names the
-- residents who employ that help directly — no flat-number matching
-- needed, and a help who works in four flats notifies four families.
create or replace function public.notify_house_help_attendance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _name text;
  _recipients uuid[];
begin
  if new.category::text <> 'house_help' then
    return null;
  end if;

  select name into _name from public.house_helps where id = new.staff_id;
  if _name is null then
    return null;
  end if;

  select coalesce(array_agg(distinct hhf.resident_id), '{}'::uuid[])
    into _recipients
    from public.house_help_flats hhf
   where hhf.house_help_id = new.staff_id;

  perform public.queue_notification(
    new.society_id, 'house_help.' || new.action_type,
    _recipients,
    case new.action_type when 'entry' then 'House help arrived'
                         else 'House help left' end,
    format('%s %s at %s.', _name,
           case new.action_type when 'entry' then 'entered' else 'left' end,
           -- "timestamp" is quoted because it is also a type name.
           to_char(new."timestamp", 'HH12:MI am')),
    jsonb_build_object('role','resident','view','helps','id', new.staff_id::text),
    'staff_logs', new.id
  );

  return null;
end
$$;

drop trigger if exists trg_notify_house_help_attendance on public.staff_logs;
create trigger trg_notify_house_help_attendance
  after insert on public.staff_logs
  for each row execute function public.notify_house_help_attendance();


-- ── GUARD → ADMIN ────────────────────────────

-- A vehicle that is not on the society's register came through the
-- gate.
--
-- The one genuinely guard-to-admin event in this data model, and a
-- useful one: the guard is doing nothing wrong by logging it, but it is
-- exactly what a committee wants to see. Matched on a normalised
-- vehicle number, the same way the guard's own search works, so
-- "MH 12 AB 1234" and "MH12AB1234" are one vehicle.
create or replace function public.notify_unregistered_entry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.vehicles v
     where v.society_id = new.society_id
       and upper(replace(v.vehicle_number, ' ', '')) =
           upper(replace(new.vehicle_number, ' ', ''))
  ) then
    return null;
  end if;

  perform public.queue_notification(
    new.society_id, 'gate.unregistered_vehicle',
    public.notify_admins(new.society_id),
    'Unregistered vehicle at the gate',
    format('%s entered for %s and is not on the register.',
           new.vehicle_number,
           coalesce(nullif(new.wing,'') || '-', '') || new.flat_number),
    jsonb_build_object('role','admin','view','vehicle-management','id', new.id::text),
    'entry_logs', new.id
  );

  return null;
end
$$;

drop trigger if exists trg_notify_unregistered_entry on public.entry_logs;
create trigger trg_notify_unregistered_entry
  after insert on public.entry_logs
  for each row execute function public.notify_unregistered_entry();


-- ── ADMIN → GUARD ────────────────────────────

-- A boom barrier was switched on or off. The guard is the person who
-- will discover the gate behaving differently, so they are the person
-- who should be told that somebody meant it.
create or replace function public.notify_barrier_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_active is not distinct from old.is_active then
    return null;
  end if;

  perform public.queue_notification(
    new.society_id, 'barrier.state_changed',
    public.notify_guards(new.society_id),
    case when new.is_active then 'Barrier enabled' else 'Barrier disabled' end,
    format('%s at %s was %s.',
           coalesce(nullif(new.name,''), 'A boom barrier'),
           coalesce(nullif(new.location,''), 'the gate'),
           case when new.is_active then 'switched on' else 'switched off' end),
    jsonb_build_object('role','guard','view','barriers','id', new.id::text),
    'barrier_devices', new.id
  );

  return null;
end
$$;

drop trigger if exists trg_notify_barrier_state on public.barrier_devices;
create trigger trg_notify_barrier_state
  after update on public.barrier_devices
  for each row execute function public.notify_barrier_state();


-- A new staff member or house help now has a gate QR code. The guard
-- scans these, so a guard who has not been told will turn somebody
-- away.
--
-- ONE function for TWO tables, which is why the role is read through
-- to_jsonb(new) rather than new.staff_type / new.help_type: NEW is a
-- record, and naming a field that the firing table does not have is a
-- runtime error even inside a CASE branch that is not taken.
--
-- This is the noisiest event here — a bulk staff import fires it per
-- person — which is what notification_preferences is for:
--
--   insert into public.notification_preferences (society_id, event_key, enabled)
--   values ('<society-id>', 'staff.qr_issued', false)
--   on conflict (society_id, event_key) do update set enabled = false;
create or replace function public.notify_staff_qr_issued()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _row  jsonb := to_jsonb(new);
  _kind text := case tg_table_name when 'house_helps' then 'House help'
                                   else 'Staff member' end;
  _role text := coalesce(
                  nullif(_row ->> 'help_type', ''),
                  nullif(_row ->> 'staff_type', ''),
                  'staff');
begin
  if (_row ->> 'is_active') is distinct from 'true' then
    return null;
  end if;

  perform public.queue_notification(
    new.society_id, 'staff.qr_issued',
    public.notify_guards(new.society_id),
    _kind || ' added',
    format('%s (%s) now has a gate QR code.', new.name, replace(_role, '_', ' ')),
    jsonb_build_object('role','guard','view','scan','id', new.id::text),
    tg_table_name, new.id
  );

  return null;
end
$$;

drop trigger if exists trg_notify_staff_qr_issued on public.staff_members;
create trigger trg_notify_staff_qr_issued
  after insert on public.staff_members
  for each row execute function public.notify_staff_qr_issued();

drop trigger if exists trg_notify_help_qr_issued on public.house_helps;
create trigger trg_notify_help_qr_issued
  after insert on public.house_helps
  for each row execute function public.notify_staff_qr_issued();


-- ── EV CHARGING (resident ↔ committee) ───────
--
--    The function is created unconditionally: a plpgsql body is not
--    name-resolved until it runs, so this is valid even with no
--    ev_sessions table. Only the TRIGGER needs the table to exist,
--    hence the guard below it. Everything above works without EV.
create or replace function public.notify_ev_session()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _recipients uuid[];
begin
  if new.status is not distinct from old.status then
    return null;
  end if;

  if new.status = 'awaiting_approval' then
    -- RESIDENT → COMMITTEE. Guards are included because a guard is
    -- usually the person on site who can confirm a UPI payment.
    _recipients := public.notify_admins(new.society_id)
                   || public.notify_guards(new.society_id);
    perform public.queue_notification(
      new.society_id, 'ev_session.awaiting_approval', _recipients,
      'EV payment to confirm',
      format('%s paid %s and is waiting for the charger to start.',
             coalesce(nullif(new.resident_label,''), 'A resident'),
             '₹' || to_char(coalesce(new.amount_paid, 0), 'FM999,990.00')),
      jsonb_build_object('role','admin','view','ev-charging','id', new.id::text),
      'ev_sessions', new.id
    );

  elsif new.status in ('authorized','charging','completed','failed')
    and new.user_id is not null
  then
    -- COMMITTEE → RESIDENT.
    perform public.queue_notification(
      new.society_id, 'ev_session.' || new.status, array[new.user_id],
      case new.status
        when 'authorized' then 'Charger unlocked'
        when 'charging'   then 'Charging started'
        when 'completed'  then 'Charging finished'
        else 'Charging failed' end,
      case new.status
        -- trim_scale, because kwh_consumed is numeric(10,3) and reads
        -- as "14.500 kWh used" otherwise. to_char cannot fix that: a
        -- '9' after the decimal point prints a zero rather than
        -- dropping it, so the scale has to go before formatting.
        when 'completed' then format('%s kWh used, %s.',
                                trim_scale(coalesce(new.kwh_consumed, 0)),
                                '₹' || to_char(coalesce(new.cost, 0), 'FM999,990.00'))
        when 'failed'    then coalesce(nullif(new.stop_reason,''),
                                       'The session could not be completed.')
        else 'Plug in your vehicle to begin.' end,
      jsonb_build_object('role','resident','view','ev','id', new.id::text),
      'ev_sessions', new.id
    );
  end if;

  return null;
end
$$;

do $$
begin
  if to_regclass('public.ev_sessions') is null then
    raise notice 'push: ev_sessions does not exist, so EV notifications are not active. Run ev_charging.sql, then re-run this file.';
  else
    execute 'drop trigger if exists trg_notify_ev_session on public.ev_sessions';
    execute 'create trigger trg_notify_ev_session
               after update on public.ev_sessions
               for each row execute function public.notify_ev_session()';
  end if;
end
$$;

revoke all on function public.notify_ev_session() from public, anon, authenticated;


-- ─────────────────────────────────────────────
-- 8. A HEALTH CHECK
--
--    Run this after setup, and whenever somebody says notifications
--    stopped. Every line is something that has actually gone wrong in
--    a push setup before.
-- ─────────────────────────────────────────────
create or replace function public.notification_health()
returns table (check_name text, status text, detail text)
language sql
stable
security definer
set search_path = public
as $$
  select 'service role key'::text,
         case when public.notification_service_key() is not null
              then 'ok' else 'MISSING' end,
         'Needed by Postgres to call the Edge Function. See section 9.'
  union all
  select 'pg_net',
         case when exists (select 1 from pg_extension where extname = 'pg_net')
              then 'ok' else 'MISSING' end,
         'Provides net.http_post. Enable under Database -> Extensions.'
  union all
  select 'registered devices',
         case when (select count(*) from public.device_push_tokens) > 0
              then 'ok' else 'none yet' end,
         (select count(*)::text || ' device token(s). Zero means nobody has '
                || 'opened the Android app and allowed notifications yet.'
            from public.device_push_tokens)
  union all
  select 'pending notifications',
         case when (select count(*) from public.notification_events
                     where dispatched_at is null) = 0
              then 'ok' else 'BACKLOG' end,
         (select count(*)::text || ' undispatched'
            from public.notification_events where dispatched_at is null)
  union all
  select 'queued in last 24h', 'info',
         (select count(*)::text || ' event(s)'
            from public.notification_events
           where created_at > now() - interval '24 hours')
  union all
  select 'last error', 'info',
         coalesce((select left(error, 200) from public.notification_events
                    where error is not null
                    order by created_at desc limit 1),
                  'none recorded')
$$;

revoke all on function public.notification_health() from public, anon, authenticated;


-- ─────────────────────────────────────────────
-- 9. SETUP — two secrets, neither of them in this file
--
--    (a) THE SERVICE ROLE KEY, so Postgres may call the function.
--        Supabase dashboard -> Settings -> API -> service_role.
--        Then ONE of these:
--
--          select vault.create_secret('<service-role-key>', 'service_role_key');
--
--        or, if Vault is not available on your project:
--
--          alter database postgres
--            set app.settings.service_role_key = '<service-role-key>';
--
--        To rotate later: vault.update_secret(id, '<new key>'), or just
--        run the alter again. Nothing in this file needs editing.
--
--    (b) THE FIREBASE SERVICE ACCOUNT, so the function may call FCM.
--        Firebase console -> Project settings -> Service accounts ->
--        Generate new private key. Add the whole JSON file as an Edge
--        Function secret named FCM_SERVICE_ACCOUNT_JSON.
--
--    Then check both:
--
--      select * from public.notification_health();
--
--    And send yourself one. Run this in the SQL editor, which connects
--    as postgres — queue_notification's EXECUTE is revoked from
--    ordinary users on purpose (section 6), so this will not work from
--    the app, which is the point:
--
--      select public.queue_notification(
--        (select society_id from public.profiles
--          where user_id = '<your-user-id>'),
--        'test.manual',
--        array['<your-user-id>'::uuid],
--        'It works',
--        'Push notifications are wired up.',
--        '{"role":"admin","view":"home"}'::jsonb);
--
--    Your phone should buzz within a second or two. If it does not,
--    run the health check, then look at the row:
--
--      select title, dispatched_at, sent_count, failed_count, error
--        from public.notification_events order by created_at desc limit 5;
--
--    dispatched_at NULL   -> Postgres never reached the function (key,
--                            pg_net, or the function is not deployed)
--    sent_count 0         -> no device tokens for those recipients
--    failed_count > 0     -> FCM refused; `error` says why
-- ─────────────────────────────────────────────

notify pgrst, 'reload schema';
