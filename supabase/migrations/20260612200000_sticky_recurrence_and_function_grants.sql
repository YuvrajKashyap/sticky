-- Tighten Sticky recurrence data and exposed function grants.

alter table sticky.task_recurrence_rules
  drop constraint if exists sticky_recurrence_days_of_week_range;

alter table sticky.task_recurrence_rules
  add constraint sticky_recurrence_days_of_week_range
  check (days_of_week <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]);

revoke execute on all functions in schema sticky from public, anon, authenticated;

grant execute on function sticky.bootstrap_current_user(text) to authenticated, service_role;
grant execute on function sticky.is_active_user(uuid) to authenticated, service_role;
grant execute on function sticky.email_is_allowed(text) to service_role;
grant execute on all functions in schema sticky to service_role;

notify pgrst, 'reload schema';
