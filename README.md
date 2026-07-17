# Sticky

Sticky is a private, full-stack task platform built for fast capture and serious
follow-through. It combines a horizontal list workspace, rich task details,
calendar planning, recurring work, reminders, and a command-driven overview in
one installable web app.

[Open the private production app](https://sticky.yuvrajkashyap.com) ·
[Read the architecture notes](docs/connected-platform.md) ·
[Review the deployment runbook](docs/deployment.md)

> Production access is allow-listed because Sticky contains private task data.
> The repository includes a sanitized local demo with no account or Supabase
> setup required.

## What it does

- **Capture and organize:** quick-add tasks, lists, subtasks, notes, colors,
  due dates, due times, and drag-and-drop ordering.
- **Plan the work:** All, Today, Scheduled, Overdue, Repeating, and Subtasks
  views plus month, week, and day calendars.
- **Handle recurring work:** daily, weekly, monthly, and yearly rules with
  pause, end-date, occurrence-count, and catch-up behavior.
- **Move quickly:** keyboard shortcuts, a command center, workspace search,
  smart date parsing, duplication, undo, and a data-driven command deck.
- **Stay connected:** private reminders, web push, Realtime invalidation, a
  scoped API, and an MCP surface for agent access.
- **Install it:** PWA metadata, shortcuts, service-worker support, generated
  social cards, and desktop/mobile layouts.

## Engineering highlights

Sticky treats the web UI, API, background work, and external connections as one
product rather than a collection of demos:

- Browser mutations go through a versioned Hono command API; direct browser DML
  is revoked in production.
- Every mutation carries actor, scope, request, version, and idempotency context.
- Postgres writes and outbox events commit together, so reminder and integration
  work cannot silently drift from task state.
- Supabase Realtime Broadcast invalidates TanStack Query caches in open clients.
- Private tables live in a dedicated `sticky` schema with owner-scoped RLS,
  explicit grants, pinned security-definer search paths, and no `anon` access.
- Integration credentials are server-only, encrypted at rest, revocable, and
  never exposed through client bundles or public configuration.

Google Tasks sync is intentionally deferred. Sticky remains the canonical task
system and does not depend on a third-party task provider to operate.

## Architecture

```text
Next.js 16 web/PWA
        │
        ├── authenticated reads + Realtime invalidation
        │
        └── Hono /api/v1 command boundary + /api/mcp
                    │
                    ├── contracts (Zod)
                    ├── domain authorization and task logic
                    ├── Supabase repositories
                    └── durable workflows, reminders, and outbox delivery
                                │
                       Supabase Auth + Postgres
                       isolated sticky schema + RLS
```

The repository is organized as a small TypeScript monorepo:

- `src/` — Next.js App Router host, PWA shell, and interactive workspace.
- `apps/api/` — Hono API, MCP endpoint, webhooks, services, and workflows.
- `packages/contracts/` — shared Zod contracts, DTOs, errors, and enums.
- `packages/domain/` — framework-independent authorization and task logic.
- `packages/data/` — server-only Supabase repositories and runtime wiring.
- `supabase/migrations/` — additive schema, RLS, grants, indexes, and functions.
- `tests/e2e/` — desktop/mobile product, security, auth, PWA, and persistence flows.

## Run the sanitized demo

Requirements: Node.js 24 and npm.

```powershell
npm install
$env:STICKY_DEMO_MODE="true"
$env:NEXT_PUBLIC_STICKY_DEMO_MODE="true"
npm run dev
```

Open `http://localhost:3000`. Demo changes persist only in the browser's local
storage. The fixture is compact, fictional, and safe to use in screenshots or
interviews.

## Connect a full local environment

1. Copy `.env.example` to `.env.local`.
2. Add the Supabase public URL and publishable key.
3. Add the server-only values documented in `.env.example`, including
   `SUPABASE_SECRET_KEY`, `INTEGRATION_ENCRYPTION_KEY`, and `CRON_SECRET`.
4. Apply `supabase/migrations/` in timestamp order and add approved owner emails
   to `sticky.allowed_emails`.
5. Configure the local and production Auth redirect URLs.
6. Run `npm run dev`.

Provider credentials are optional. Poke and web-push controls remain visibly
disconnected until their server-side configuration is present.

## Verification

```powershell
npm run verify
```

The release gate runs monorepo typechecks, ESLint, Vitest, client/server secret
boundary checks, migration/RLS checks, a production build, a moderate dependency
audit, and 84 Playwright desktop/mobile cases. Playwright starts an isolated
demo server at `http://localhost:3199`; reusing an existing server is opt-in so
tests cannot attach to an authenticated development session.

Useful focused commands:

```powershell
npm run test:unit
npm run test:api
npm run security:check
npm run schema:check
npm run build
npm run test:e2e
npm run test:production-smoke
npm run launch:check
```

GitHub Actions runs the same verification gate on `main`, pull requests, and
manual dispatches. The separate production smoke workflow checks the signed-out
shell, redirects, headers, install assets, console errors, and mobile overflow
without mutating hosted data.

## Production operations

- [Connected-platform architecture](docs/connected-platform.md)
- [Deployment and environment runbook](docs/deployment.md)
- [Release checklist](docs/release-checklist.md)
- [Recurrence and catch-up runbook](docs/recurrence.md)

The canonical deployment is `sticky.yuvrajkashyap.com`, backed by Vercel and a
shared Supabase project. Migrations are additive: production data is never reset
as part of deployment.
