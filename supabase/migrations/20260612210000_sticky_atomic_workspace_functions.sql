-- Atomic workspace operations for Sticky's reorder, movement, completion, and bulk-clear flows.
-- These functions are SECURITY INVOKER so normal authenticated RLS remains the enforcement layer.

create or replace function sticky.reorder_lists(p_list_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = sticky, public
as $$
declare
  request_user_id uuid := (select auth.uid());
begin
  if request_user_id is null or not sticky.is_active_user(request_user_id) then
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

create or replace function sticky.reorder_tasks(p_list_id uuid, p_task_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = sticky, public
as $$
declare
  request_user_id uuid := (select auth.uid());
begin
  if request_user_id is null or not sticky.is_active_user(request_user_id) then
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
    raise exception 'Task order contains a sticky outside this active list.' using errcode = '42501';
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

create or replace function sticky.reorder_subtasks(p_task_id uuid, p_subtask_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = sticky, public
as $$
declare
  request_user_id uuid := (select auth.uid());
begin
  if request_user_id is null or not sticky.is_active_user(request_user_id) then
    raise exception 'Sticky account is not active.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from sticky.tasks
    where id = p_task_id
      and user_id = request_user_id
  ) then
    raise exception 'Parent sticky is not available to this account.' using errcode = '42501';
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
    raise exception 'Subtask order contains an item outside this sticky.' using errcode = '42501';
  end if;

  update sticky.subtasks as s
  set sort_order = ordered.ordinality::integer * 1000
  from unnest(p_subtask_ids) with ordinality as ordered(id, ordinality)
  where s.id = ordered.id
    and s.user_id = request_user_id
    and s.task_id = p_task_id;
end;
$$;

create or replace function sticky.move_task(p_task_id uuid, p_target_list_id uuid)
returns void
language plpgsql
security invoker
set search_path = sticky, public
as $$
declare
  request_user_id uuid := (select auth.uid());
  task_is_completed boolean;
  next_order integer;
begin
  if request_user_id is null or not sticky.is_active_user(request_user_id) then
    raise exception 'Sticky account is not active.' using errcode = '42501';
  end if;

  select is_completed
  into task_is_completed
  from sticky.tasks
  where id = p_task_id
    and user_id = request_user_id
  for update;

  if not found then
    raise exception 'Sticky is not available to this account.' using errcode = '42501';
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

create or replace function sticky.set_task_completed(p_task_id uuid, p_completed boolean)
returns void
language plpgsql
security invoker
set search_path = sticky, public
as $$
declare
  request_user_id uuid := (select auth.uid());
  task_list_id uuid;
  next_order integer;
begin
  if request_user_id is null or not sticky.is_active_user(request_user_id) then
    raise exception 'Sticky account is not active.' using errcode = '42501';
  end if;

  select list_id
  into task_list_id
  from sticky.tasks
  where id = p_task_id
    and user_id = request_user_id
  for update;

  if not found then
    raise exception 'Sticky is not available to this account.' using errcode = '42501';
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

create or replace function sticky.clear_completed_tasks(p_list_id uuid)
returns void
language plpgsql
security invoker
set search_path = sticky, public
as $$
declare
  request_user_id uuid := (select auth.uid());
begin
  if request_user_id is null or not sticky.is_active_user(request_user_id) then
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

revoke execute on function sticky.reorder_lists(uuid[]) from public, anon, authenticated;
revoke execute on function sticky.reorder_tasks(uuid, uuid[]) from public, anon, authenticated;
revoke execute on function sticky.reorder_subtasks(uuid, uuid[]) from public, anon, authenticated;
revoke execute on function sticky.move_task(uuid, uuid) from public, anon, authenticated;
revoke execute on function sticky.set_task_completed(uuid, boolean) from public, anon, authenticated;
revoke execute on function sticky.clear_completed_tasks(uuid) from public, anon, authenticated;

grant execute on function sticky.reorder_lists(uuid[]) to authenticated, service_role;
grant execute on function sticky.reorder_tasks(uuid, uuid[]) to authenticated, service_role;
grant execute on function sticky.reorder_subtasks(uuid, uuid[]) to authenticated, service_role;
grant execute on function sticky.move_task(uuid, uuid) to authenticated, service_role;
grant execute on function sticky.set_task_completed(uuid, boolean) to authenticated, service_role;
grant execute on function sticky.clear_completed_tasks(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
