-- Persist Sticky planning view preferences per user.

alter table sticky.user_preferences
  add column if not exists task_view_filter text not null default 'all',
  add column if not exists task_sort_mode text not null default 'custom';

alter table sticky.user_preferences
  drop constraint if exists sticky_user_preferences_task_view_filter_check,
  drop constraint if exists sticky_user_preferences_task_sort_mode_check;

alter table sticky.user_preferences
  add constraint sticky_user_preferences_task_view_filter_check
    check (task_view_filter in ('all', 'due', 'overdue', 'recurring', 'subtasks')),
  add constraint sticky_user_preferences_task_sort_mode_check
    check (task_sort_mode in ('custom', 'due'));

notify pgrst, 'reload schema';
