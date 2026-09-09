# Monthly recurrence

Monthly tasks can select any combination of dates 1–31 and the last day of the
month. Quick-add and task details share the same picker. Shortcuts select the
1st, 1st and 15th, month end, or every day. At least one date stays selected.

The repeat interval applies to months, not individual selected dates. For
example, every two months on the 1st and 15th produces January 1, January 15,
March 1, March 15. Dates beyond the end of a shorter month use its last day;
overlapping dates produce one occurrence. Leap years are handled in UTC date
arithmetic. Count/date end conditions and pause still apply.

Quick-add schedules the first occurrence on or after the chosen due date (or
today). Editing an existing rule changes its future occurrences; it does not
silently reschedule the current task. Existing single-date rules keep their
legacy behavior until edited with the new picker.

## Release order

Apply `supabase/migrations/20260909224359_sticky_monthly_days.sql` to the Sticky
schema before deploying the application change. This is an additive column
with an empty default; it does not rewrite existing schedules or change RLS.
The column uses `-1` for last day and `[]` to fall back to `month_day`.

The migration was tested locally and applied to the hosted Sticky schema on September 9, 2026. All 13 existing rules retained the legacy fallback and RLS remained enabled. It is
not automatically applied to the hosted project by the app or by a git push.
