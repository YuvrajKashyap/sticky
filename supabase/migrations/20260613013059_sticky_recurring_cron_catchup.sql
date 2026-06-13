-- Service-only catch-up for Vercel Cron recurrence automation.
-- SECURITY INVOKER expects the caller to be service_role and never depends on auth.uid().

create or replace function sticky.advance_recurring_task_for_worker(
  p_task_id uuid,
  p_next_due_date date,
  p_next_occurrence_count integer default null,
  p_reason text default 'recurrence_worker',
  p_skipped_count integer default null
)
returns boolean
language plpgsql
security invoker
set search_path = sticky, public
as $$
declare
  source_task sticky.tasks%rowtype;
  recurrence_rule sticky.task_recurrence_rules%rowtype;
  normalized_reason text := coalesce(nullif(trim(p_reason), ''), 'recurrence_worker');
begin
  if p_task_id is null or p_next_due_date is null then
    return false;
  end if;

  if p_skipped_count is not null and p_skipped_count < 1 then
    return false;
  end if;

  select *
  into source_task
  from sticky.tasks
  where id = p_task_id
  for update;

  if not found then
    return false;
  end if;

  if source_task.is_completed or source_task.due_date is null then
    return false;
  end if;

  if not sticky.is_active_user(source_task.user_id) then
    return false;
  end if;

  select *
  into recurrence_rule
  from sticky.task_recurrence_rules
  where task_id = source_task.id
    and user_id = source_task.user_id
  for update;

  if not found or recurrence_rule.paused then
    return false;
  end if;

  if p_next_due_date <= source_task.due_date then
    return false;
  end if;

  if recurrence_rule.end_type = 'on_date'
     and (recurrence_rule.end_date is null or p_next_due_date > recurrence_rule.end_date) then
    return false;
  end if;

  if recurrence_rule.end_type = 'after_count' and coalesce(p_next_occurrence_count, 0) < 1 then
    return false;
  end if;

  update sticky.tasks
  set due_date = p_next_due_date
  where id = source_task.id
    and user_id = source_task.user_id;

  if recurrence_rule.end_type = 'after_count' then
    update sticky.task_recurrence_rules
    set occurrence_count = p_next_occurrence_count
    where id = recurrence_rule.id
      and user_id = source_task.user_id;
  end if;

  insert into sticky.task_activity (
    user_id,
    task_id,
    list_id,
    action,
    metadata
  )
  values (
    source_task.user_id,
    source_task.id,
    source_task.list_id,
    'recurrence_catch_up',
    jsonb_build_object(
      'reason', normalized_reason,
      'previous_due_date', source_task.due_date,
      'next_due_date', p_next_due_date,
      'skipped_count', p_skipped_count,
      'previous_occurrence_count', recurrence_rule.occurrence_count,
      'next_occurrence_count', case
        when recurrence_rule.end_type = 'after_count' then p_next_occurrence_count
        else recurrence_rule.occurrence_count
      end
    )
  );

  return true;
end;
$$;

revoke execute on function sticky.advance_recurring_task_for_worker(uuid, date, integer, text, integer)
from public, anon, authenticated;

grant execute on function sticky.advance_recurring_task_for_worker(uuid, date, integer, text, integer)
to service_role;

notify pgrst, 'reload schema';
