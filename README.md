# Sticky

Sticky is a production-grade personal task and sticky-note app for `sticky.yuvrajkashyap.com`.

The app is a Next.js App Router build backed by Supabase Auth and the dedicated
`sticky` Postgres schema. The local demo adapter is only for smoke testing when
Supabase keys are unavailable; production data belongs in Supabase.

## Local Setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env.local`.
3. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
   Set `NEXT_PUBLIC_SITE_URL` only for a deployed origin that is already present
   in Supabase Auth's redirect allow list.
4. For scheduled recurrence catch-up, set server-only `SUPABASE_SECRET_KEY` and
   `CRON_SECRET` in Vercel. Do not prefix either value with `NEXT_PUBLIC_`.
5. Apply the SQL files in `supabase/migrations/` to the shared Supabase project in timestamp order. The Data API migration appends the `sticky` schema to Supabase's exposed schemas, and the latest recurrence cron migration adds the service-only worker RPC.
6. Add approved owner emails to `sticky.allowed_emails`.
7. Configure Supabase Auth redirect URLs for the production domain and local development.
8. Set the same public Supabase environment variables in Vercel.
9. Run `npm run dev`.

## Verification

Run the full local gate with:

```powershell
npm run verify
```

That command runs typecheck, lint, production build, a moderate npm audit, and
Playwright. It also runs a local security check that confirms client-reachable
modules do not import server-only Supabase helpers or reference server-only
Supabase/cron secrets, plus a schema check that guards Sticky migrations against
public-schema drift, `anon` grants, missing RLS, and unsafe final function
execute/search-path settings. Playwright starts or reuses
`http://localhost:3100` and enables demo mode only for that test server when
Supabase public keys are not present.

Useful narrower checks:

```powershell
npm run typecheck
npm run lint
npm run security:check
npm run schema:check
npm run build
npm run test:e2e
npm run test:production-smoke
```

The repository also includes a GitHub Actions workflow at
`.github/workflows/verify.yml`. Once this local repo is pushed to GitHub, it
runs the same `npm run verify` gate on pushes to `main`, pull requests, and
manual dispatches.

`.github/workflows/production-smoke.yml` adds a manual hosted-smoke workflow with
a URL input. Use it after the repo is connected to GitHub to run
`npm run test:production-smoke` against a production or preview deployment.

`npm run test:production-smoke` defaults to the canonical production domain and runs
read-only desktop/mobile Playwright checks against the signed-out shell,
callback hygiene, hardened headers, install assets, console errors, and
horizontal overflow. It is intentionally separate from the local `npm run verify`
gate. Override it with `STICKY_PRODUCTION_URL` or `PLAYWRIGHT_BASE_URL` when
checking a different hosted deployment.

Before calling the hosted app launch-ready, run:

```powershell
npm run launch:check
```

This checks the local Vercel link, Vercel deployment readiness, Vercel domain
attachment/configuration, the stable production alias, hardened route headers,
Deployment Protection state, `robots.txt`, the install manifest, the
recent production runtime error-log window, the unauthenticated recurrence cron
guard, the local and deployed Vercel Cron schedule, the intended custom-domain
DNS record, the local verification workflow and release branch, the local Git
remote and Vercel Git integration state, the required Vercel production env
names, and, when `SUPABASE_ACCESS_TOKEN` is present locally, Supabase Auth site
URL and redirect allow-list configuration, including the current generated
production callback derived from Vercel. It does not print secret values. It is expected to fail until
`sticky.yuvrajkashyap.com` resolves, `SUPABASE_SECRET_KEY` is set in Vercel,
`NEXT_PUBLIC_SITE_URL` is set for the final domain, and Supabase Auth callback
configuration is finished. It also warns until the repo has a GitHub `origin`
remote and the Vercel project is connected to Git so CI and preview integration
can run outside this machine.

## Production Handoff

- Deployment runbook: [docs/deployment.md](docs/deployment.md)
- Release checklist: [docs/release-checklist.md](docs/release-checklist.md)
- Recurrence runbook: [docs/recurrence.md](docs/recurrence.md)

The current workspace is linked to the Vercel project
`yuvraj-kashyaps-projects/sticky`, with the stable alias
`https://sticky-green.vercel.app` and canonical custom domain
`https://sticky.yuvrajkashyap.com`. Porkbun DNS resolves the custom domain to
Vercel, Vercel reports the domain configured, and the required production env
vars include `SUPABASE_SECRET_KEY` for the protected recurrence worker.
