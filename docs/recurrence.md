# Sticky Recurrence Runbook

Sticky V1 includes a production recurrence foundation, completion-driven next
occurrence generation, user-controlled catch-up for overdue repeat series, and a
protected Vercel Cron worker for automated overdue catch-up. This document
records what is already shipped and what remains before the worker can be fully
activated in production.

## Current Foundation

- Recurrence data lives in `sticky.task_recurrence_rules`.
- Rules are owner-scoped with RLS and runtime grants for authenticated users.
- The UI supports daily, weekly, monthly, yearly, and custom frequencies.
- Rules include interval count, start date, optional weekdays, optional month
  day, end type, end date, occurrence count, timezone, and paused state.
- The workspace renders human recurrence summaries on task cards and in the
  details panel.
- Sticky intentionally blocks repeating tasks with subtasks in both UI and
  database triggers.
- Completing an active repeating sticky creates the next active occurrence,
  copies title, details, color, due time, timezone, and list placement, and
  moves the recurrence rule to that next active sticky.
- Recurring completion is handled by `sticky.complete_task_with_recurrence(...)`
  so the current completion, next-task insert, and recurrence-rule handoff are
  transactional.
- Undo for a recurring completion uses `sticky.undo_recurring_completion(...)`
  to move the rule back, delete the generated next sticky, and restore the
  completed sticky.
- Overdue active repeating stickies can be advanced from the workspace with the
  catch-up banner. The update uses `sticky.advance_recurring_task(...)` so the
  due-date move and after-count decrement stay transactional.
- The manual catch-up flow and the scheduled worker share the same date math in
  `src/lib/sticky/recurrence.ts`.
- Vercel Cron is configured in `vercel.json` to call
  `/api/recurrence/catch-up` daily. The route requires `CRON_SECRET`, uses a
  server-only Supabase secret client, and never exposes admin credentials to the
  browser.
- Automated catch-up writes through
  `sticky.advance_recurring_task_for_worker(...)`, which is granted only to
  `service_role`, stays `SECURITY INVOKER`, rechecks active user/task/rule
  state, and logs `recurrence_catch_up` events in `sticky.task_activity`.
- Paused rules, end dates, and after-count exhaustion do not create a next
  active occurrence. After-count rules are decremented on each generated
  occurrence and on catch-up advances.
- Deleting a task or clearing completed stickies removes the associated
  recurrence rule.
- Undo for task delete and completed-clear restores recurrence rules together
  with the task rows.

## Remaining Limitation

The automated worker code, SQL, and Vercel schedule are shipped. Production
activation still requires server-only Vercel environment variables:

```text
CRON_SECRET=<random string of at least 16 characters>
SUPABASE_SECRET_KEY=<Supabase sb_secret_... key>
```

Until `SUPABASE_SECRET_KEY` is present, the authenticated cron route reports
itself as disabled and does not mutate data. The worker advances the active
repeating sticky to the next current occurrence; it does not materialize every
missed historical instance as separate tasks.

## Future Worker Expansion

Keep any future expansion server-controlled. Do not put service-role or secret
credentials in any `NEXT_PUBLIC_*` value.

If Sticky later needs full missed-instance backfill rather than advancing the
active repeating sticky, use this path:

1. Keep `/api/recurrence/catch-up` protected by `CRON_SECRET` or move the work
   to a Supabase scheduled function with an equivalent server-only trust
   boundary.
2. Reuse `src/lib/sticky/recurrence.ts` for date calculations so UI and worker
   behavior stay aligned.
3. Preserve title, details, color, list, due time, timezone, and owner scope.
4. Make generation idempotent. Add a migration before the expansion ships if a
   durable marker is needed, for example `sticky.task_activity` event metadata
   or explicit recurrence instance columns.
5. Keep the current subtask restriction unless the product intentionally chooses
   a different behavior and updates both UI and database constraints.
6. Add tests for daily, weekly weekday, monthly day, yearly date, end-on-date,
   end-after-count, paused rules, missed-run catch-up, and duplicate-run
   prevention.

## Verification Before Shipping The Worker

- Run the worker twice against the same eligible active task and confirm only
  the first run advances it.
- Confirm a rule ending before the next occurrence creates nothing.
- Confirm an after-count rule stops at the configured count.
- Confirm a paused rule creates nothing.
- Confirm the manual catch-up action can be run twice without moving an already
  current repeat.
- Confirm generated tasks stay in the same user's `sticky` rows and do not touch
  any other app schema.
- Confirm no service-role or worker secret appears in the browser bundle or
  `NEXT_PUBLIC_*` Vercel variables.
- Run `npm run verify`, Supabase RLS checks, and production smoke checks after
  deploying the worker.
