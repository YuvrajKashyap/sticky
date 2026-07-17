-- The filename matches the version recorded in the production migration ledger.
create or replace function sticky.enqueue_connected_outbox()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid;
  v_aggregate_id uuid;
  v_aggregate_type text;
  v_event_type text;
  v_event_payload jsonb;
  v_external_links jsonb := '[]'::jsonb;
begin
  v_owner_id := coalesce(new.user_id, old.user_id);
  v_aggregate_id := coalesce(new.id, old.id);
  v_aggregate_type := case when tg_table_name = 'tasks' then 'task' else 'list' end;
  v_event_type := v_aggregate_type || case when tg_op = 'DELETE' then '.deleted' else '.upserted' end;
  v_event_payload := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;

  if tg_op = 'DELETE' and tg_table_name = 'tasks' then
    select coalesce(
      jsonb_agg(jsonb_build_object(
        'integrationAccountId', link.integration_account_id,
        'externalListId', link.external_list_id,
        'externalTaskId', link.external_task_id
      )),
      '[]'::jsonb
    )
    into v_external_links
    from sticky.integration_task_links as link
    where link.task_id = old.id;

    v_event_payload := v_event_payload || jsonb_build_object('externalLinks', v_external_links);
  end if;

  insert into sticky.outbox_events (
    user_id,
    aggregate_type,
    aggregate_id,
    event_type,
    payload,
    idempotency_key
  ) values (
    v_owner_id,
    v_aggregate_type,
    v_aggregate_id,
    v_event_type,
    v_event_payload,
    'db:' || tg_table_name || ':' || v_aggregate_id::text || ':' || txid_current()::text || ':' || lower(tg_op)
  )
  on conflict on constraint outbox_events_user_id_idempotency_key_event_type_key do nothing;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke execute on function sticky.enqueue_connected_outbox() from public, anon, authenticated;
grant execute on function sticky.enqueue_connected_outbox() to service_role;
