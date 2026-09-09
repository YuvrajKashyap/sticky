-- Additive: old single-date schedules continue to use month_day.
-- -1 is the last day of the month; an empty array keeps legacy behavior.
alter table sticky.task_recurrence_rules
  add column if not exists month_days smallint[] not null default '{}';
alter table sticky.task_recurrence_rules
  add constraint sticky_recurrence_month_days_valid check (
    cardinality(month_days) <= 32
    and (cardinality(month_days) = 0 or array_ndims(month_days) = 1)
    and array_position(month_days, null) is null
    and month_days <@ array[-1,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31]::smallint[]
  );
comment on column sticky.task_recurrence_rules.month_days is
  'Monthly dates; -1 means last day, empty uses legacy month_day. Short months clamp and deduplicate dates.';
notify pgrst, 'reload schema';
