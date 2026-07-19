-- One-time, agent-initiated Google Tasks -> Sticky transfers.
-- This does not create sync links and cannot enable background mirroring.

create unique index if not exists sticky_tasks_google_transfer_dedupe_idx
on sticky.tasks (
  user_id,
  list_id,
  (sync_metadata ->> 'google_task_list_id'),
  (sync_metadata ->> 'google_task_id')
)
where sync_metadata ->> 'source' = 'google_tasks'
  and sync_metadata ? 'google_task_list_id'
  and sync_metadata ? 'google_task_id';

create or replace function sticky.import_google_tasks(
  p_source_list_id text,
  p_target_list_id uuid,
  p_transfer_id uuid,
  p_mode text,
  p_tasks jsonb,
  p_actor_type text,
  p_actor_id text,
  p_credential_id uuid,
  p_request_id text,
  p_idempotency_key text,
  p_request_user_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  request_user_id uuid := sticky.resolve_command_user(p_request_user_id);
  next_active_order integer;
  next_completed_order integer;
  created_count integer := 0;
  supplied_count integer := 0;
begin
  if not sticky.is_active_user(request_user_id) then
    raise exception 'Sticky account is not active.' using errcode = '42501';
  end if;

  if p_mode not in ('copy', 'move') then
    raise exception 'Google task transfer mode must be copy or move.' using errcode = '22023';
  end if;

  if p_actor_type not in ('human', 'agent', 'google', 'workflow', 'webhook') then
    raise exception 'Google task transfer actor type is invalid.' using errcode = '22023';
  end if;

  if nullif(trim(p_source_list_id), '') is null then
    raise exception 'Google task transfer needs a source list id.' using errcode = '22023';
  end if;

  if jsonb_typeof(p_tasks) <> 'array' then
    raise exception 'Google task transfer payload must be an array.' using errcode = '22023';
  end if;

  supplied_count := jsonb_array_length(p_tasks);
  if supplied_count < 1 or supplied_count > 500 then
    raise exception 'Google task transfer must contain between 1 and 500 tasks.' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from sticky.lists
    where id = p_target_list_id
      and user_id = request_user_id
      and archived_at is null
  ) then
    raise exception 'Target Sticky list is not available to this account.' using errcode = '42501';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_tasks) as payload(item)
    where nullif(trim(payload.item ->> 'external_task_id'), '') is null
      or nullif(trim(payload.item ->> 'title'), '') is null
  ) then
    raise exception 'Every Google task needs a stable id and title.' using errcode = '22023';
  end if;

  if (
    select count(*) <> count(distinct payload.item ->> 'external_task_id')
    from jsonb_array_elements(p_tasks) as payload(item)
  ) then
    raise exception 'Google task transfer contains duplicate task ids.' using errcode = '22023';
  end if;

  select coalesce(max(sort_order), 0)
  into next_active_order
  from sticky.tasks
  where user_id = request_user_id
    and list_id = p_target_list_id
    and not is_completed;

  select coalesce(max(completed_sort_order), 0)
  into next_completed_order
  from sticky.tasks
  where user_id = request_user_id
    and list_id = p_target_list_id
    and is_completed;

  with source as materialized (
    select
      payload.ordinality::integer as ordinal,
      payload.item,
      coalesce((payload.item ->> 'is_completed')::boolean, false) as is_completed
    from jsonb_array_elements(p_tasks) with ordinality as payload(item, ordinality)
  )
  insert into sticky.tasks (
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
    completed_sort_order,
    sync_metadata
  )
  select
    request_user_id,
    p_target_list_id,
    left(trim(source.item ->> 'title'), 180),
    left(coalesce(source.item ->> 'details', ''), 20000),
    'sun',
    nullif(source.item ->> 'due_date', '')::date,
    null,
    'America/Chicago',
    source.is_completed,
    case
      when source.is_completed then coalesce(nullif(source.item ->> 'completed_at', '')::timestamptz, now())
      else null
    end,
    next_active_order + source.ordinal * 1000,
    case when source.is_completed then next_completed_order + source.ordinal * 1000 else null end,
    jsonb_strip_nulls(jsonb_build_object(
      'source', 'google_tasks',
      'google_task_list_id', p_source_list_id,
      'google_task_id', source.item ->> 'external_task_id',
      'google_parent_id', nullif(source.item ->> 'parent_id', ''),
      'google_position', nullif(source.item ->> 'position', ''),
      'google_updated_at', nullif(source.item ->> 'updated_at', ''),
      'transfer_id', p_transfer_id,
      'transfer_mode', p_mode
    ))
  from source
  on conflict do nothing;

  get diagnostics created_count = row_count;

  insert into sticky.task_activity (
    user_id,
    action,
    metadata,
    actor_type,
    actor_id,
    credential_id,
    source,
    request_id,
    idempotency_key
  ) values (
    request_user_id,
    'google_tasks.transferred_to_sticky',
    jsonb_build_object(
      'transferId', p_transfer_id,
      'mode', p_mode,
      'googleTaskListId', p_source_list_id,
      'stickyListId', p_target_list_id,
      'suppliedCount', supplied_count,
      'createdCount', created_count,
      'automaticSyncEnabled', false
    ),
    p_actor_type,
    p_actor_id,
    p_credential_id,
    'mcp',
    p_request_id,
    p_idempotency_key
  );

  return jsonb_build_object(
    'transfer_id', p_transfer_id,
    'supplied_count', supplied_count,
    'created_count', created_count,
    'skipped_count', supplied_count - created_count
  );
end;
$$;

revoke execute on function sticky.import_google_tasks(
  text, uuid, uuid, text, jsonb, text, text, uuid, text, text, uuid
) from public, anon, authenticated;

grant execute on function sticky.import_google_tasks(
  text, uuid, uuid, text, jsonb, text, text, uuid, text, text, uuid
) to service_role;

notify pgrst, 'reload schema';
