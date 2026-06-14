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
Supabase/cron secrets. Playwright starts or reuses `http://localhost:3100` and
enables demo mode only for that test server when Supabase public keys are not
present.

Useful narrower checks:

```powershell
npm run typecheck
npm run lint
npm run security:check
npm run build
npm run test:e2e
```

Before calling the hosted app launch-ready, run:

```powershell
npm run launch:check
```

This checks the local Vercel link, Vercel deployment readiness, Vercel domain
attachment/configuration, the stable production alias, hardened route headers,
`robots.txt`, the install manifest, the unauthenticated recurrence cron guard,
the intended custom-domain DNS record, the required Vercel production env names,
and, when `SUPABASE_ACCESS_TOKEN` is present locally, Supabase Auth site URL and
redirect allow-list configuration, including the current generated production
callback derived from Vercel. It does not print secret values. It is expected to fail until
`sticky.yuvrajkashyap.com` resolves, `SUPABASE_SECRET_KEY` is set in Vercel,
`NEXT_PUBLIC_SITE_URL` is set for the final domain, and Supabase Auth callback
configuration is finished.

## Production Handoff

- Deployment runbook: [docs/deployment.md](docs/deployment.md)
- Release checklist: [docs/release-checklist.md](docs/release-checklist.md)
- Recurrence runbook: [docs/recurrence.md](docs/recurrence.md)

The current workspace is linked to the Vercel project
`yuvraj-kashyaps-projects/sticky` and has a production deployment at
`https://sticky-3zihnt2x3-yuvraj-kashyaps-projects.vercel.app`, with the stable
alias `https://sticky-green.vercel.app`. The latest deployment metadata lists
`https://sticky.yuvrajkashyap.com` as an alias, and Vercel domain inspection now
finds it attached to `yuvraj-kashyaps-projects/sticky`; Porkbun still needs the
Vercel-provided `A sticky.yuvrajkashyap.com 76.76.21.21` record before DNS
resolves. The protected recurrence cron route and live worker RPC are prepared,
but Vercel still needs `SUPABASE_SECRET_KEY` before scheduled catch-up can mutate
production data. Supabase Auth URL configuration also still needs the dashboard
or Management API step from the runbook before real email/OAuth sign-in can be
fully verified.
