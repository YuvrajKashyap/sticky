-- Tasks can also be sorted by the moment they were added.
alter table sticky.user_preferences
  drop constraint if exists sticky_user_preferences_task_sort_mode_check,
  add constraint sticky_user_preferences_task_sort_mode_check
    check (task_sort_mode in ('custom', 'due', 'added'));
