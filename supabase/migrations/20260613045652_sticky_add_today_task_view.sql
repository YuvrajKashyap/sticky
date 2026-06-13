-- Add a first-class Today task view to persisted Sticky preferences.

alter table sticky.user_preferences
  drop constraint if exists sticky_user_preferences_task_view_filter_check;

alter table sticky.user_preferences
  add constraint sticky_user_preferences_task_view_filter_check
    check (task_view_filter in ('all', 'today', 'due', 'overdue', 'recurring', 'subtasks'));

notify pgrst, 'reload schema';
