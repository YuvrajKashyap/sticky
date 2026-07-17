-- Preserve the server-only write boundary while giving atomic RPCs the
-- authenticated Sticky owner that the Hono API already verified.
--
-- The original functions relied exclusively on auth.uid(). Browser writes
-- now pass through the Hono API and execute with the service-role client, so
-- auth.uid() is intentionally null. These replacements accept an explicit
-- owner only from the service_role and continue validating every touched row.

create or replace function sticky.resolve_command_user(p_request_user_id uuid default null)
returns uuid
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  jwt_user_id uuid := (select auth.uid());
begin
  if jwt_user_id is not null then
    if p_request_user_id is not null and p_request_user_id <> jwt_user_id then
      raise exception 'Sticky save ownership does not match the signed-in account.' using errcode = '42501';
    end if;
    return jwt_user_id;
  end if;

  if current_user <> 'service_role' then
    raise exception 'Sticky could not verify save ownership.' using errcode = '42501';
  end if;

  if p_request_user_id is null then
    raise exception 'Sticky could not verify save ownership.' using errcode = '42501';
  end if;

  return p_request_user_id;
end;
$$;

revoke execute on function sticky.resolve_command_user(uuid) from public, anon, authenticated;
grant execute on function sticky.resolve_command_user(uuid) to service_role;

drop function if exists sticky.reorder_lists(uuid[]);
drop function if exists sticky.reorder_tasks(uuid, uuid[]);
drop function if exists sticky.reorder_subtasks(uuid, uuid[]);
drop function if exists sticky.move_task(uuid, uuid);
drop function if exists sticky.set_task_completed(uuid, boolean);
drop function if exists sticky.clear_completed_tasks(uuid);
drop function if exists sticky.complete_task_with_recurrence(uuid, uuid, date, time, integer);
drop function if exists sticky.undo_recurring_completion(uuid, uuid, uuid, integer);
drop function if exists sticky.advance_recurring_task(uuid, date, integer);

create function sticky.reorder_lists(
  p_list_ids uuid[],
  p_request_user_id uuid default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  request_user_id uuid := sticky.resolve_command_user(p_request_user_id);
begin
  if not sticky.is_active_user(request_user_id) then
    raise exception 'Sticky account is not active.' using errcode = '42501';
  end if;

  if coalesce(array_length(p_list_ids, 1), 0) = 0 then
    return;
  end if;

  if (select count(*) <> count(distinct requested.id) from unnest(p_list_ids) as requested(id)) then
    raise exception 'List order contains duplicate ids.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(p_list_ids) as requested(id)
    left join sticky.lists l
      on l.id = requested.id
     and l.user_id = request_user_id
    where l.id is null
  ) then
    raise exception 'List order contains a list outside this account.' using errcode = '42501';
  end if;

  update sticky.lists as l
  set sort_order = ordered.ordinality::integer * 1000
  from unnest(p_list_ids) with ordinality as ordered(id, ordinality)
  where l.id = ordered.id
    and l.user_id = request_user_id;
end;
$$;

create function sticky.reorder_tasks(
  p_list_id uuid,
  p_task_ids uuid[],
  p_request_user_id uuid default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  request_user_id uuid := sticky.resolve_command_user(p_request_user_id);
begin
  if not sticky.is_active_user(request_user_id) then
    raise exception 'Sticky account is not active.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from sticky.lists
    where id = p_list_id
      and user_id = request_user_id
  ) then
    raise exception 'Target list is not available to this account.' using errcode = '42501';
  end if;

  if coalesce(array_length(p_task_ids, 1), 0) = 0 then
    return;
  end if;

  if (select count(*) <> count(distinct requested.id) from unnest(p_task_ids) as requested(id)) then
    raise exception 'Task order contains duplicate ids.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(p_task_ids) as requested(id)
    left join sticky.tasks t
      on t.id = requested.id
     and t.user_id = request_user_id
     and t.list_id = p_list_id
     and t.is_completed = false
    where t.id is null
  ) then
    raise exception 'Task order contains a task outside this active list.' using errcode = '42501';
  end if;

  update sticky.tasks as t
  set sort_order = ordered.ordinality::integer * 1000
  from unnest(p_task_ids) with ordinality as ordered(id, ordinality)
  where t.id = ordered.id
    and t.user_id = request_user_id
    and t.list_id = p_list_id
    and t.is_completed = false;
end;
$$;

create function sticky.reorder_subtasks(
  p_task_id uuid,
  p_subtask_ids uuid[],
  p_request_user_id uuid default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  request_user_id uuid := sticky.resolve_command_user(p_request_user_id);
begin
  if not sticky.is_active_user(request_user_id) then
    raise exception 'Sticky account is not active.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from sticky.tasks
    where id = p_task_id
      and user_id = request_user_id
  ) then
    raise exception 'Parent task is not available to this account.' using errcode = '42501';
  end if;

  if coalesce(array_length(p_subtask_ids, 1), 0) = 0 then
    return;
  end if;

  if (select count(*) <> count(distinct requested.id) from unnest(p_subtask_ids) as requested(id)) then
    raise exception 'Subtask order contains duplicate ids.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(p_subtask_ids) as requested(id)
    left join sticky.subtasks s
      on s.id = requested.id
     and s.user_id = request_user_id
     and s.task_id = p_task_id
    where s.id is null
  ) then
    raise exception 'Subtask order contains an item outside this task.' using errcode = '42501';
  end if;

  update sticky.subtasks as s
  set sort_order = ordered.ordinality::integer * 1000
  from unnest(p_subtask_ids) with ordinality as ordered(id, ordinality)
  where s.id = ordered.id
    and s.user_id = request_user_id
    and s.task_id = p_task_id;
end;
$$;

create function sticky.move_task(
  p_task_id uuid,
  p_target_list_id uuid,
  p_request_user_id uuid default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  request_user_id uuid := sticky.resolve_command_user(p_request_user_id);
  task_is_completed boolean;
  next_order integer;
begin
  if not sticky.is_active_user(request_user_id) then
    raise exception 'Sticky account is not active.' using errcode = '42501';
  end if;

  select is_completed
  into task_is_completed
  from sticky.tasks
  where id = p_task_id
    and user_id = request_user_id
  for update;

  if not found then
    raise exception 'Task is not available to this account.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from sticky.lists
    where id = p_target_list_id
      and user_id = request_user_id
  ) then
    raise exception 'Target list is not available to this account.' using errcode = '42501';
  end if;

  if task_is_completed then
    select coalesce(max(completed_sort_order), 0) + 1000
    into next_order
    from sticky.tasks
    where user_id = request_user_id
      and list_id = p_target_list_id
      and is_completed;

    update sticky.tasks
    set list_id = p_target_list_id,
        completed_sort_order = next_order
    where id = p_task_id
      and user_id = request_user_id;
  else
    select coalesce(max(sort_order), 0) + 1000
    into next_order
    from sticky.tasks
    where user_id = request_user_id
      and list_id = p_target_list_id
      and not is_completed;

    update sticky.tasks
    set list_id = p_target_list_id,
        sort_order = next_order
    where id = p_task_id
      and user_id = request_user_id;
  end if;
end;
$$;

create function sticky.set_task_completed(
  p_task_id uuid,
  p_completed boolean,
  p_request_user_id uuid default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  request_user_id uuid := sticky.resolve_command_user(p_request_user_id);
  task_list_id uuid;
  next_order integer;
begin
  if not sticky.is_active_user(request_user_id) then
    raise exception 'Sticky account is not active.' using errcode = '42501';
  end if;

  select list_id
  into task_list_id
  from sticky.tasks
  where id = p_task_id
    and user_id = request_user_id
  for update;

  if not found then
    raise exception 'Task is not available to this account.' using errcode = '42501';
  end if;

  if p_completed then
    select coalesce(max(completed_sort_order), 0) + 1000
    into next_order
    from sticky.tasks
    where user_id = request_user_id
      and list_id = task_list_id
      and is_completed;

    update sticky.tasks
    set is_completed = true,
        completed_at = now(),
        completed_sort_order = next_order
    where id = p_task_id
      and user_id = request_user_id;
  else
    select coalesce(max(sort_order), 0) + 1000
    into next_order
    from sticky.tasks
    where user_id = request_user_id
      and list_id = task_list_id
      and not is_completed;

    update sticky.tasks
    set is_completed = false,
        completed_at = null,
        completed_sort_order = null,
        sort_order = next_order
    where id = p_task_id
      and user_id = request_user_id;
  end if;
end;
$$;

create function sticky.clear_completed_tasks(
  p_list_id uuid,
  p_request_user_id uuid default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  request_user_id uuid := sticky.resolve_command_user(p_request_user_id);
begin
  if not sticky.is_active_user(request_user_id) then
    raise exception 'Sticky account is not active.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from sticky.lists
    where id = p_list_id
      and user_id = request_user_id
  ) then
    raise exception 'Target list is not available to this account.' using errcode = '42501';
  end if;

  delete from sticky.tasks
  where user_id = request_user_id
    and list_id = p_list_id
    and is_completed;
end;
$$;

create function sticky.complete_task_with_recurrence(
  p_task_id uuid,
  p_next_task_id uuid default null,
  p_next_due_date date default null,
  p_next_due_time time default null,
  p_next_occurrence_count integer default null,
  p_request_user_id uuid default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  request_user_id uuid := sticky.resolve_command_user(p_request_user_id);
  source_task sticky.tasks%rowtype;
  recurrence_rule sticky.task_recurrence_rules%rowtype;
  next_completed_order integer;
  next_active_order integer;
begin
  if not sticky.is_active_user(request_user_id) then
    raise exception 'Sticky account is not active.' using errcode = '42501';
  end if;

  select *
  into source_task
  from sticky.tasks
  where id = p_task_id
    and user_id = request_user_id
  for update;

  if not found then
    raise exception 'Task is not available to this account.' using errcode = '42501';
  end if;

  if source_task.is_completed then
    return;
  end if;

  select coalesce(max(completed_sort_order), 0) + 1000
  into next_completed_order
  from sticky.tasks
  where user_id = request_user_id
    and list_id = source_task.list_id
    and is_completed;

  update sticky.tasks
  set is_completed = true,
      completed_at = now(),
      completed_sort_order = next_completed_order
  where id = source_task.id
    and user_id = request_user_id;

  if p_next_task_id is null then
    return;
  end if;

  if p_next_due_date is null then
    raise exception 'Next recurring task needs a due date.' using errcode = '22023';
  end if;

  select *
  into recurrence_rule
  from sticky.task_recurrence_rules
  where task_id = source_task.id
    and user_id = request_user_id
  for update;

  if not found then
    raise exception 'Recurring rule is not available for this task.' using errcode = '42501';
  end if;

  if recurrence_rule.end_type = 'after_count' and coalesce(p_next_occurrence_count, 0) < 1 then
    raise exception 'Next occurrence count must be positive.' using errcode = '22023';
  end if;

  select coalesce(max(sort_order), 0) + 1000
  into next_active_order
  from sticky.tasks
  where user_id = request_user_id
    and list_id = source_task.list_id
    and not is_completed
    and id <> source_task.id;

  insert into sticky.tasks (
    id, user_id, list_id, title, details, color, due_date, due_time,
    timezone, is_completed, completed_at, sort_order, completed_sort_order
  )
  values (
    p_next_task_id, request_user_id, source_task.list_id, source_task.title,
    source_task.details, source_task.color, p_next_due_date, p_next_due_time,
    source_task.timezone, false, null, next_active_order, null
  );

  update sticky.task_recurrence_rules
  set task_id = p_next_task_id,
      occurrence_count = case
        when recurrence_rule.end_type = 'after_count' then p_next_occurrence_count
        else recurrence_rule.occurrence_count
      end
  where id = recurrence_rule.id
    and user_id = request_user_id;
end;
$$;

create function sticky.undo_recurring_completion(
  p_task_id uuid,
  p_generated_task_id uuid,
  p_recurrence_rule_id uuid,
  p_occurrence_count integer default null,
  p_request_user_id uuid default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  request_user_id uuid := sticky.resolve_command_user(p_request_user_id);
  source_task sticky.tasks%rowtype;
  generated_task sticky.tasks%rowtype;
  recurrence_rule sticky.task_recurrence_rules%rowtype;
  next_active_order integer;
begin
  if not sticky.is_active_user(request_user_id) then
    raise exception 'Sticky account is not active.' using errcode = '42501';
  end if;

  select * into source_task
  from sticky.tasks
  where id = p_task_id and user_id = request_user_id
  for update;

  if not found then
    raise exception 'Completed task is not available to this account.' using errcode = '42501';
  end if;

  select * into generated_task
  from sticky.tasks
  where id = p_generated_task_id and user_id = request_user_id
  for update;

  if not found then
    raise exception 'Generated task is not available to this account.' using errcode = '42501';
  end if;

  select * into recurrence_rule
  from sticky.task_recurrence_rules
  where id = p_recurrence_rule_id
    and user_id = request_user_id
    and task_id = generated_task.id
  for update;

  if not found then
    raise exception 'Recurring rule is not available for undo.' using errcode = '42501';
  end if;

  if recurrence_rule.end_type = 'after_count' and coalesce(p_occurrence_count, 0) < 1 then
    raise exception 'Restored occurrence count must be positive.' using errcode = '22023';
  end if;

  update sticky.task_recurrence_rules
  set task_id = source_task.id,
      occurrence_count = case
        when recurrence_rule.end_type = 'after_count' then p_occurrence_count
        else recurrence_rule.occurrence_count
      end
  where id = recurrence_rule.id
    and user_id = request_user_id;

  delete from sticky.tasks
  where id = generated_task.id
    and user_id = request_user_id;

  select coalesce(max(sort_order), 0) + 1000
  into next_active_order
  from sticky.tasks
  where user_id = request_user_id
    and list_id = source_task.list_id
    and not is_completed;

  update sticky.tasks
  set is_completed = false,
      completed_at = null,
      completed_sort_order = null,
      sort_order = next_active_order
  where id = source_task.id
    and user_id = request_user_id;
end;
$$;

create function sticky.advance_recurring_task(
  p_task_id uuid,
  p_next_due_date date,
  p_next_occurrence_count integer default null,
  p_request_user_id uuid default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  request_user_id uuid := sticky.resolve_command_user(p_request_user_id);
  source_task sticky.tasks%rowtype;
  recurrence_rule sticky.task_recurrence_rules%rowtype;
begin
  if not sticky.is_active_user(request_user_id) then
    raise exception 'Sticky account is not active.' using errcode = '42501';
  end if;

  if p_next_due_date is null then
    raise exception 'Catch-up needs a target due date.' using errcode = '22023';
  end if;

  select * into source_task
  from sticky.tasks
  where id = p_task_id and user_id = request_user_id
  for update;

  if not found then
    raise exception 'Task is not available to this account.' using errcode = '42501';
  end if;

  if source_task.is_completed then
    raise exception 'Completed tasks cannot be advanced.' using errcode = '22023';
  end if;

  select * into recurrence_rule
  from sticky.task_recurrence_rules
  where task_id = source_task.id
    and user_id = request_user_id
  for update;

  if not found then
    raise exception 'Recurring rule is not available for this task.' using errcode = '42501';
  end if;

  if recurrence_rule.paused then
    raise exception 'Paused recurring tasks cannot be advanced.' using errcode = '22023';
  end if;

  if source_task.due_date is not null and p_next_due_date <= source_task.due_date then
    raise exception 'Catch-up due date must be after the current due date.' using errcode = '22023';
  end if;

  if recurrence_rule.end_type = 'on_date' and p_next_due_date > recurrence_rule.end_date then
    raise exception 'Catch-up due date is after the recurrence end date.' using errcode = '22023';
  end if;

  if recurrence_rule.end_type = 'after_count' and coalesce(p_next_occurrence_count, 0) < 1 then
    raise exception 'Catch-up occurrence count must be positive.' using errcode = '22023';
  end if;

  update sticky.tasks
  set due_date = p_next_due_date
  where id = source_task.id
    and user_id = request_user_id;

  if recurrence_rule.end_type = 'after_count' then
    update sticky.task_recurrence_rules
    set occurrence_count = p_next_occurrence_count
    where id = recurrence_rule.id
      and user_id = request_user_id;
  end if;
end;
$$;

revoke execute on function sticky.reorder_lists(uuid[], uuid) from public, anon, authenticated;
revoke execute on function sticky.reorder_tasks(uuid, uuid[], uuid) from public, anon, authenticated;
revoke execute on function sticky.reorder_subtasks(uuid, uuid[], uuid) from public, anon, authenticated;
revoke execute on function sticky.move_task(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function sticky.set_task_completed(uuid, boolean, uuid) from public, anon, authenticated;
revoke execute on function sticky.clear_completed_tasks(uuid, uuid) from public, anon, authenticated;
revoke execute on function sticky.complete_task_with_recurrence(uuid, uuid, date, time, integer, uuid) from public, anon, authenticated;
revoke execute on function sticky.undo_recurring_completion(uuid, uuid, uuid, integer, uuid) from public, anon, authenticated;
revoke execute on function sticky.advance_recurring_task(uuid, date, integer, uuid) from public, anon, authenticated;

grant execute on function sticky.reorder_lists(uuid[], uuid) to service_role;
grant execute on function sticky.reorder_tasks(uuid, uuid[], uuid) to service_role;
grant execute on function sticky.reorder_subtasks(uuid, uuid[], uuid) to service_role;
grant execute on function sticky.move_task(uuid, uuid, uuid) to service_role;
grant execute on function sticky.set_task_completed(uuid, boolean, uuid) to service_role;
grant execute on function sticky.clear_completed_tasks(uuid, uuid) to service_role;
grant execute on function sticky.complete_task_with_recurrence(uuid, uuid, date, time, integer, uuid) to service_role;
grant execute on function sticky.undo_recurring_completion(uuid, uuid, uuid, integer, uuid) to service_role;
grant execute on function sticky.advance_recurring_task(uuid, date, integer, uuid) to service_role;

notify pgrst, 'reload schema';
