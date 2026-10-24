# Independent routine occurrences

## Behavior

A recurring task is now a routine template plus dated task records. Generation is independent of completion. An occurrence is active on its scheduled day in its saved timezone. Once that local day ends, an unchecked occurrence becomes **Not completed** and leaves the active board. A one-off remains overdue as before.

Not completed means the occurrence was not checked off in Sticky; it is not evidence that the activity did not happen. Routine history lets the owner correct an exact older occurrence. Completion records the actual correction timestamp. It never changes today's task or creates/completes a future task.

Use the history icon in the workspace toolbar to select a routine and date range. The rate is completed / (completed + not completed). Pending, explicitly skipped, unknown and not-scheduled occurrences are excluded. A paused/cancelled scheduled date is labelled Not scheduled, separately from an explicit Skip. Days that never belonged to the schedule have no occurrence row.

## Storage and reconciliation

- `routine_templates` holds stable routine identity, future task fields, schedule snapshot, tracking boundary and generation cursor. Its ID matches the existing recurrence-rule ID.
- `routine_schedule_versions` retains schedule revisions with their effective timestamps.
- Existing `tasks` are the occurrence records, with `routine_id`, immutable `scheduled_date` and `occurrence_status`. Their existing completion timestamps and task IDs remain authoritative.
- `(routine_id, scheduled_date)` is unique. The reconciler locks each template, inserts missing dates, expires pending dates using each occurrence's own timezone, and commits the cursor in the same transaction. Concurrent calls serialize; repeated calls do not duplicate records or completions.
- Workspace reads, focus/reconnect, a visible-page minute timer, agent task/history reads, and the protected recurrence cron run reconciliation. Offline periods are materialized on the next connected read. No completion is inferred.
- The engine iterates calendar dates rather than elapsed 24-hour intervals. It honors interval/weekday/month-day/yearly/custom selection, start/end boundaries, finite counts and pauses. Short months clamp and deduplicate requested dates, including last-day selection.
- Only dates through the current local day are generated automatically. A deliberately scheduled initial future task can exist, but is never considered missed before its local day ends.
- Before a schedule change, the old schedule is reconciled through the edit time. New schedule rules apply from the following local day; historical rows are not rewritten. Pausing cancels unchecked current/future dates and excludes them from rates. Resuming starts at the current local day without backfilling paused days. Each occurrence retains its original timezone even after a template timezone change.
- Removing repeat retires its template and retains dated records. Clearing/deleting tasks is still an explicit destructive operation, not part of reconciliation. A completed occurrence is no longer a dependency for future generation.
- Reminder delivery ignores expired, skipped and cancelled occurrences. Existing one-off reminder reconciliation remains in place.

## Migration assumptions and release boundary

Migration `20261024152319_independent_routine_occurrences.sql` is additive for task data: it does not delete tasks or change existing task IDs, scheduled due dates, checked states or completion timestamps. It copies existing rules/task fields into templates and links only the currently referenced occurrence. An old unchecked date becomes **Unknown**, not a manufactured miss. Tracking starts on migration day in the routine's timezone (or the current scheduled future date for generation).

Earlier completed task records remain unchanged in completed lists. The old model moved a rule between tasks and does not guarantee a durable routine identity for older records. The migration does not guess relationships from matching titles, and it does not generate rows for earlier dates with unknown schedule/pause history. Rates therefore describe recorded, attributable occurrences, not lifetime adherence.

The existing remaining-count value is treated as the remaining schedule at cutover, including the currently linked occurrence. Existing valid IANA timezone values are required; invalid values must be resolved explicitly before release rather than silently assigned a different timezone.

The rule's task ID is now a compatibility pointer to its latest occurrence, not the routine template's identity. Its old cascade foreign key is removed so clearing a completed task cannot silently erase a future schedule. Owner checks, the template's owner/list foreign keys, RLS, and narrow server write paths remain in force.

**Do not apply this migration or deploy without owner approval.** Review/stage the application and migration together. An already-open old browser may optimistically display its old next-task behavior until reloaded; server compatibility RPCs still only complete the exact requested occurrence. Refresh agent tool metadata after an approved release so clients see the new history tools/descriptions.

## API and MCP

Existing `complete_task` / task completion endpoints target the supplied task ID, which is one exact occurrence. Legacy next-task arguments are accepted but ignored. Undo restores only the exact completed task; it never deletes another day.

New bounded history operations:

- `GET /api/v1/routines` / `list_routines`
- `GET /api/v1/routines/:id/history?from=YYYY-MM-DD&through=YYYY-MM-DD` / `get_routine_history`
- `POST /api/v1/occurrences/:id/status` / `set_occurrence_status`, requiring the scheduled date and a supported status; HTTP also requires a version. A mismatched task/date fails without writing.

Read and write scopes remain `tasks:read` and `tasks:write`. No extra agent permissions are removed. Google-source isolation and existing integrations remain unchanged.

`reconcile_my_routines` is the only new authenticated SQL entry point. It accepts no clock or routine payload, checks the authenticated owner, and only materializes that owner's authorized schedules. The clock-selectable reconciler and all template writes remain service-only. Both new tables have owner SELECT RLS and no browser write grants.

## Verification

`npm run test:recurrence-migration` resets **only the disposable localhost:55321 verification stack**, seeds the old schema with completed/current legacy records, applies the new migration locally, and checks exact record/timestamp preservation, unknown history and idempotence. Never run this against a shared development database. The script refuses nonlocal endpoints and never uses `.env.local` or `--linked`.

`npm run test:database` covers day rollover, late correction, concurrent offline catch-up, one-offs, pause/end/count bounds, DST, custom/monthly/yearly dates, ownership and exact-date API validation. Authenticated desktop/mobile browser tests cover the actual dashboard and history panel, including an unchanged today row after correcting yesterday. CI runs the preservation test before the normal database and browser suites.
