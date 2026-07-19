alter table sticky.subtasks
  add column if not exists due_date date;

create or replace function sticky.keep_parent_due_after_subtasks()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  latest_subtask_due date;
begin
  select max(due_date)
  into latest_subtask_due
  from sticky.subtasks
  where task_id = new.id
    and user_id = new.user_id;

  if latest_subtask_due is not null
     and (new.due_date is null or new.due_date < latest_subtask_due) then
    raise exception 'The task due date cannot be before its latest subtask due date (%).', latest_subtask_due
      using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists keep_sticky_parent_due_after_subtasks on sticky.tasks;
create trigger keep_sticky_parent_due_after_subtasks
before update of due_date on sticky.tasks
for each row execute function sticky.keep_parent_due_after_subtasks();

create or replace function sticky.extend_parent_due_for_subtask()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  parent_due date;
begin
  if new.due_date is null then
    return new;
  end if;

  select due_date
  into parent_due
  from sticky.tasks
  where id = new.task_id
    and user_id = new.user_id;

  if not found then
    raise exception 'The parent task is not available to this account.' using errcode = '42501';
  end if;

  if parent_due is null or parent_due < new.due_date then
    update sticky.tasks
    set due_date = new.due_date
    where id = new.task_id
      and user_id = new.user_id;
  end if;

  return new;
end;
$$;

drop trigger if exists extend_sticky_parent_due_for_subtask_insert on sticky.subtasks;
create trigger extend_sticky_parent_due_for_subtask_insert
before insert on sticky.subtasks
for each row execute function sticky.extend_parent_due_for_subtask();

drop trigger if exists extend_sticky_parent_due_for_subtask_update on sticky.subtasks;
create trigger extend_sticky_parent_due_for_subtask_update
before update of due_date, task_id, user_id on sticky.subtasks
for each row execute function sticky.extend_parent_due_for_subtask();

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

  select max(nullif(item ->> 'dueDate', '')::date)
  into latest_subtask_due
  from jsonb_array_elements(coalesce(p_subtasks, '[]'::jsonb)) as source(item);

  effective_task_due := case
    when p_due_date is null then latest_subtask_due
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
    p_color, effective_task_due, p_due_time, p_timezone, next_task_order
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

revoke execute on function sticky.keep_parent_due_after_subtasks() from public, anon, authenticated;
revoke execute on function sticky.extend_parent_due_for_subtask() from public, anon, authenticated;
revoke execute on function sticky.create_task_with_subtasks(uuid, text, text, text, date, time, text, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function sticky.create_task_with_subtasks(uuid, text, text, text, date, time, text, jsonb, uuid)
  to service_role;

notify pgrst, 'reload schema';
