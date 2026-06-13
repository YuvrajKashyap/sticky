-- Advisor fixes for Sticky helper functions and FK indexes.

create or replace function sticky.set_updated_at()
returns trigger
language plpgsql
set search_path = sticky
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function sticky.prevent_recurrence_with_subtasks()
returns trigger
language plpgsql
set search_path = sticky
as $$
begin
  if exists (
    select 1 from sticky.subtasks
    where task_id = new.task_id
      and user_id = new.user_id
  ) then
    raise exception 'Repeating stickies cannot have subtasks.';
  end if;
  return new;
end;
$$;

create or replace function sticky.prevent_subtask_on_recurring_task()
returns trigger
language plpgsql
set search_path = sticky
as $$
begin
  if exists (
    select 1 from sticky.task_recurrence_rules
    where task_id = new.task_id
      and user_id = new.user_id
  ) then
    raise exception 'Repeating stickies cannot have subtasks.';
  end if;
  return new;
end;
$$;

create index if not exists sticky_allowed_emails_invited_by_idx
on sticky.allowed_emails (invited_by)
where invited_by is not null;

create index if not exists sticky_user_state_selected_list_id_idx
on sticky.user_state (selected_list_id)
where selected_list_id is not null;

create index if not exists sticky_tasks_list_id_idx
on sticky.tasks (list_id);

create index if not exists sticky_subtasks_task_id_idx
on sticky.subtasks (task_id);

create index if not exists sticky_task_activity_task_id_idx
on sticky.task_activity (task_id)
where task_id is not null;

create index if not exists sticky_task_activity_list_id_idx
on sticky.task_activity (list_id)
where list_id is not null;
