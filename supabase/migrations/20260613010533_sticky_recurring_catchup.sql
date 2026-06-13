-- User-controlled catch-up for overdue recurring Sticky tasks.
-- SECURITY INVOKER keeps authenticated RLS as the enforcement boundary.

create or replace function sticky.advance_recurring_task(
  p_task_id uuid,
  p_next_due_date date,
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
begin
  if request_user_id is null or not sticky.is_active_user(request_user_id) then
    raise exception 'Sticky account is not active.' using errcode = '42501';
  end if;

  if p_next_due_date is null then
    raise exception 'Catch-up needs a target due date.' using errcode = '22023';
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
    raise exception 'Completed stickies cannot be advanced.' using errcode = '22023';
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

  if recurrence_rule.paused then
    raise exception 'Paused recurring stickies cannot be advanced.' using errcode = '22023';
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

revoke execute on function sticky.advance_recurring_task(uuid, date, integer) from public, anon, authenticated;

grant execute on function sticky.advance_recurring_task(uuid, date, integer) to authenticated, service_role;

notify pgrst, 'reload schema';
