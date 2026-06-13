-- Atomic completion flow for recurring Sticky tasks.
-- SECURITY INVOKER keeps normal authenticated RLS as the enforcement boundary.

create or replace function sticky.complete_task_with_recurrence(
  p_task_id uuid,
  p_next_task_id uuid default null,
  p_next_due_date date default null,
  p_next_due_time time default null,
  p_next_occurrence_count integer default null
)
returns void
language plpgsql
security invoker
set search_path = sticky, public
as $$
declare
  request_user_id uuid := (select auth.uid());
  source_task sticky.tasks%rowtype;
  recurrence_rule sticky.task_recurrence_rules%rowtype;
  next_completed_order integer;
  next_active_order integer;
begin
  if request_user_id is null or not sticky.is_active_user(request_user_id) then
    raise exception 'Sticky account is not active.' using errcode = '42501';
  end if;

  select *
  into source_task
  from sticky.tasks
  where id = p_task_id
    and user_id = request_user_id
  for update;

  if not found then
    raise exception 'Sticky is not available to this account.' using errcode = '42501';
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
    raise exception 'Next recurring sticky needs a due date.' using errcode = '22023';
  end if;

  select *
  into recurrence_rule
  from sticky.task_recurrence_rules
  where task_id = source_task.id
    and user_id = request_user_id
  for update;

  if not found then
    raise exception 'Recurring rule is not available for this sticky.' using errcode = '42501';
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
    id,
    user_id,
    list_id,
    title,
    details,
    color,
    due_date,
    due_time,
    timezone,
    is_completed,
    completed_at,
    sort_order,
    completed_sort_order
  )
  values (
    p_next_task_id,
    request_user_id,
    source_task.list_id,
    source_task.title,
    source_task.details,
    source_task.color,
    p_next_due_date,
    p_next_due_time,
    source_task.timezone,
    false,
    null,
    next_active_order,
    null
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

create or replace function sticky.undo_recurring_completion(
  p_task_id uuid,
  p_generated_task_id uuid,
  p_recurrence_rule_id uuid,
  p_occurrence_count integer default null
)
returns void
language plpgsql
security invoker
set search_path = sticky, public
as $$
declare
  request_user_id uuid := (select auth.uid());
  source_task sticky.tasks%rowtype;
  generated_task sticky.tasks%rowtype;
  recurrence_rule sticky.task_recurrence_rules%rowtype;
  next_active_order integer;
begin
  if request_user_id is null or not sticky.is_active_user(request_user_id) then
    raise exception 'Sticky account is not active.' using errcode = '42501';
  end if;

  select *
  into source_task
  from sticky.tasks
  where id = p_task_id
    and user_id = request_user_id
  for update;

  if not found then
    raise exception 'Completed sticky is not available to this account.' using errcode = '42501';
  end if;

  select *
  into generated_task
  from sticky.tasks
  where id = p_generated_task_id
    and user_id = request_user_id
  for update;

  if not found then
    raise exception 'Generated sticky is not available to this account.' using errcode = '42501';
  end if;

  select *
  into recurrence_rule
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

revoke execute on function sticky.complete_task_with_recurrence(uuid, uuid, date, time, integer) from public, anon, authenticated;
revoke execute on function sticky.undo_recurring_completion(uuid, uuid, uuid, integer) from public, anon, authenticated;

grant execute on function sticky.complete_task_with_recurrence(uuid, uuid, date, time, integer) to authenticated, service_role;
grant execute on function sticky.undo_recurring_completion(uuid, uuid, uuid, integer) to authenticated, service_role;

notify pgrst, 'reload schema';
