# Sticky Connected Platform

## Runtime Boundaries

Sticky is canonical. Google Tasks remains a deferred compatibility layer and
does not own Sticky-only reminder times, recurrence, colors, or metadata.

- Web requests authenticate with the Supabase session cookie or bearer token.
- Agent requests authenticate with a revocable, hashed Sticky API credential.
- Every mutation receives actor, request, scope, and idempotency context.
- Browser writes use `/api/v1/web/commands`; browser DML grants are revoked.
- Agent and provider writes use the same domain/repository boundary.
- Postgres triggers enqueue outbox work in the same transaction as list/task changes.
- Realtime Broadcast invalidates TanStack Query caches in open browsers.

## Public Endpoints

- `/api/health`: deployment and dependency health.
- `/api/v1/*`: authenticated versioned REST/RPC surface.
- `/api/mcp`: stateless Streamable HTTP MCP endpoint.
- `/api/webhooks/google/oauth`: Google OAuth callback.
- `/api/webhooks/*`: provider callback boundary.

Responses use `{ data, meta }`. Errors use
`{ error: { code, message, details, requestId } }`. Mutating agent, webhook,
workflow, and synchronization requests require an idempotency key.

## Data And Security

All app tables live in `sticky.*`. Owner-scoped data retains RLS for reads and
Realtime. Server-only integration credentials, API credential hashes,
idempotency records, and outbox rows have no public policies. Google refresh
tokens are encrypted with AES-256-GCM using `INTEGRATION_ENCRYPTION_KEY`.

The connected-platform migrations are additive. They add record versions,
reminders, push subscriptions, delivery receipts, integration mappings and sync
state, transactional outbox events, scoped API credentials, and richer activity
metadata without resetting existing lists or tasks.

## External Activation

Core Sticky and web push can run with the base production environment. Provider
connections remain visibly disconnected until their credentials are supplied:

- Google Tasks: intentionally deferred for the current release.
- Poke task access: a one-time Sticky key connected to
  `https://sticky.yuvrajkashyap.com/api/mcp`. The first authenticated request
  binds that key to the `X-Poke-User-Id` supplied by Poke.
- Poke reminder delivery: `POKE_API_KEY` from Poke Kitchen.
- Web push: `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and
  `VAPID_SUBJECT`.

Disconnecting an integration stops synchronization or delivery and never
deletes canonical Sticky data.

## Release Gates

Run `npm run verify`, then deploy and run `npm run launch:check` and
`npm run test:production-smoke`. A signed-in release check should exercise one
create, reload, edit, complete, restore, and delete lifecycle and confirm that
an API-created task appears in an already-open browser without a reload.
