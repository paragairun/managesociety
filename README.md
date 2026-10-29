# ManageSociety

Multi-tenant society management for Indian housing societies, live at
**[managesociety.in](https://managesociety.in)**.

One deployment serves many societies. Every table is scoped by
`society_id`, and a user belongs to exactly one society
(`profiles.user_id` is unique).

## Stack

React 18 + Vite + TypeScript, Tailwind and shadcn/ui, Supabase (Postgres,
Auth, Edge Functions, Realtime). The site is a static build deployed to
GitHub Pages from `.github/workflows/deploy.yml`; the custom domain comes
from `CNAME`.

## Roles

| Role | Signs in at | Gets |
|---|---|---|
| `resident` | `/resident` | Guest passes, deliveries, dues, amenities, vehicles, EV charging, house helps |
| `guard` | `/guard` | Scan & search, approvals, live-inside, boom barriers, deliveries |
| `admin` | `/admin` | Everything for one society |
| `manager` | `/admin` | An admin who cannot change members or other admins |
| `super_admin` | `/super-admin/login` | Approves new societies; belongs to none |

Who may do what is one table: **`src/lib/permissions.ts`**. Who may open
which route is **`src/lib/routeAccess.ts`**. Both are pure functions with
tests, and both are mirrored by RLS in Postgres — the client-side copy
decides what the UI offers, never what the database permits.

**Nobody registers themselves.** A society applies at `/register-society`
and a super admin reviews it; every account after that is created from
inside the admin panel. The public registration form is gone, and `anon`
has no insert on `registration_requests`.

## Layout

```
src/lib/          pure logic, unit-tested — permissions, route access,
                  society lookup, member onboarding, EV maths, imports
src/components/   feature components, shadcn primitives under ui/
src/pages/        one per route; the three dashboards use DashboardShell
supabase/functions/   edge functions (Deno)
supabase/migrations/  tracked migrations — stops at 2026-07-06
supabase/schema/      HAND-RUN SQL since then; read its README first
mobile-resident/  Capacitor shell → managesociety.in/resident
mobile-guard/     Capacitor shell → managesociety.in/guard
```

## Working on it

```bash
npm install
npm run dev     # vite dev server
npm test        # vitest — 387 tests
npm run lint
npx tsc -p tsconfig.app.json --noEmit
```

`npx tsc` currently reports errors, nearly all of them because
`src/integrations/supabase/types.ts` is generated and has not been
regenerated since the EV, fingerprint and push tables were added. Three
modules (`src/lib/evDb.ts`, `src/lib/societyLookup.ts`,
`src/hooks/usePushNotifications.ts`) carry a documented client cast to
work around it. Regenerating removes all of it:

```bash
npx supabase gen types typescript --project-id lfmwrdtzyuveyvkfbsjn \
  > src/integrations/supabase/types.ts
```

The deploy workflow does not gate on a full typecheck for that reason. It
gates on the one class that serves a blank page — a name that does not
resolve (TS2304/2552/2305/2307) — because `vite build` does not
type-check, so a component referencing an un-imported identifier ships
green and throws at first render.

## Deploying

Three independent pipelines. **Pushing to `main` does not deploy
everything.**

| What | How | Trigger |
|---|---|---|
| Website | `deploy.yml` → GitHub Pages | push to `main` |
| Edge functions | `deploy-edge-functions.yml` | push touching `supabase/functions/**` |
| Android `.aab` | `build-release-aabs.yml` | manual |
| iOS simulator build | `build-ios.yml` | manual / mobile paths |
| Database | **by hand**, in the SQL editor | nothing |

The database is the one with no automation at all. See
`supabase/schema/README.md` for what has to be run and a query that
reports which files are already applied.

## Mobile apps

Both are thin Capacitor WebView shells that load the live site, so
ordinary web changes reach users with no app update. Rebuild only when
the shell itself changes — icon, permissions, app name, the URL it opens.

Android versions are automatic: `versionCode` is minutes since
2024-01-01, so it always increases, and CI asserts the package id and
start URL before building. Package ids are permanent: `in.managesociety.resident`
and `in.managesociety.guard`.

iOS builds unsigned simulator apps only. The signed/TestFlight job is
written and commented out at the bottom of `build-ios.yml`, waiting on an
Apple Developer Program membership.

## Push notifications

Wired but inert. Tokens are collected into `device_push_tokens`, and
`send-push-notification` can deliver through FCM, but **nothing calls it**
— no trigger, no page, no function. Until something does, the Firebase
dependency in the Android apps buys nothing.
