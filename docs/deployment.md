# Sticky Deployment Runbook

This runbook is for deploying Sticky to `sticky.yuvrajkashyap.com`.

## Current Readiness Snapshot

- Local app: Next.js App Router with Supabase SSR/browser clients.
- Database schema: `sticky`.
- Live Supabase project ref used by this build: `sqskfdcwfwywjoobbpos`.
- Live Supabase project name observed during verification: `yk-platform`.
- Live Supabase health observed during verification: `ACTIVE_HEALTHY` in
  `us-east-2` on PostgreSQL `17.6.1.104`.
- Vercel CLI account observed in this environment: `yuvrajkashyap`.
- Vercel project: `yuvraj-kashyaps-projects/sticky`.
- Vercel project ID: `prj_nfiyWrEfak04ah1pIqvFqcytQcmh`.
- Local Vercel link status: `.vercel/project.json` exists and is ignored.
- Local git status: repository initialized on branch `main`; no remote is
  configured yet.
- Latest production deployment: `dpl_HbDTw3rxF7tL8MdK7QbtfQ4SSof3`.
- Public production URL:
  `https://sticky-f0fo4sjnz-yuvraj-kashyaps-projects.vercel.app`.
- Production aliases observed:
  `https://sticky-green.vercel.app`,
  `https://sticky.yuvrajkashyap.com`,
  `https://sticky-yuvraj-kashyaps-projects.vercel.app`, and
  `https://sticky-yuvrajkashyap-yuvraj-kashyaps-projects.vercel.app`.
- Vercel Authentication / Deployment Protection is disabled for this project
  (`ssoProtection: null`) so generated production URLs can be smoke-tested.
- Target domain `sticky.yuvrajkashyap.com` appears in the latest deployment's
  alias list and `vercel domains inspect sticky.yuvrajkashyap.com` finds it
  under `yuvraj-kashyaps-projects/sticky`. DNS is still not resolving because
  Porkbun needs the Vercel-provided A record.
- Owner access: `sticky.allowed_emails` contains one active owner row, verified
  after adding update tracking to the allowlist table.
- Recurrence: model, RLS, UI controls, schedule summaries, completion-driven
  next occurrence generation, user-controlled overdue catch-up, and a protected
  Vercel Cron catch-up route are shipped. Production cron activation still needs
  the server-only Supabase secret in Vercel.
- Preferences: completed pile state, density, color mode, task view filter
  including Today, and task sort mode are persisted in
  `sticky.user_preferences`.
- Supabase Auth URL configuration still needs to be applied in the Supabase
  dashboard or with a Management API token. This shell does not have
  `SUPABASE_ACCESS_TOKEN`, and Chrome dashboard automation is unavailable
  because Chrome is not running and the Codex Chrome Extension is not installed
  in the selected Chrome profile.

`AGENTS.md` names the shared Supabase project as `yk-portfolio`; the verified
project ref above is the value currently used by `.env.example` and the applied
database migrations. Treat the project ref and Supabase dashboard as the source
of truth before production launch.

## Required Environment Variables

Set these for Vercel production, preview, and development unless a narrower
environment is intentional:

```text
NEXT_PUBLIC_SUPABASE_URL=https://sqskfdcwfwywjoobbpos.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable-key-from-supabase-api-settings>
NEXT_PUBLIC_STICKY_DEMO_MODE=false
NEXT_PUBLIC_SITE_URL=https://sticky.yuvrajkashyap.com
SUPABASE_SECRET_KEY=<server-only-supabase-secret-key>
CRON_SECRET=<random-server-only-cron-secret>
```

`NEXT_PUBLIC_SITE_URL` should be set when the custom domain resolves and the
Supabase Auth URL configuration includes its `/auth/callback` URL. Until then,
leaving it unset lets the auth client use the current verified Vercel origin for
generated production URL smoke tests. Vercel preview deployments may also use
`NEXT_PUBLIC_VERCEL_URL` if it is available for the preview host.

Do not add service-role or secret keys with a `NEXT_PUBLIC_` prefix. Use
`SUPABASE_SECRET_KEY` for the scheduled worker; the code also supports the
legacy `SUPABASE_SERVICE_ROLE_KEY` name as a fallback.

Current Vercel env state observed with `vercel env ls` on 2026-06-13:

- Production: the three core runtime variables are set; `NEXT_PUBLIC_SITE_URL`
  should be added after DNS and Supabase Auth URL configuration are complete.
  `CRON_SECRET` is set. `SUPABASE_SECRET_KEY` still needs to be added before the
  automated recurrence worker can mutate production data.
- Supabase API settings expose an enabled modern publishable key for the
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` value; `.env.example` intentionally
  keeps a placeholder.
- Development: the three core runtime variables are set.
- Preview: not set because the project has no connected Git repository yet; the
  local repo has not been connected to a remote/Vercel Git integration yet, and
  the Vercel CLI requires a connected Git branch for preview-scoped env vars in
  this state.

## Supabase Production Checks

Latest live verification on 2026-06-13 against project
`sqskfdcwfwywjoobbpos`:

- Supabase project metadata returned project name `yk-platform`, project health
  `ACTIVE_HEALTHY`, region `us-east-2`, and PostgreSQL `17.6.1.104`.
- Supabase security advisors were re-run after
  `20260613045652_sticky_add_today_task_view.sql`. The only Sticky-owned
  table advisor notice was `rls_enabled_no_policy` for
  `sticky.allowed_emails`, which is intentional because the allowlist is
  service-role-only and has no public policies.
- A rolled-back live RLS simulation created disposable Auth users, Sticky users,
  list/task/subtask rows, user state, and preferences, then switched to the
  `authenticated` role with different JWT subjects. User A could read one of
  each own row and update one own task; User B saw zero User A rows and updated
  zero User A tasks. A follow-up cleanup query confirmed zero disposable rows
  remained after rollback.
- Anonymous access checks confirmed `anon` has no `sticky` schema usage and no
  `select` privilege on `sticky.lists`, `sticky.tasks`, `sticky.subtasks`,
  `sticky.user_state`, or `sticky.user_preferences`.
- Sticky-only table checks confirmed RLS is enabled on
  `allowed_emails`, `lists`, `subtasks`, `task_activity`,
  `task_recurrence_rules`, `tasks`, `user_preferences`, `user_state`, and
  `users`.
- Compact schema checks confirmed 9 Sticky tables, 24 Sticky policies, no
  Sticky views, no Sticky table grants to `anon`, no Sticky routines executable
  by `anon`, one active allowlist row, and zero runtime user-data rows at the
  time of verification.
- Sticky-only grant checks confirmed `sticky.allowed_emails` has no `anon` or
  `authenticated` grants or policies; runtime tables have authenticated
  owner-scoped access; audit rows are authenticated-read and
  service-role-written; `sticky.users` is authenticated-read and
  service-role-written.
- Sticky routine checks confirmed no Sticky routine is executable by `anon`,
  all Sticky functions have pinned search paths, and
  `sticky.advance_recurring_task_for_worker(...)` is executable by
  `service_role` only.
- Live migration history matched the local `supabase/migrations/` filenames
  observed on 2026-06-13, including the aligned initial schema, advisor, Data
  API, atomic workspace, recurrence, preference, and Today-view migrations.
- Sticky foreign-key checks confirmed all Sticky-owned foreign keys have
  covering indexes, including task/list/subtask/activity/recurrence/user-state
  relationships.

1. Confirm the `sticky` schema exists and the migrations in `supabase/migrations/`
   have been applied in timestamp order. The live project currently records
   these Sticky migration versions:
   `20260612181552_sticky_initial_schema`,
   `20260612181915_sticky_advisor_fixes`,
   `20260612190607_sticky_recurrence_and_function_grants`,
   `20260612191604_sticky_expose_data_api_schema`,
   `20260612193259_sticky_atomic_workspace_functions`,
   `20260612231438_sticky_allowed_emails_updated_at`,
   `20260613004023_sticky_recurring_completion`,
   `20260613010533_sticky_recurring_catchup`,
   `20260613013059_sticky_recurring_cron_catchup`,
   `20260613041115_sticky_persist_view_preferences`, and
   `20260613045652_sticky_add_today_task_view`.
2. Confirm the Supabase Data API exposes the `sticky` schema.
3. Confirm RLS is enabled on Sticky-owned tables.
4. Confirm `sticky.allowed_emails` intentionally has no public policies.
5. Add or refresh the owner email if the allowlist needs to be reseeded:

```sql
insert into sticky.allowed_emails (email, role, is_active)
values ('<owner-email>', 'owner', true)
on conflict (email)
do update set
  role = excluded.role,
  is_active = excluded.is_active,
  updated_at = now();
```

6. In Supabase Auth URL configuration, set the site URL to:

```text
https://sticky.yuvrajkashyap.com
```

7. Add redirect URLs:

```text
http://localhost:3000/auth/callback
http://localhost:3100/auth/callback
https://sticky.yuvrajkashyap.com/auth/callback
https://sticky-f0fo4sjnz-yuvraj-kashyaps-projects.vercel.app/auth/callback
https://sticky-green.vercel.app/auth/callback
https://sticky-yuvraj-kashyaps-projects.vercel.app/auth/callback
```

After the first Vercel preview deploy, add that exact preview callback URL too,
for example `https://<preview-host>/auth/callback`. If you intentionally choose
a wildcard for Vercel previews, Supabase documents the pattern
`https://*-<team-or-account-slug>.vercel.app/**`; verify the pattern against the
actual preview host before relying on it.

The same settings can be applied through the Supabase Management API with a
token that has `auth_config_write` and `project_admin_write`:

```powershell
$redirects = @(
  "http://localhost:3000/auth/callback",
  "http://localhost:3100/auth/callback",
  "https://sticky.yuvrajkashyap.com/auth/callback",
  "https://sticky-f0fo4sjnz-yuvraj-kashyaps-projects.vercel.app/auth/callback",
  "https://sticky-green.vercel.app/auth/callback",
  "https://sticky-yuvraj-kashyaps-projects.vercel.app/auth/callback"
) -join ","

$body = @{
  site_url = "https://sticky.yuvrajkashyap.com"
  uri_allow_list = $redirects
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Patch `
  -Uri "https://api.supabase.com/v1/projects/sqskfdcwfwywjoobbpos/config/auth" `
  -Headers @{ Authorization = "Bearer $env:SUPABASE_ACCESS_TOKEN" } `
  -ContentType "application/json" `
  -Body $body
```

## Vercel Project Setup

From the repo root:

```powershell
vercel whoami
vercel project list
vercel link --yes --scope yuvraj-kashyaps-projects --project sticky
```

If the project ever needs to be recreated, create it before linking:

```powershell
vercel project add sticky --scope yuvraj-kashyaps-projects --non-interactive
vercel link --yes --scope yuvraj-kashyaps-projects --project sticky
```

The current project has already been created and linked.

## Vercel Env Setup

Use the dashboard or CLI. For CLI setup:

```powershell
vercel env add NEXT_PUBLIC_SUPABASE_URL production --value "https://sqskfdcwfwywjoobbpos.supabase.co" --yes
vercel env add NEXT_PUBLIC_STICKY_DEMO_MODE production --value "false" --yes
vercel env add NEXT_PUBLIC_SITE_URL production --value "https://sticky.yuvrajkashyap.com" --yes
vercel env add NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY production
vercel env add CRON_SECRET production
vercel env add SUPABASE_SECRET_KEY production
```

Repeat those variables for `preview` and `development`. Paste the publishable key
and secret key interactively, or use `--value` only if command history exposure
is acceptable for your shell. The publishable key is not a service-role secret,
but it is still better to avoid casual transcript churn. The Supabase secret key
must remain server-only and must not use a `NEXT_PUBLIC_` prefix.

The scheduled recurrence worker is invoked from:

```text
/api/recurrence/catch-up
```

Vercel sends `Authorization: Bearer $CRON_SECRET` to cron routes. If
`SUPABASE_SECRET_KEY` is missing, the authenticated route reports itself as
disabled and does not mutate data.

To pull Vercel env vars without overwriting local smoke-test settings:

```powershell
vercel env pull .env.vercel.local --environment=production --yes
```

## Local Release Gate

Run:

```powershell
npm install
npm run verify
```

`npm run verify` covers:

- TypeScript
- ESLint
- Next.js production build
- npm moderate audit
- Playwright desktop/mobile e2e smoke tests

## Preview Deploy

Preview env vars require a connected Git repository in the current Vercel
project state. The local repository now exists, but it still needs a remote and
Vercel Git integration before preview-scoped env vars can be attached to
branches. Connect the repo in Vercel first, then add preview env vars for all
preview branches or the intended branch.

Use a prebuilt deploy when you want local tests between build and upload:

```powershell
vercel pull --yes --environment=preview
vercel build
vercel deploy --prebuilt
```

Then verify the preview URL:

```powershell
$env:PLAYWRIGHT_BASE_URL = "https://<preview-url>"
npm run test:e2e
Remove-Item Env:\PLAYWRIGHT_BASE_URL
```

## Production Deploy

The production deployment was created with Vercel's remote build path:

```powershell
vercel --prod --yes
```

The prebuilt path below is still useful for CI, but on this Windows machine it
hit an `EPERM` symlink error while building `.vercel/output`; remote Vercel build
avoided that local filesystem issue.

```powershell
vercel pull --yes --environment=production
vercel build --prod
vercel deploy --prebuilt --prod
```

Alternatively, promote the already-verified preview deployment:

```powershell
vercel promote <preview-url-or-id>
```

## Domain Setup

Do not invent Porkbun DNS values. Add and inspect the domain through Vercel, then
copy the exact DNS instructions Vercel returns:

```powershell
vercel domains add sticky.yuvrajkashyap.com --scope yuvraj-kashyaps-projects
vercel domains inspect sticky.yuvrajkashyap.com --scope yuvraj-kashyaps-projects
```

Current Vercel instruction captured for Porkbun:

```text
A sticky.yuvrajkashyap.com 76.76.21.21
```

Current direct domain inspection finds `sticky.yuvrajkashyap.com` under the
active `yuvraj-kashyaps-projects` scope and attached to project `sticky`, but
warns that the domain is not configured properly. Apply the returned DNS record
in Porkbun, wait for propagation, then re-run:

```powershell
vercel domains inspect sticky.yuvrajkashyap.com --scope yuvraj-kashyaps-projects
```

Current DNS check result: `sticky.yuvrajkashyap.com` does not resolve yet.

## Post-Deploy Smoke

1. Visit `https://sticky.yuvrajkashyap.com`.
2. Sign in with an allowlisted owner email.
3. Confirm the workspace loads with Supabase-backed data, not demo mode.
4. Create, edit, reorder, complete, restore, and delete a sticky.
5. Reload and confirm data persists.
6. Confirm `/robots.txt` disallows crawling until the app is intentionally public.
7. Confirm `/api/recurrence/catch-up` returns `401` or `503` without cron
   credentials, and returns a JSON worker result when called with
   `Authorization: Bearer $CRON_SECRET`.
8. Check Vercel build/runtime logs for errors.

Latest smoke evidence:

- Local `npm.cmd run verify` passed on 2026-06-14 after completed-pile
  disclosure accessibility polish: typecheck, lint, production build, moderate
  audit with zero vulnerabilities, and Playwright `18 passed, 10 skipped`.
- Local production preview at `http://localhost:3100` passed desktop and mobile
  Chrome Playwright smoke with no console/page errors, no horizontal overflow,
  and the completed pile toggle exposing `aria-expanded` plus the controlled
  `completed-stickies-list` region.
- Local `npm.cmd run verify` passed on 2026-06-14 after list-switch action-name
  accessibility polish: typecheck, lint, production build, moderate audit with
  zero vulnerabilities, and Playwright `18 passed, 10 skipped`.
- Local production preview at `http://localhost:3100` passed desktop and mobile
  Chrome Playwright smoke with no console/page errors, no horizontal overflow,
  and rendered list-switch buttons named with their list, active count,
  completed count, and current-list state.
- Local `npm.cmd run verify` passed on 2026-06-14 after subtask row action-name
  accessibility polish: typecheck, lint, production build, moderate audit with
  zero vulnerabilities, and Playwright `18 passed, 10 skipped`.
- Local production preview at `http://localhost:3100` passed desktop and mobile
  Chrome Playwright smoke with no console/page errors, no horizontal overflow,
  and desktop verification that subtask complete/restore, reorder, and delete
  actions include the current subtask title in their accessible names.
- Local `npm.cmd run verify` passed on 2026-06-14 after due-remove control
  polish: typecheck, lint, production build, moderate audit with zero
  vulnerabilities, and Playwright `18 passed, 10 skipped`.
- Local production preview at `http://localhost:3100` passed desktop and mobile
  Chrome Playwright smoke with no console/page errors, no horizontal overflow,
  and the `Remove due date and time` action disabled until a sticky has a
  schedule to clear.
- Local `npm.cmd run verify` passed on 2026-06-14 after due-time disabled-state
  accessibility polish: typecheck, lint, production build, moderate audit with
  zero vulnerabilities, and Playwright `18 passed, 10 skipped`.
- Local production preview at `http://localhost:3100` passed desktop and mobile
  Chrome Playwright smoke with no console/page errors, no horizontal overflow,
  and the due-time field correctly describing why it is disabled until a due
  date is selected.
- Local `npm.cmd run verify` passed on 2026-06-14 after recurrence/subtask
  disabled-state accessibility polish: typecheck, lint, production build,
  moderate audit with zero vulnerabilities, and Playwright
  `18 passed, 10 skipped`.
- Local production preview at `http://localhost:3100` passed desktop and mobile
  Chrome Playwright smoke with no console/page errors, no horizontal overflow,
  and accessible disabled-state reasons for both directions of the
  recurrence/subtask restriction.
- Local `npm.cmd run verify` passed on 2026-06-14 after subtask add-form
  accessibility polish: typecheck, lint, production build, moderate audit with
  zero vulnerabilities, and Playwright `18 passed, 10 skipped`.
- Local production preview at `http://localhost:3100` passed desktop and mobile
  Chrome Playwright smoke with no console/page errors, no horizontal overflow,
  and the named `New subtask title` / `Add subtask` controls correctly disabled
  until text is entered before adding a visible subtask row.
- Local `npm.cmd run verify` passed after named toast/undo accessibility
  coverage, keyboard and mobile-safe list/subtask reorder coverage, dialog
  focus-return coverage, modal focus-trap and dialog-label polish,
  command-center focus restoration and accessibility polish, phone list-rail
  framing polish, natural-language capture coverage, sync-failure banner
  polish, migration filename alignment, deployment evidence refresh, social
  preview polish, and cron-route guardrail: typecheck, lint, production build,
  moderate audit with zero vulnerabilities, and Playwright
  `18 passed, 10 skipped`.
- Live Supabase migration `sticky_add_today_task_view` is recorded at version
  `20260613045652`, and the `sticky.user_preferences.task_view_filter` check
  constraint allows `today`.
- Live Supabase RLS simulation passed with disposable rows inside a rolled-back
  transaction: owner subject saw and updated own rows, a second authenticated
  subject saw/updated zero owner rows, and `anon` has no Sticky schema/table
  read privileges.
- `https://sticky-f0fo4sjnz-yuvraj-kashyaps-projects.vercel.app` returns HTTP
  `200` with the `Sticky` page title.
- `https://sticky-green.vercel.app` returns HTTP `200` with the `Sticky` page
  title.
- `vercel inspect https://sticky-green.vercel.app` reports production deployment
  `dpl_HbDTw3rxF7tL8MdK7QbtfQ4SSof3` as `Ready` with
  `sticky.yuvrajkashyap.com` in the alias list.
- Production-safe Playwright smoke passed against `https://sticky-green.vercel.app`:
  route chrome, auth callback errors/origin preservation, unauthenticated cron,
  and generated social previews reported `9 passed, 1 skipped`.
- `https://sticky-green.vercel.app/?auth_error=Magic%20link%20expired` returns
  HTTP `200`, renders the signed-out auth shell, and shows the callback error.
- `https://sticky-green.vercel.app/auth/callback?error_description=Provider%20denied`
  redirects to `https://sticky-green.vercel.app/?auth_error=Provider+denied`,
  preserving the stable alias origin.
- `/robots.txt` returns HTTP `200` with `Disallow: /`.
- Chrome-channel Playwright smoke passed against `https://sticky-green.vercel.app`
  in desktop and mobile viewports with no console errors and no horizontal
  overflow.
- `/api/recurrence/catch-up` returns HTTP `401` without the cron bearer token.
- `/api/recurrence/catch-up` returns HTTP `200` with a valid cron bearer token
  and reports `disabled: true` until `SUPABASE_SECRET_KEY` is configured.
- Deployment error logs for `dpl_HbDTw3rxF7tL8MdK7QbtfQ4SSof3` returned no
  records in the last 30 minutes.
