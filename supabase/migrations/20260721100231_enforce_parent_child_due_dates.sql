create or replace function sticky.keep_parent_due_after_subtasks()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  has_undated_subtask boolean;
  latest_subtask_due date;
begin
  select
    coalesce(bool_or(due_date is null), false),
    max(due_date)
  into has_undated_subtask, latest_subtask_due
  from sticky.subtasks
  where task_id = new.id
    and user_id = new.user_id;

  if new.due_date is null then
    new.due_time := null;
    return new;
  end if;

  if has_undated_subtask then
    raise exception 'A parent task cannot have a due date while any of its subtasks has no due date.'
      using errcode = '22023';
  end if;

  if latest_subtask_due is not null and new.due_date < latest_subtask_due then
    raise exception 'The parent task due date cannot be before its latest subtask due date (%).', latest_subtask_due
      using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists extend_sticky_parent_due_for_subtask_insert on sticky.subtasks;
drop trigger if exists extend_sticky_parent_due_for_subtask_update on sticky.subtasks;
drop function if exists sticky.extend_parent_due_for_subtask();

create or replace function sticky.reconcile_parent_due_for_subtask_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  affected_task_ids uuid[];
  affected_user_ids uuid[];
  affected_index integer;
  has_undated_subtask boolean;
  latest_subtask_due date;
  parent_due date;
begin
  if tg_op = 'INSERT' then
    affected_task_ids := array[new.task_id];
    affected_user_ids := array[new.user_id];
  elsif tg_op = 'DELETE' then
    affected_task_ids := array[old.task_id];
    affected_user_ids := array[old.user_id];
  else
    affected_task_ids := array[old.task_id, new.task_id];
    affected_user_ids := array[old.user_id, new.user_id];
  end if;

  for affected_index in 1..array_length(affected_task_ids, 1) loop
    if affected_index > 1
       and affected_task_ids[affected_index] = affected_task_ids[1]
       and affected_user_ids[affected_index] = affected_user_ids[1] then
      continue;
    end if;

    select
      coalesce(bool_or(due_date is null), false),
      max(due_date)
    into has_undated_subtask, latest_subtask_due
    from sticky.subtasks
    where task_id = affected_task_ids[affected_index]
      and user_id = affected_user_ids[affected_index];

    select due_date
    into parent_due
    from sticky.tasks
    where id = affected_task_ids[affected_index]
      and user_id = affected_user_ids[affected_index];

    if not found then
      continue;
    end if;

    if has_undated_subtask then
      update sticky.tasks
      set due_date = null,
          due_time = null
      where id = affected_task_ids[affected_index]
        and user_id = affected_user_ids[affected_index]
        and (due_date is not null or due_time is not null);
    elsif parent_due is not null
       and latest_subtask_due is not null
       and parent_due < latest_subtask_due then
      update sticky.tasks
      set due_date = latest_subtask_due
      where id = affected_task_ids[affected_index]
        and user_id = affected_user_ids[affected_index];
    end if;
  end loop;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists reconcile_sticky_parent_due_after_subtask_insert on sticky.subtasks;
drop trigger if exists reconcile_sticky_parent_due_after_subtask_update on sticky.subtasks;
drop trigger if exists reconcile_sticky_parent_due_after_subtask_delete on sticky.subtasks;

create trigger reconcile_sticky_parent_due_after_subtask_insert
after insert on sticky.subtasks
for each row execute function sticky.reconcile_parent_due_for_subtask_change();

create trigger reconcile_sticky_parent_due_after_subtask_update
after update of due_date, task_id, user_id on sticky.subtasks
for each row execute function sticky.reconcile_parent_due_for_subtask_change();

create trigger reconcile_sticky_parent_due_after_subtask_delete
after delete on sticky.subtasks
for each row execute function sticky.reconcile_parent_due_for_subtask_change();

drop function if exists sticky.create_task_with_subtasks(uuid, text, text, text, date, time, text, jsonb, uuid);
create or replace function sticky.create_task_with_subtasks(
  p_list_id uuid,
  p_title text,
  p_details text default '',
  p_color text default 'sun',
  p_due_date date default null,
  p_due_time time default null,
  p_timezone text default 'America/Chicago',
  p_subtasks jsonb default '[]'::jsonb,
  p_request_user_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  request_user_id uuid := sticky.resolve_command_user(p_request_user_id);
  created_task_id uuid := gen_random_uuid();
  next_task_order integer;
  has_undated_subtask boolean;
  latest_subtask_due date;
  effective_task_due date;
begin
  if not sticky.is_active_user(request_user_id) then
    raise exception 'Sticky account is not active.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from sticky.lists
    where id = p_list_id
      and user_id = request_user_id
      and archived_at is null
  ) then
    raise exception 'The destination Sticky list is not available.' using errcode = '42501';
  end if;

  if char_length(trim(coalesce(p_title, ''))) not between 1 and 180 then
    raise exception 'A task title must contain between 1 and 180 characters.' using errcode = '22023';
  end if;

  if jsonb_typeof(coalesce(p_subtasks, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_subtasks, '[]'::jsonb)) > 100 then
    raise exception 'Subtasks must be an array containing at most 100 items.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_subtasks, '[]'::jsonb)) as source(item)
    where char_length(trim(coalesce(item ->> 'title', ''))) not between 1 and 160
  ) then
    raise exception 'Every subtask needs a title between 1 and 160 characters.' using errcode = '22023';
  end if;

  select
    coalesce(bool_or(nullif(item ->> 'dueDate', '') is null), false),
    max(nullif(item ->> 'dueDate', '')::date)
  into has_undated_subtask, latest_subtask_due
  from jsonb_array_elements(coalesce(p_subtasks, '[]'::jsonb)) as source(item);

  effective_task_due := case
    when has_undated_subtask then null
    when p_due_date is null then null
    when latest_subtask_due is null then p_due_date
    else greatest(p_due_date, latest_subtask_due)
  end;

  select coalesce(max(sort_order), 0) + 1000
  into next_task_order
  from sticky.tasks
  where user_id = request_user_id
    and list_id = p_list_id
    and is_completed = false;

  insert into sticky.tasks (
    id, user_id, list_id, title, details, color, due_date, due_time, timezone, sort_order
  ) values (
    created_task_id, request_user_id, p_list_id, trim(p_title), coalesce(p_details, ''),
    p_color, effective_task_due, case when effective_task_due is null then null else p_due_time end,
    p_timezone, next_task_order
  );

  insert into sticky.subtasks (user_id, task_id, title, due_date, sort_order)
  select
    request_user_id,
    created_task_id,
    trim(source.item ->> 'title'),
    nullif(source.item ->> 'dueDate', '')::date,
    source.position::integer * 1000
  from jsonb_array_elements(coalesce(p_subtasks, '[]'::jsonb))
    with ordinality as source(item, position);

  return created_task_id;
end;
$$;

with child_rollup as (
  select
    task_id,
    user_id,
    coalesce(bool_or(due_date is null), false) as has_undated_subtask,
    max(due_date) as latest_subtask_due
  from sticky.subtasks
  group by task_id, user_id
)
update sticky.tasks as parent
set due_date = null,
    due_time = null
from child_rollup
where parent.id = child_rollup.task_id
  and parent.user_id = child_rollup.user_id
  and child_rollup.has_undated_subtask
  and (parent.due_date is not null or parent.due_time is not null);

with child_rollup as (
  select
    task_id,
    user_id,
    coalesce(bool_or(due_date is null), false) as has_undated_subtask,
    max(due_date) as latest_subtask_due
  from sticky.subtasks
  group by task_id, user_id
)
update sticky.tasks as parent
set due_date = child_rollup.latest_subtask_due
from child_rollup
where parent.id = child_rollup.task_id
  and parent.user_id = child_rollup.user_id
  and not child_rollup.has_undated_subtask
  and parent.due_date is not null
  and child_rollup.latest_subtask_due > parent.due_date;

revoke execute on function sticky.keep_parent_due_after_subtasks() from public, anon, authenticated;
revoke execute on function sticky.reconcile_parent_due_for_subtask_change() from public, anon, authenticated;
revoke execute on function sticky.create_task_with_subtasks(uuid, text, text, text, date, time, text, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function sticky.create_task_with_subtasks(uuid, text, text, text, date, time, text, jsonb, uuid)
  to service_role;

notify pgrst, 'reload schema';
