# Goal Mode Brief: Build Sticky

Objective: rebuild `C:\Users\ykyuv\dev\stickynotes` into the full production version of **Sticky**, a premium Google Tasks-style sticky task app.

This is a long-running build goal. Do not stop at a plan, scaffold, or small prototype. Keep working until the product is genuinely implemented as far as the environment allows, thoroughly verified, and ready for handoff. If you think you are finished, do one more pass for missing behavior, missing polish, missing Supabase/RLS pieces, mobile issues, build/type/lint failures, browser console errors, and deployment readiness.

## 1. First Read

Before touching code, read `C:\Users\ykyuv\dev\stickynotes\AGENTS.md` completely and follow it as the project constitution.

`AGENTS.md` is authoritative for:

- product name and domain
- Supabase project/schema rules
- Yuvraj's shared Supabase ecosystem rules
- security and RLS expectations
- UI/product direction
- verification requirements
- anti-patterns

Do not violate `AGENTS.md`.

## 2. Product Identity

Product name: **Sticky**
Production domain target: `sticky.yuvrajkashyap.com`
Supabase project: `yk-portfolio`
Supabase schema: `sticky`

Individual notes/tasks may be called **stickies** in the UI.

Sticky should feel like Google Tasks in workflow depth, but visually premium, vibrant, tactile, and polished. The UI reference is not "make a fruit app"; the reference is the level of polish you would expect from a high-quality game company interface: color, motion, clarity, tactile surfaces, and delight.

This app must feel like a serious product, not a weekend toy.

## 3. Build Target

Replace the current static prototype with a real production-grade app.

Use:

- Next.js App Router
- TypeScript
- React
- Supabase Auth
- Supabase Postgres
- Supabase SSR/browser helpers
- Tailwind CSS or equivalent with a custom Sticky design system
- a proven drag-and-drop library such as `dnd-kit`
- a motion library such as Framer Motion if useful
- Vercel-ready project structure
- Playwright/browser verification

Do not use:

- Auth.js
- NextAuth
- runtime Prisma for app data
- app tables in `public`
- global `public.profiles`
- service-role keys in client code
- localStorage as the production data layer
- a static-only final app

## 4. Supabase Architecture

Use the shared Supabase project model:

- one Supabase project powers multiple apps
- each app owns a dedicated schema
- Sticky owns only `sticky.*`
- Supabase Auth is the identity source
- app data belongs in app schema, not `public`

For this app:

- create/use schema `sticky`
- do not touch `axis.*`, `capital.*`, `arcade.*`, `jasiverse.*`, or other app schemas except for harmless inspection if absolutely needed
- create the access foundation before business tables
- use Supabase Auth only
- create `sticky.users`
- create `sticky.allowed_emails` if owner-only V1 is appropriate
- create a clean access helper such as `sticky.is_active_user(uid uuid)` if using allowlist access
- enable RLS on app tables
- create owner-scoped policies
- handle custom schema grants/exposure/runtime access deliberately
- verify schema and policies with real queries as much as tools allow

If Supabase MCP/credentials are unavailable, still build the app and SQL/migration files as far as possible. Clearly document the exact external Supabase steps that remain.

## 5. Database Model

Design the schema intentionally. Expected model includes, as appropriate:

- `sticky.allowed_emails`
- `sticky.users`
- `sticky.user_state`
- `sticky.lists`
- `sticky.tasks`
- `sticky.subtasks` or a carefully designed nested task model
- `sticky.task_recurrence_rules`
- `sticky.user_preferences`
- optional `sticky.task_activity` for history/undo/audit if useful

Requirements:

- use snake_case in DB
- use `auth.users.id` as identity anchor
- every user-owned table should be scoped to `sticky.users`
- add timestamps
- add explicit ordering fields for drag reorder
- add indexes for expected query patterns
- use FKs and delete behavior deliberately
- do not rely on timestamps alone for reorderable UI

## 6. Required Features

Build toward Google Tasks-style parity for the task/list workflow.

Lists:

- create list
- rename list
- delete list with confirmation
- reorder lists by drag
- switch active list
- persist selected list/user state
- show active/completed counts
- empty states

Tasks:

- quick-add task
- edit task title
- edit task details/body
- set due date
- set due time
- remove due date/time
- reorder active tasks by drag
- move tasks between lists
- delete task with confirmation
- mark task complete
- restore completed task
- completed tasks move into that list's completed pile
- completed pile is collapsed until opened, like Google Tasks
- clear/delete completed with confirmation

Subtasks:

- add subtasks
- edit subtasks
- reorder subtasks
- complete/restore subtasks
- delete subtasks
- keep subtask state when parent task moves or completes

Recurrence:

- implement at least a solid recurrence data model/foundation
- support UI and DB shape as far as practical
- if full recurring task generation is too large for this pass, complete the foundation and document the remaining server job/function work
- if matching Google Tasks behavior, note that repeating tasks with subtasks should be restricted or clearly handled

Search/filter:

- search current list tasks
- do not corrupt persisted custom ordering while filtering

UX:

- optimistic UI where appropriate
- loading states
- error states
- empty states
- undo affordances where feasible
- keyboard-friendly quick capture
- responsive mobile layout
- touch-friendly drag behavior
- premium drag/completion feedback

## 7. UI Quality Bar

Make the app look and feel premium.

Do not ship:

- a generic SaaS dashboard
- a bland gray admin UI
- a basic shadcn clone
- a marketing landing page as the primary experience
- a childish toy UI that hurts daily usability
- a page with text clipping, overlap, awkward scroll, or broken responsive widths

The authenticated first screen should be the actual app workspace.

Design expectations:

- vibrant but controlled palette
- tactile sticky/card/list surfaces
- crisp typography
- high-quality icons and controls
- strong visual hierarchy
- satisfying completion/reorder interactions
- polished desktop and mobile layouts
- responsive constraints that prevent broken text/buttons/cards
- no obvious "AI-generated website" look

The product should feel like a big developer/company could have produced it.

## 8. Implementation Guidance

Be proactive. Make reasonable decisions. Do not keep asking questions unless truly blocked.

Use existing repo patterns only where they still make sense. The current static files are a prototype and may be replaced.

Keep Server Components by default and push client components down to interactive islands:

- task list
- drag-and-drop
- modals/sheets
- optimistic editing
- inline task controls

Use server actions or route handlers for server-controlled operations.

Do not initialize service clients at module scope in ways that break build-time evaluation.

Do not rely on proxy/middleware as the only auth boundary. Revalidate auth where private data is fetched or mutated.

Use current official docs for Supabase/Next.js behavior where needed.

## 9. Vercel Readiness

Make the app Vercel-ready.

Do not make Porkbun DNS changes unless explicitly authorized.

Prepare for:

- `sticky.yuvrajkashyap.com`
- Vercel env vars
- Supabase auth redirect URLs
- production build

If actual Vercel deployment cannot be completed in the environment, document exact remaining deployment/domain steps.

## 10. Verification Requirements

Before final response, verify as much as the environment allows.

Required local checks:

- install dependencies
- typecheck
- lint
- build
- run local dev server
- browser verify desktop
- browser verify mobile
- check browser console errors
- check git status

Required product checks:

- auth path works or is clearly documented if external auth setup blocks it
- create list
- rename list
- delete list
- reorder lists
- create task
- edit task
- set due date/time
- reorder tasks
- move task between lists
- add subtask
- edit subtask
- reorder subtasks
- mark task complete
- expand completed pile
- restore completed task
- clear/delete completed if implemented
- data persists after reload

Required Supabase checks:

- `sticky` schema exists or migration files create it
- Sticky app tables are in `sticky`, not `public`
- RLS enabled where required
- policies are owner-scoped
- unauthenticated users cannot access private data
- users cannot access other users' data
- custom schema grants/exposure are handled or documented
- no service-role key is exposed client-side

## 11. Final Response

Final response must include:

- what was built
- files/areas changed
- Supabase schema/tables/policies created or prepared
- verification commands and results
- local URL
- anything not completed and why
- exact next steps for Vercel/domain if needed

Do not hide gaps. If something was blocked by missing credentials, tools, or external dashboard access, say exactly what remains and what is already done.

## 12. Mindset

This is a serious product build. Do not underbuild it.

If the app feels like a prototype, keep going.
If the UI feels generic, improve it.
If the database is vague, tighten it.
If the RLS is unverified, verify it.
If mobile is rough, fix it.
If a feature is only half wired, finish it or clearly mark the remaining external dependency.

Return only when Sticky is as complete, premium, polished, and verified as possible within the current environment.
