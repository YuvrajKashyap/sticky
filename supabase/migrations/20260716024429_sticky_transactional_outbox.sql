-- Queue provider work in the same transaction as every list/task mutation.
-- The filename matches the version recorded in the production migration ledger.
-- The delete trigger runs before cascading integration mappings disappear.
create or replace function sticky.enqueue_connected_outbox()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid;
  aggregate_id uuid;
  aggregate_type text;
  event_type text;
  event_payload jsonb;
  external_links jsonb := '[]'::jsonb;
begin
  owner_id := coalesce(new.user_id, old.user_id);
  aggregate_id := coalesce(new.id, old.id);
  aggregate_type := case when tg_table_name = 'tasks' then 'task' else 'list' end;
  event_type := aggregate_type || case when tg_op = 'DELETE' then '.deleted' else '.upserted' end;
  event_payload := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;

  if tg_op = 'DELETE' and tg_table_name = 'tasks' then
    select coalesce(
      jsonb_agg(jsonb_build_object(
        'integrationAccountId', link.integration_account_id,
        'externalListId', link.external_list_id,
        'externalTaskId', link.external_task_id
      )),
      '[]'::jsonb
    )
    into external_links
    from sticky.integration_task_links as link
    where link.task_id = old.id;

    event_payload := event_payload || jsonb_build_object('externalLinks', external_links);
  end if;

  insert into sticky.outbox_events (
    user_id,
    aggregate_type,
    aggregate_id,
    event_type,
    payload,
    idempotency_key
  ) values (
    owner_id,
    aggregate_type,
    aggregate_id,
    event_type,
    event_payload,
    'db:' || tg_table_name || ':' || aggregate_id::text || ':' || txid_current()::text || ':' || lower(tg_op)
  )
  on conflict (user_id, idempotency_key, event_type) do nothing;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke execute on function sticky.enqueue_connected_outbox() from public, anon, authenticated;
grant execute on function sticky.enqueue_connected_outbox() to service_role;

drop trigger if exists queue_sticky_lists_outbox_upsert on sticky.lists;
create trigger queue_sticky_lists_outbox_upsert
after insert or update on sticky.lists
for each row execute function sticky.enqueue_connected_outbox();

drop trigger if exists queue_sticky_lists_outbox_delete on sticky.lists;
create trigger queue_sticky_lists_outbox_delete
before delete on sticky.lists
for each row execute function sticky.enqueue_connected_outbox();

drop trigger if exists queue_sticky_tasks_outbox_upsert on sticky.tasks;
create trigger queue_sticky_tasks_outbox_upsert
after insert or update on sticky.tasks
for each row execute function sticky.enqueue_connected_outbox();

drop trigger if exists queue_sticky_tasks_outbox_delete on sticky.tasks;
create trigger queue_sticky_tasks_outbox_delete
before delete on sticky.tasks
for each row execute function sticky.enqueue_connected_outbox();

-- Production browser sessions are read-only at the database boundary. Hono is
-- the only write path and executes with the server-only Supabase credential.
revoke insert, update, delete on sticky.user_state from authenticated;
revoke insert, update, delete on sticky.user_preferences from authenticated;
revoke insert, update, delete on sticky.lists from authenticated;
revoke insert, update, delete on sticky.tasks from authenticated;
revoke insert, update, delete on sticky.subtasks from authenticated;
revoke insert, update, delete on sticky.task_recurrence_rules from authenticated;

revoke execute on function sticky.reorder_lists(uuid[]) from authenticated;
revoke execute on function sticky.reorder_tasks(uuid, uuid[]) from authenticated;
revoke execute on function sticky.reorder_subtasks(uuid, uuid[]) from authenticated;
revoke execute on function sticky.move_task(uuid, uuid) from authenticated;
revoke execute on function sticky.set_task_completed(uuid, boolean) from authenticated;
revoke execute on function sticky.clear_completed_tasks(uuid) from authenticated;
revoke execute on function sticky.complete_task_with_recurrence(uuid, uuid, date, time, integer) from authenticated;
revoke execute on function sticky.undo_recurring_completion(uuid, uuid, uuid, integer) from authenticated;
revoke execute on function sticky.advance_recurring_task(uuid, date, integer) from authenticated;

notify pgrst, 'reload schema';
