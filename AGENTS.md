# Sticky Agent Manual

Owner: Yuvraj Kashyap
Product: Sticky
Domain target: `sticky.yuvrajkashyap.com`
Supabase project: `yk-portfolio`
Supabase schema: `sticky`
Repo path: `C:\Users\ykyuv\dev\stickynotes`

This file is the operating manual for all agents working in this repo. Read it before making architectural, product, database, auth, deployment, or UI decisions.

The existing static prototype is only a visual sketch. The real target is a production-grade app named **Sticky**. The app name is Sticky; the objects inside are **tasks**.

## 1. Product Identity

Sticky is a private **Google Tasks × Trello-style task app**. The UX should intentionally borrow Google Tasks' calm spacing, fast task capture, simple hierarchy, and completion model, while using Trello-inspired list/card organization where helpful. Sticky should not feel like an experimental sticky-note toy; it should feel like a familiar production-grade task manager with a custom premium visual identity.

Locked direction:

```text
Clone the interaction model and spacing language of Google Tasks.
Borrow Trello's list/card clarity where it helps.
Customize the theme, colors, and brand polish to feel uniquely Sticky.
```

The goal is a serious, polished personal task manager:

- fast task capture
- multiple lists
- editable tasks
- editable subtasks
- full drag-and-drop reordering
- completed-task piles
- due dates and times
- recurring task foundation
- durable Supabase-backed data
- auth-protected personal workspace
- deployable to Vercel
- premium visual identity with restrained motion

The app should feel calm, familiar, fast, private, clean, slightly tactile, and premium-but-not-flashy. It must **not** feel like a toy sticky-note app, a generic Kanban clone, a dashboard template, a SaaS landing page, a colorful experimental productivity app, or a dark cinematic portfolio UI.

## 2. Naming Decisions

Use these names consistently:

- Product name: `Sticky`
- App schema: `sticky`
- Production domain: `sticky.yuvrajkashyap.com`
- User-facing individual object: **`task`** singular, **`tasks`** plural
- Generic implementation entity name: `task`
- List entity name: `list`

The app name is Sticky; the objects are tasks. Use generic task-manager language in the UI: **Tasks, Task, Completed task, List, Workspace, Due, Repeat, Subtasks**. Avoid overusing **Sticky / Stickies / Notes / Sticky note** in user-facing copy. Legacy aria-labels and persistence labels containing "sticky/stickies" may remain for selector stability; new copy should prefer task language.

Avoid drifting into alternate names such as `notes` for the domain. The domain and schema should stay `sticky`.

## 3. Required Technical Direction

The intended production stack is:

- Next.js App Router
- TypeScript
- React
- Supabase Auth
- Supabase Postgres in the shared `yk-portfolio` project
- Supabase native runtime access
- Supabase RLS on app-owned tables
- Supabase SSR/browser helpers
- Vercel hosting
- Tailwind CSS with a custom Sticky design system
- Framer Motion or equivalent for high-polish interaction motion
- `dnd-kit` or an equivalent proven drag-and-drop library for reorder behavior
- Playwright for end-to-end verification

Do not keep this as plain static HTML/CSS/JS when the user asks for the real build.

Do not use:

- Auth.js
- NextAuth
- custom password auth
- runtime Prisma for app data
- app tables in `public`
- a shared global `public.profiles` table
- service-role keys in client code
- broad public policies for private user data

## 4. Supabase Ecosystem Rules

Yuvraj uses one shared Supabase project as a multi-app backend platform. Every app must be isolated by schema.

The mental model is:

```text
one Supabase project
many app-specific schemas
shared Supabase Auth where needed
strict app data separation everywhere else
```

For this repo:

- The app schema is `sticky`.
- This repo owns only `sticky.*`.
- Do not casually alter `axis.*`, `capital.*`, `arcade.*`, `jasiverse.*`, or any other app schema.
- Do not put Sticky business tables in `public`.
- `public` should remain nearly empty except Supabase/system-managed things and unavoidable platform-level internals.
- Supabase Auth is the identity source.
- `auth.users.id` is the real identity anchor.
- App-specific user/access data belongs in `sticky.users`, not a global profile table.
- Runtime data access should be Supabase-native.
- RLS must be enabled on Sticky app tables.
- Custom schema exposure, grants, and schema-aware runtime helpers must be handled deliberately.

When working on Supabase:

- Verify current Supabase docs/changelog before implementing feature-specific Supabase behavior.
- Use MCP Supabase tools when available.
- Use `execute_sql` or equivalent direct SQL for iterative schema work.
- Do not use migration-application tools in a way that creates messy half-history while iterating.
- When creating migration files, use the Supabase CLI migration command if available rather than inventing timestamps manually.
- Run advisors if available before considering schema work complete.
- Verify database changes with real queries.

## 5. App Classification

Sticky is a Type B private personal app in Yuvraj's Supabase app matrix.

Classification:

- App name: `sticky`
- Auth requirement: required for real saved personal data
- Sensitivity: medium
- Public behavior: public auth/marketing shell may exist, private app workspace requires auth
- Data model: user-owned personal productivity data
- Runtime model: client-safe owner-scoped reads and narrow writes are acceptable; sensitive/auth/bootstrap/cross-table operations should be server-controlled
- Storage need: none in V1 unless attachments or custom images are explicitly added later
- Legacy migration need: none unless the static localStorage prototype data is intentionally migrated, which is not required by default

V1 may be owner-only if Yuvraj wants it. If owner-only, implement it cleanly with `sticky.allowed_emails`, `sticky.users`, and an app-local helper such as `sticky.is_active_user(uid uuid)`. Do not hardcode an email check throughout the app as the final access model.

## 6. Database Architecture

Design the access foundation before business tables.

Expected foundation:

- `sticky.allowed_emails` if owner-only or allowlist-gated
- `sticky.users`
- optional `sticky.user_state`
- app-local updated-at trigger helper, for example `sticky.set_updated_at()`
- app-local access helper, for example `sticky.is_active_user(uid uuid)`

Expected core tables:

- `sticky.lists`
- `sticky.tasks`
- `sticky.subtasks` or nested task records, depending on final implementation design
- `sticky.task_recurrence_rules` or equivalent recurrence model
- optional `sticky.task_activity` for audit/history/undo if useful
- optional `sticky.user_preferences` for UI state such as collapsed completed piles, selected list, density, theme, and view mode

Do not create tables before deciding:

- owner relationship
- delete behavior
- uniqueness constraints
- indexes
- RLS category
- server/client access boundary

Use snake_case in the database.

Typical ownership pattern:

- every private user-owned table should include `user_id uuid not null references sticky.users(id) on delete cascade`
- list records belong to a user
- task records belong to a user and a list
- subtask records belong to a user and parent task
- recurrence rules belong to a user and parent task

Use `created_at` and `updated_at` consistently. Add `completed_at`, `archived_at`, or `deleted_at` where product behavior needs soft state.

Use explicit numeric ordering columns for drag-and-drop:

- lists need an order field
- active tasks within a list need an order field
- subtasks within a task need an order field
- completed tasks may need their own completed ordering or completed timestamp ordering

Do not rely on timestamps alone for reorderable UI.

## 7. RLS And Security

Enable RLS on all Sticky app tables unless there is a deliberate written reason not to.

Classify tables:

- `sticky.allowed_emails`: zero-policy server-only by default
- `sticky.users`: owner-scoped read/update where appropriate; bootstrap may be server-controlled
- `sticky.user_state`: owner-scoped read/write
- `sticky.lists`: owner-scoped read/write
- `sticky.tasks`: owner-scoped read/write
- `sticky.subtasks`: owner-scoped read/write
- `sticky.task_recurrence_rules`: owner-scoped read/write or server-controlled if recurrence generation becomes complex
- activity/audit tables: usually owner-scoped read and server-controlled write

Remember Supabase RLS gotchas:

- UPDATE requires a SELECT policy.
- Do not use user-editable metadata for authorization decisions.
- Never expose service role or secret keys in browser code.
- Views can bypass RLS unless created safely; use `security_invoker = true` where relevant on supported Postgres versions.
- Do not put privileged `security definer` functions in exposed schemas unless the trust boundary is very carefully designed.

Client-safe operations for Sticky can include:

- read own lists/tasks/subtasks
- create own lists/tasks/subtasks
- edit own lists/tasks/subtasks
- reorder own lists/tasks/subtasks
- mark own tasks/subtasks complete
- collapse or expand completed groups
- update benign preferences

Prefer server-controlled operations for:

- app user bootstrap
- owner allowlist enforcement
- cross-table transactional reorder if the client approach becomes fragile
- recurrence expansion if it creates new task instances
- destructive bulk operations such as delete all completed

## 8. Supabase Dashboard And Runtime Setup

Because Sticky uses a custom schema, agents must account for:

- schema creation
- schema exposure/API configuration if runtime client access requires it
- grants for `authenticated` and other appropriate roles
- RLS policies
- function grants
- sequence/table grants where relevant
- schema-aware Supabase client usage

Expected env vars:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Server-only values, if ever used, must not be prefixed with `NEXT_PUBLIC_`.

Vercel is the production env source of truth. Local `.env.local` may be used for development. Never commit secrets.

Auth redirect URLs must include:

- local development URL
- Vercel preview URL pattern if needed
- production URL `https://sticky.yuvrajkashyap.com`

## 9. Product Requirements

Build toward Google Tasks parity unless Yuvraj explicitly narrows scope. Feature parity primarily means the task/list workflow inside Google Tasks. Google Workspace integrations such as Gmail-to-task or Google Calendar sync should be treated as later integrations unless Yuvraj explicitly pulls them into the current build.

When exact Google Tasks behavior is unclear, verify against official Google Help documentation instead of guessing from memory.

Core list behavior:

- create lists
- rename lists
- delete lists with confirmation
- reorder lists by drag
- switch active list
- persist selected/current list
- show task counts and completed counts
- support empty states

Core task behavior:

- quick-add a task
- edit task title inline or in a details panel
- edit task details/body
- set due date
- set due time
- remove due date/time
- reorder active tasks by drag
- move tasks between lists
- delete tasks
- duplicate tasks only if intentionally included
- mark tasks complete
- restore completed tasks
- keep completed tasks in a completed pile for the list
- completed pile is collapsed by default or user preference, and only shown when opened
- support delete/clear completed with confirmation

Subtask behavior:

- add subtasks to a task
- edit subtasks
- reorder subtasks
- mark subtasks complete
- delete subtasks
- preserve subtask state when parent task moves or completes
- match Google Tasks behavior where relevant

Recurring task behavior:

- support a recurrence foundation
- allow daily, weekly, monthly, yearly, and custom recurrence if included in scope
- support recurrence end conditions such as never, on date, or after N occurrences if included
- match Google Tasks behavior where reasonable
- note that Google Tasks does not allow repeating tasks with subtasks; if Sticky chooses to match this, enforce it clearly in UI and schema

Search and organization:

- search tasks in the active list
- consider global search later
- allow sorting by custom order and date if included
- do not let search/reorder corrupt persisted order

Google source isolation (locked product rule):

- Google Tasks and Google Calendar remain separate from Sticky tasks and Sticky Calendar by default.
- Connecting Google OAuth grants live Google API access; it must not automatically import, copy, link, or mirror Google data into Sticky.
- Assistant tools whose names start with `google_` operate only on live Google data. Generic Sticky task and calendar tools operate only on Sticky data.
- Poke, Littlebird, MCP clients, workflows, and future agents must never call or expose a bulk Google-to-Sticky sync automatically.
- The bulk sync override is owner-only: its server route must reject non-human actors and require the exact final confirmation payload after two explicit UI confirmations.
- Cross-system transfers require an explicit user request naming both the source and destination. Never infer a transfer from a request to create, update, complete, or delete an item.
- Automatic background Google mirroring stays off unless Yuvraj explicitly changes this locked product decision.

State and UX:

- optimistic UI for common actions
- undo affordances for destructive or completion actions where feasible
- high-quality loading, error, and empty states
- keyboard-friendly quick capture
- responsive mobile behavior
- touch-friendly drag behavior

## 10. UI And Design Direction

Sticky must look premium. Do not ship generic SaaS UI.

Design language:

- calm
- familiar
- fast
- clean
- slightly tactile
- premium but restrained
- productivity-first
- easy to scan

Inspiration:

- **Google Tasks** for the primary interaction model: clean rows, soft dividers, simple completion circles, title-first hierarchy, collapsible completed pile, quick-add at the top.
- **Trello** for list/card organization where it helps: clear lists, movable cards/tasks, drag-and-drop affordances.
- **Custom Sticky theme** for premium visual identity: warm-neutral background, clean off-white task surfaces, one confident brand accent, refined typography, restrained shadows.

Locked frontend direction:

- Sticky is a private Google Tasks x Trello-style task app. The UX should intentionally borrow Google Tasks' task-manager structure, fast task capture, simple hierarchy, completion model, and list behavior, while using Trello-inspired multi-list organization where helpful.
- Sticky should not feel like a generic flat task dashboard or an experimental sticky-note toy. It should feel like a familiar production-grade task manager with custom premium visual skins.
- The app supports independent appearance axes:
  - Theme mode: Light / Dark
  - Board style: Sticky pads / Wood board
- The UX and behavior must stay constant across all themes/styles. The style picker changes presentation only, not app logic.
- The four mockup images in the assets folder are the visual source of truth for the frontend direction. Implementation should recreate those mockups as closely as possible while preserving dynamic app behavior.

Do not make:

- a bland gray dashboard
- a marketing landing page as the main screen
- a generic shadcn clone
- a purple-gradient AI-looking page
- a childish toy UI that gets in the way of daily work
- a playful sticky-note board (the old direction)
- a colorful experimental productivity app

The first real screen after auth should be the app workspace, not a landing page.

Visual expectations:

- custom color system rooted in a warm neutral canvas and one confident brand accent
- crisp typography with calm vertical rhythm
- satisfying but quiet task completion (no confetti)
- subtle drag feedback (lift + soft shadow, not bounce)
- polished panels and controls
- high-quality mobile layout
- no text overlap
- no broken responsive widths
- no inaccessible tiny controls
- no cards inside cards unless there is a real reason
- avoid making everything yellow; sticky-note metaphors belong only in subtle accent moments

Use icons in controls where helpful. Prefer proven icon libraries such as lucide when available. Use text labels where clarity matters, especially for primary actions.

## 11. Next.js Guidelines

Use the App Router.

Keep Server Components by default. Push client components down to interactive islands:

- task list interactions
- drag-and-drop
- modals/sheets
- optimistic state
- inline editing

Use server actions or route handlers for server-controlled operations.

Do not initialize database or service clients at module scope in a way that breaks builds. Prefer lazy helper functions where needed.

Make route structure clear:

- public/auth route(s)
- authenticated app route(s)
- possible settings route
- API routes only where they serve a real purpose

Do not rely on proxy/middleware as the only auth protection. Revalidate auth where private data is fetched or mutated.

## 12. Vercel Deployment Direction

The app should be deployable to Vercel.

Before deployment:

- build passes
- typecheck passes
- lint passes
- env vars are known
- Supabase auth redirects are configured
- schema/RLS are verified
- browser smoke tests pass

Domain target:

- `sticky.yuvrajkashyap.com`

Porkbun DNS will point the subdomain to Vercel according to Vercel's domain instructions. Do not invent DNS values. Read current Vercel instructions at setup time if needed.

## 13. Verification Requirements

Do not call implementation done until verified.

Minimum local verification:

- install succeeds
- typecheck succeeds
- lint succeeds
- build succeeds
- app starts locally
- browser smoke test passes on desktop
- browser smoke test passes on mobile viewport
- no console errors in the primary app route

Minimum product verification:

- sign in or auth mock path works, depending on stage
- create list
- rename list
- reorder lists
- create task
- edit task
- reorder tasks
- add subtask
- reorder subtasks
- mark task complete
- expand completed pile
- restore completed task
- delete task/list with confirmation
- data persists after reload

Minimum Supabase verification:

- schema exists as `sticky`
- tables exist in `sticky`, not `public`
- RLS enabled where required
- owner-scoped policies work
- unauthenticated users cannot access private data
- one authenticated user cannot access another user's data
- required grants/custom schema runtime access work
- no service role key is present in client bundle or `NEXT_PUBLIC_*`

## 14. Migration And Prototype Handling

The current static files can be used as inspiration, but they are not the final architecture.

When rebuilding:

- it is acceptable to replace the static prototype with a Next.js app
- preserve good ideas only if they fit the new architecture
- do not build production logic around localStorage
- do not leave a mixed static/prod structure that confuses future agents

If localStorage prototype migration is requested later, treat it as an explicit import feature, not a default requirement.

## 15. Agent Behavior Rules

Before making large changes:

- inspect the repo
- read this file
- identify whether the task touches Supabase, Vercel, auth, UI, or deployment
- use the relevant skills/plugins if available
- preserve existing user work
- avoid unrelated refactors

When working with Supabase:

- follow the shared ecosystem rules
- follow the new-app SOP
- keep app data in `sticky.*`
- verify current docs/changelog where feature behavior may have changed
- test SQL and policies

When working with UI:

- use the real product screen as the main artifact
- verify visually in browser
- check desktop and mobile
- fix layout issues before final handoff

When working with Git:

- check status before major changes
- do not revert user changes
- do not use destructive commands unless explicitly asked

When reporting back:

- summarize concrete changes
- name verification performed
- name anything not verified
- keep the response high signal

## 16. Anti-Patterns

Never:

- put Sticky app tables in `public`
- use Auth.js or NextAuth
- use runtime Prisma for Sticky app data
- expose service-role keys client-side
- create a global shared profiles table
- mix Sticky schema work with Axis/Capital/Arcade/Jasiverse schema work
- leave auth half-wired
- leave database tables without RLS decisions
- skip custom schema grants/exposure considerations
- make a generic dashboard UI
- ship a static-only app as the production answer
- treat a pretty UI as enough without durable data
- claim done without browser and database verification

## 17. Goal Mode Starting Point

When this repo is handed to Codex Goal Mode, the next agent should use this high-level mission:

```text
Rebuild this repo into Sticky, a production-grade Next.js + Supabase task/sticky app at sticky.yuvrajkashyap.com. Follow AGENTS.md exactly. Use the `sticky` Supabase schema in the shared `yk-portfolio` project. Implement Google Tasks-style lists, tasks, subtasks, reordering, due dates, completed piles, and recurrence foundation with premium vibrant UI. Use Supabase Auth, RLS, app-schema isolation, Vercel readiness, and full verification.
```

Do not start implementation until the user explicitly gives the Goal Mode build prompt or otherwise asks to begin.
