# Sticky Release Checklist

Use this before calling a Sticky release ready.

## Local Gates

- `npm install` succeeds.
- `npm run verify` succeeds.
- `npm run security:check` confirms client-reachable code does not import
  server-only Supabase helpers or reference server-only Supabase/cron secrets.
- `git status --short --branch` has no unexpected changes, or the repo is
  intentionally not a git checkout.
- GitHub Actions `Verify Sticky` passes after the repo is connected to GitHub,
  or the release notes explicitly say CI is not connected yet.
- Local app opens at `http://localhost:3100` during Playwright verification.
- No browser console errors appear on the primary app route.

## Product Acceptance

- Sign-in path works, or demo mode is intentionally active for local smoke only.
- Access, sign-in, and workspace save error messages do not expose raw
  Supabase, schema, policy, table, or environment-variable implementation
  details.
- Create, rename, reorder, switch, and delete lists.
- Quick-add a sticky.
- Quick-add a sticky with smart schedule text such as `tomorrow 2pm`.
- Quick-add a sticky with weekday and word-time text such as `Friday noon` and
  confirm the schedule is parsed without polluting the saved title.
- Quick-add a sticky with a matching `#list-slug` token and confirm it lands in
  that list with the token removed.
- Edit title, details, color, list, due date, and due time.
- Use quick schedule chips for today, tomorrow, next week, and common times.
- Remove due date/time.
- Reorder active stickies.
- Move a sticky between lists.
- Duplicate a sticky, including details, due date/time, subtasks, and recurrence
  settings where valid.
- Pause and resume a repeating sticky without deleting its recurrence settings.
- Add, edit, reorder, complete, restore, and delete subtasks.
- Mark a sticky complete.
- Open the completed pile.
- Restore a completed sticky.
- Clear completed stickies with confirmation.
- Search the active list and confirm custom order is not corrupted.
- Filter the active list by all, today, scheduled, overdue, repeating, and subtasks,
  and confirm filtered views do not corrupt custom order.
- Toggle between custom order and due-date sorting, and confirm due-date sorting
  does not corrupt custom order.
- Reload after changing the task view filter and task sort mode, and confirm the
  workspace remembers both preferences.
- Open the command center and confirm it can jump to lists/tasks, trigger
  workspace actions such as capture/search/density/color mode, and act on the
  selected sticky with complete, restore, duplicate, or delete.
- Reload and confirm persisted state.
- Verify desktop and mobile layouts.
- Verify the active list header does not wrap short names awkwardly or create
  horizontal overflow on desktop, tablet, or phone widths.

## Supabase Acceptance

- Sticky tables live in `sticky`, not `public`.
- RLS is enabled on Sticky-owned tables.
- Owner-scoped policies allow the active user to access only their own rows.
- Unauthenticated users cannot access private Sticky data.
- A second authenticated user cannot read or mutate the first user's data.
- `sticky.allowed_emails` is populated for the owner and intentionally has no
  public policy. A Supabase advisor notice such as `rls_enabled_no_policy` for
  this table is expected and accepted; do not add `anon` or `authenticated`
  policies to the allowlist.
- `sticky.user_preferences` persists completed pile state, density, color mode,
  task view filter, and task sort mode.
- `sticky` is exposed to the Data API and grants are present for the runtime
  role.
- `sticky.advance_recurring_task_for_worker(...)` is executable by
  `service_role` only, not `anon` or `authenticated`.
- No service-role key exists in client code or `NEXT_PUBLIC_*` env vars.

## Deployment Acceptance

- `npm run launch:check` succeeds against the local Vercel link, production
  deployment status, stable production alias, target custom domain, route
  headers, install manifest, cron guard, CI workflow, release branch, Vercel
  production env names, and Supabase Auth URL/callback settings when a local
  Management API token is supplied.
- Vercel project is linked in `.vercel/project.json`.
- GitHub `origin` remote and Vercel Git integration are connected before
  relying on CI or preview-scoped env vars.
- Production, preview, and development Vercel env vars are set.
- Server-only `CRON_SECRET` and `SUPABASE_SECRET_KEY` are set before enabling
  production recurrence automation.
- Supabase Auth site URL is `https://sticky.yuvrajkashyap.com`.
- Supabase Auth redirect URLs include local, production, and the verified preview
  callback URL.
- Preview deployment passes Playwright with `PLAYWRIGHT_BASE_URL`.
- Production deployment passes a manual smoke test.
- Production routes include the hardened browser headers: Content Security
  Policy, HSTS, frame denial, nosniff, referrer policy, and permissions policy.
- Production auth and message-hygiene smoke confirms technical access/save
  errors are replaced with product-facing copy.
- Vercel domain inspection shows `sticky.yuvrajkashyap.com` configured.
- Porkbun DNS matches the exact current Vercel instructions.
- The protected recurrence cron route refuses unauthenticated requests and
  returns a worker result for a valid Vercel cron bearer token.
