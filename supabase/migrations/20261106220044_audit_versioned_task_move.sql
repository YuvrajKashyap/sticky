-- Additive: deploy before the API starts calling move_task_versioned.
-- Keep the existing move_task signature for browser commands and older hosts.
create or replace function sticky.move_task_versioned(
  p_task_id uuid,
  p_target_list_id uuid,
  p_expected_version bigint,
  p_request_user_id uuid default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  request_user_id uuid := sticky.resolve_command_user(p_request_user_id);
  current_version bigint;
begin
  if not sticky.is_active_user(request_user_id) then
    raise exception 'Sticky account is not active.' using errcode = '42501';
  end if;

  select version into current_version
  from sticky.tasks
  where id = p_task_id and user_id = request_user_id
  for update;

  if not found then
    raise exception 'Task is not available to this account.' using errcode = '42501';
  end if;
  if p_expected_version is null or current_version <> p_expected_version then
    -- A version mismatch is an application conflict, not a retryable database
    -- serialization failure. Return it directly through PostgREST.
    raise exception 'Task changed somewhere else. Refresh and try again.' using errcode = 'PT409';
  end if;

  -- The row lock remains held across the existing move and its triggers.
  perform sticky.move_task(p_task_id, p_target_list_id, request_user_id);
end;
$$;

revoke execute on function sticky.move_task_versioned(uuid, uuid, bigint, uuid) from public, anon, authenticated;
grant execute on function sticky.move_task_versioned(uuid, uuid, bigint, uuid) to service_role;
