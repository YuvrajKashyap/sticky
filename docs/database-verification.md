# Authenticated database verification

The normal `npm run verify` gate covers the sanitized demo. The additional
`Verify authenticated persistence` CI job starts a disposable local Supabase
stack, replays repository migrations and exercises real Auth, PostgREST, RLS,
the web command API, recurrence, outbox transactions and workspace pagination.
It also runs authenticated desktop and mobile browser checks.

Prerequisites: Node.js 24, npm and a running Docker engine. The Supabase CLI is
pinned in dev dependencies. No hosted project credentials are needed.

```powershell
npm ci
npm run database:start
npm run test:database
npm run test:database-browser
```

The stack is named `sticky-verification`. It uses API port 55321, database port
55322 and a deliberately small 100-row API cap. The pagination test loads
1,205 completed tasks to verify that a short API page is not mistaken for the
end of the data. Fixtures use generated owners and clean themselves up.

The local seed resets Data API exposure to the schemas present in this isolated
stack. It accounts for the historical migration that names other applications
in the shared hosted project, without creating or modifying those applications.

The runner reads ephemeral credentials from `supabase status`, checks the local
host and port and overrides application database variables for its child
process. It refuses hosted endpoints. Workflow dispatch is disabled for these
tests, so fixture mutations do not deliver notifications or contact providers.
Keep this configuration local; do not link it to the shared hosted project.

Stop the disposable stack when finished:

```powershell
npx supabase stop --no-backup
```

If Docker is unavailable, the gate exits with an error. It does not silently
skip database verification or fall back to production. CI retains browser
failure traces for seven days.

## Workspace loading and synchronization

Initial loading retrieves all active tasks through bounded, deterministic pages
and exact completed counts per list. Completed task bodies and their children
are loaded when a pile opens or a feature needs history (search, calendar,
overview, delete/undo). Once loaded, that history remains available for the
session. The existing general task API still returns its full requested scope.

Browser writes are serialized in capture order while the interface updates
optimistically. Pending changes are tracked by record and field. A failed
change is removed while later changes are replayed over the confirmed state.
Realtime broadcasts request a complete refresh instead of directly replacing
records with potentially stale payloads. Snapshots started before a new write
are discarded; the final settled save refreshes canonical data. Focus and
network reconnection also refresh tasks, children, recurrence and preferences.
