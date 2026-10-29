# Hand-run schema files

Everything in this folder is run **by hand**, in the Supabase SQL editor.
Nothing in the repository, and nothing in CI, applies them.

That is worth stating plainly because it is not how `supabase/migrations/`
works. Migrations are tracked: Supabase records which have run, and
`supabase db push` applies the rest. These files are not tracked by
anything, so the only record that a file has been applied is the database
itself. `supabase/migrations/` stops at **2026-07-06**; every schema
change since then lives here.

Each file is guarded (`if not exists`, `create or replace`,
`drop policy if exists`) and is safe to re-run. When in doubt, re-run it
— that is cheaper than guessing.

## Run order

Order matters where a file builds on an earlier one. Within a group the
order is free; between groups it is not.

| # | File | Depends on | What it does |
|---|---|---|---|
| 1 | `society_visibility.sql` | — | Stops `anon` listing every society; adds `society_public()` |
| 2 | `manager_role.sql` | — | Adds the `manager` role and its grants |
| 3 | `registration_lockdown.sql` | — | Removes `WITH CHECK (true)` from `registration_requests` |
| 4 | `registration_public_close.sql` | **3** | Closes the last anon door; stops a manager creating an admin |
| 5 | `staff_profiles_biometrics.sql` | — | Staff/house-help profile fields; fingerprint templates |
| 6 | `biometric_terminals.sql` | **5** | eSSL/ZKTeco push terminals; `device_punches` |
| 7 | `device_pin_on_staff.sql` | **6** | Moves the device PIN onto the person's record |
| 8 | `ev_charging.sql` | — | EV chargers, sessions, UPI payment matching |
| 9 | `device_push_tokens.sql` | — | One row per device that can receive push |
| 10 | `push_notifications.sql` | **9**, and 8 for the EV events | The outbox, the recipient rules, and 12 triggers covering 21 event types |

`registration_public_close.sql` **fixes a privilege escalation shipped by
`registration_lockdown.sql`**. If 3 has been run and 4 has not, a manager
can create an admin account and read its temporary password. Check that
one first.

## Which of these have actually been run?

Paste this into the SQL editor. It reports one row per file.

```sql
with checks(ord, item, present) as (
  values
    (1, 'society_visibility.sql',
        to_regprocedure('public.society_public(text,uuid)') is not null),
    (2, 'manager_role.sql',
        to_regprocedure('public.is_manager(uuid)') is not null),
    (3, 'registration lockdown + public_close (3 then 4)',
        to_regprocedure('public.has_role_text(uuid,text)') is not null
        and to_regprocedure('public.is_committee(uuid)') is null
        and not exists (select 1 from pg_policies
                         where schemaname = 'public'
                           and tablename  = 'registration_requests'
                           and policyname = 'Anyone can submit registration request')),
    (5, 'staff_profiles_biometrics.sql',
        to_regclass('public.fingerprint_enrollments') is not null),
    (6, 'biometric_terminals.sql',
        to_regclass('public.biometric_devices') is not null),
    (7, 'device_pin_on_staff.sql',
        exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'staff_members'
                   and column_name = 'device_pin')),
    (8, 'ev_charging.sql',
        to_regclass('public.ev_sessions') is not null),
    (9, 'device_push_tokens.sql',
        to_regclass('public.device_push_tokens') is not null),
    (10, 'push_notifications.sql',
        to_regclass('public.notification_events') is not null
        and to_regprocedure('public.claim_notifications(integer)') is not null)
)
select ord, item, case when present then 'applied' else 'NOT APPLIED' end as status
  from checks order by ord;
```

Each test looks for an object the file creates and nothing else creates,
so a `NOT APPLIED` row means that file has genuinely not run. The reverse
is weaker: a file half-applied by an editor error would still report
`applied`, since the check cannot see which individual statements failed.
If a row looks wrong, re-run the file and read the editor's output.

**Files 3 and 4 are checked as one row, on purpose.** File 4 replaces
every object file 3 created — it drops `is_committee()`, replaces the
insert policy and replaces the trigger function — so once 4 has run there
is nothing left that distinguishes "3 then 4" from "4 alone", and nothing
that needs to. The row is also an *absence* test (`is_committee()` gone,
the old permissive policy gone) because those two files mainly remove
things. A `NOT APPLIED` here is the single most important result in the
table: it means either the public registration hole or the
manager-to-admin escalation is still open.

## Push notifications (files 9 and 10)

These two go together and need two secrets that are deliberately not in
the repository. `push_notifications.sql` section 9 has the exact steps;
in short:

1. The **service role key**, so Postgres may call the Edge Function —
   either `select vault.create_secret('<key>', 'service_role_key');` or
   `alter database postgres set app.settings.service_role_key = '<key>';`
2. The **Firebase service account JSON**, as an Edge Function secret
   named `FCM_SERVICE_ACCOUNT_JSON`.

Then `select * from public.notification_health();` reports whether both
are in place, how many devices are registered, and whether anything is
stuck.

Without either secret nothing breaks: messages queue in
`notification_events` and wait. A resident's booking never fails because
Firebase is down.

**iOS will not deliver** until an APNs key is uploaded to Firebase, which
needs a paid Apple Developer account. iOS devices still register and
their tokens are still stored, so nothing has to change here when that
account exists.

## Adding a new one

Prefer `supabase/migrations/` for anything new. These files are here
because they were written against a live database under time pressure,
not because hand-running SQL is the better pattern. A migration is
tracked, ordered, and applied by CI; a file in this folder is a note that
somebody has to remember to act on.
