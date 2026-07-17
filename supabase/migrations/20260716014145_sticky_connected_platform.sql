-- Sticky connected-platform foundation. This migration is additive and preserves all data.
-- The filename matches the version recorded in the production migration ledger.

create or replace function sticky.bump_record_version()
returns trigger
language plpgsql
set search_path = sticky
as $$
begin
  new.version = old.version + 1;
  return new;
end;
$$;

revoke execute on function sticky.bump_record_version() from public, anon, authenticated;
grant execute on function sticky.bump_record_version() to service_role;

alter table sticky.lists
  add column if not exists version integer not null default 1 check (version > 0),
  add column if not exists sync_metadata jsonb not null default '{}'::jsonb;

alter table sticky.tasks
  add column if not exists version integer not null default 1 check (version > 0),
  add column if not exists sync_metadata jsonb not null default '{}'::jsonb;

alter table sticky.subtasks
  add column if not exists version integer not null default 1 check (version > 0),
  add column if not exists sync_metadata jsonb not null default '{}'::jsonb;

drop trigger if exists bump_sticky_lists_version on sticky.lists;
create trigger bump_sticky_lists_version
before update on sticky.lists
for each row execute function sticky.bump_record_version();

drop trigger if exists bump_sticky_tasks_version on sticky.tasks;
create trigger bump_sticky_tasks_version
before update on sticky.tasks
for each row execute function sticky.bump_record_version();

drop trigger if exists bump_sticky_subtasks_version on sticky.subtasks;
create trigger bump_sticky_subtasks_version
before update on sticky.subtasks
for each row execute function sticky.bump_record_version();

alter table sticky.task_activity
  add column if not exists actor_type text not null default 'human'
    check (actor_type in ('human', 'agent', 'google', 'workflow', 'webhook')),
  add column if not exists actor_id text,
  add column if not exists credential_id uuid,
  add column if not exists source text not null default 'web',
  add column if not exists request_id text,
  add column if not exists idempotency_key text;

create index if not exists sticky_task_activity_request_idx
on sticky.task_activity (user_id, request_id)
where request_id is not null;

create table if not exists sticky.task_reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references sticky.users(id) on delete cascade,
  task_id uuid not null references sticky.tasks(id) on delete cascade,
  kind text not null check (kind in ('absolute', 'relative')),
  remind_at timestamptz not null,
  relative_minutes integer check (relative_minutes is null or relative_minutes between 1 and 525600),
  channels text[] not null check (cardinality(channels) > 0 and channels <@ array['push', 'poke']::text[]),
  status text not null default 'scheduled'
    check (status in ('scheduled', 'delivering', 'delivered', 'cancelled', 'failed')),
  workflow_run_id text,
  last_error text,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sticky_reminder_kind_shape check (
    (kind = 'absolute' and relative_minutes is null)
    or (kind = 'relative' and relative_minutes is not null)
  )
);

create trigger set_sticky_task_reminders_updated_at
before update on sticky.task_reminders
for each row execute function sticky.set_updated_at();
create trigger bump_sticky_task_reminders_version
before update on sticky.task_reminders
for each row execute function sticky.bump_record_version();
create index if not exists sticky_reminders_due_idx
on sticky.task_reminders (status, remind_at)
where status = 'scheduled';
create index if not exists sticky_reminders_task_idx
on sticky.task_reminders (user_id, task_id, remind_at);

create table if not exists sticky.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references sticky.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth_secret text not null,
  device_name text,
  user_agent text,
  is_active boolean not null default true,
  expires_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, endpoint)
);
create trigger set_sticky_push_subscriptions_updated_at
before update on sticky.push_subscriptions
for each row execute function sticky.set_updated_at();

create table if not exists sticky.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references sticky.users(id) on delete cascade,
  reminder_id uuid references sticky.task_reminders(id) on delete set null,
  channel text not null check (channel in ('push', 'poke')),
  delivery_key text not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'delivering', 'delivered', 'retrying', 'failed', 'skipped')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  provider_receipt jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_sticky_notification_deliveries_updated_at
before update on sticky.notification_deliveries
for each row execute function sticky.set_updated_at();

create table if not exists sticky.integration_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references sticky.users(id) on delete cascade,
  provider text not null check (provider in ('google_tasks', 'poke')),
  provider_account_id text,
  provider_email text,
  encrypted_credentials text,
  encryption_version smallint not null default 1,
  granted_scopes text[] not null default '{}'::text[],
  status text not null default 'connecting'
    check (status in ('disconnected', 'connecting', 'healthy', 'degraded', 'revoked')),
  connected_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);
create trigger set_sticky_integration_accounts_updated_at
before update on sticky.integration_accounts
for each row execute function sticky.set_updated_at();

create table if not exists sticky.integration_list_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references sticky.users(id) on delete cascade,
  integration_account_id uuid not null references sticky.integration_accounts(id) on delete cascade,
  list_id uuid not null references sticky.lists(id) on delete cascade,
  external_list_id text not null,
  sync_enabled boolean not null default true,
  sync_snapshot jsonb not null default '{}'::jsonb,
  external_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (integration_account_id, list_id),
  unique (integration_account_id, external_list_id)
);
create trigger set_sticky_integration_list_links_updated_at
before update on sticky.integration_list_links
for each row execute function sticky.set_updated_at();

create table if not exists sticky.integration_task_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references sticky.users(id) on delete cascade,
  integration_account_id uuid not null references sticky.integration_accounts(id) on delete cascade,
  task_id uuid not null references sticky.tasks(id) on delete cascade,
  external_task_id text not null,
  external_list_id text not null,
  external_parent_id text,
  external_position text,
  sync_snapshot jsonb not null default '{}'::jsonb,
  external_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (integration_account_id, task_id),
  unique (integration_account_id, external_list_id, external_task_id)
);
create trigger set_sticky_integration_task_links_updated_at
before update on sticky.integration_task_links
for each row execute function sticky.set_updated_at();

create table if not exists sticky.integration_sync_state (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references sticky.users(id) on delete cascade,
  integration_account_id uuid not null references sticky.integration_accounts(id) on delete cascade,
  external_list_id text,
  cursor text,
  last_started_at timestamptz,
  last_succeeded_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  consecutive_failures integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (integration_account_id, external_list_id)
);
create trigger set_sticky_integration_sync_state_updated_at
before update on sticky.integration_sync_state
for each row execute function sticky.set_updated_at();

create table if not exists sticky.outbox_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references sticky.users(id) on delete cascade,
  aggregate_type text not null,
  aggregate_id uuid not null,
  event_type text not null,
  payload jsonb not null,
  idempotency_key text not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'delivered', 'retrying', 'failed', 'cancelled')),
  attempt_count integer not null default 0,
  available_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key, event_type)
);
create trigger set_sticky_outbox_events_updated_at
before update on sticky.outbox_events
for each row execute function sticky.set_updated_at();
create index if not exists sticky_outbox_pending_idx
on sticky.outbox_events (available_at, created_at)
where status in ('pending', 'retrying');

create table if not exists sticky.api_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references sticky.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  provider text not null default 'custom',
  provider_user_id text,
  token_prefix text not null,
  token_hash text not null,
  scopes text[] not null,
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (token_prefix)
);
create index if not exists sticky_api_credentials_active_idx
on sticky.api_credentials (token_prefix)
where revoked_at is null;

create table if not exists sticky.idempotency_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references sticky.users(id) on delete cascade,
  actor_id text not null,
  idempotency_key text not null,
  request_fingerprint text not null,
  response_status integer,
  response_body jsonb,
  locked_until timestamptz not null default (now() + interval '2 minutes'),
  completed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now(),
  unique (user_id, actor_id, idempotency_key)
);

alter table sticky.task_reminders enable row level security;
alter table sticky.push_subscriptions enable row level security;
alter table sticky.notification_deliveries enable row level security;
alter table sticky.integration_accounts enable row level security;
alter table sticky.integration_list_links enable row level security;
alter table sticky.integration_task_links enable row level security;
alter table sticky.integration_sync_state enable row level security;
alter table sticky.outbox_events enable row level security;
alter table sticky.api_credentials enable row level security;
alter table sticky.idempotency_records enable row level security;

create policy "Sticky users can read own reminders"
on sticky.task_reminders for select to authenticated
using (user_id = (select auth.uid()) and sticky.is_active_user((select auth.uid())));

create policy "Sticky users can read own push subscriptions"
on sticky.push_subscriptions for select to authenticated
using (user_id = (select auth.uid()) and sticky.is_active_user((select auth.uid())));

create policy "Sticky users can read own notification deliveries"
on sticky.notification_deliveries for select to authenticated
using (user_id = (select auth.uid()) and sticky.is_active_user((select auth.uid())));

create policy "Sticky users can read own integration status"
on sticky.integration_accounts for select to authenticated
using (user_id = (select auth.uid()) and sticky.is_active_user((select auth.uid())));

create policy "Sticky users can read own integration list links"
on sticky.integration_list_links for select to authenticated
using (user_id = (select auth.uid()) and sticky.is_active_user((select auth.uid())));

create policy "Sticky users can read own integration task links"
on sticky.integration_task_links for select to authenticated
using (user_id = (select auth.uid()) and sticky.is_active_user((select auth.uid())));

create policy "Sticky users can read own integration sync state"
on sticky.integration_sync_state for select to authenticated
using (user_id = (select auth.uid()) and sticky.is_active_user((select auth.uid())));

create policy "Sticky users can read own API credential metadata"
on sticky.api_credentials for select to authenticated
using (user_id = (select auth.uid()) and sticky.is_active_user((select auth.uid())));

grant select on sticky.task_reminders, sticky.push_subscriptions,
  sticky.notification_deliveries, sticky.integration_accounts,
  sticky.integration_list_links, sticky.integration_task_links,
  sticky.integration_sync_state, sticky.api_credentials to authenticated;

grant all on sticky.task_reminders, sticky.push_subscriptions,
  sticky.notification_deliveries, sticky.integration_accounts,
  sticky.integration_list_links, sticky.integration_task_links,
  sticky.integration_sync_state, sticky.outbox_events,
  sticky.api_credentials, sticky.idempotency_records to service_role;

create or replace function sticky.broadcast_user_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := coalesce(new.user_id, old.user_id);
begin
  perform realtime.broadcast_changes(
    'sticky:' || owner_id::text,
    tg_op,
    tg_op,
    tg_table_name,
    tg_table_schema,
    new,
    old
  );
  return null;
end;
$$;

revoke execute on function sticky.broadcast_user_change() from public, anon, authenticated;
grant execute on function sticky.broadcast_user_change() to service_role;

drop trigger if exists broadcast_sticky_lists on sticky.lists;
create trigger broadcast_sticky_lists after insert or update or delete on sticky.lists
for each row execute function sticky.broadcast_user_change();
drop trigger if exists broadcast_sticky_tasks on sticky.tasks;
create trigger broadcast_sticky_tasks after insert or update or delete on sticky.tasks
for each row execute function sticky.broadcast_user_change();
drop trigger if exists broadcast_sticky_subtasks on sticky.subtasks;
create trigger broadcast_sticky_subtasks after insert or update or delete on sticky.subtasks
for each row execute function sticky.broadcast_user_change();
drop trigger if exists broadcast_sticky_reminders on sticky.task_reminders;
create trigger broadcast_sticky_reminders after insert or update or delete on sticky.task_reminders
for each row execute function sticky.broadcast_user_change();

drop policy if exists "Sticky users can receive own broadcasts" on realtime.messages;
create policy "Sticky users can receive own broadcasts"
on realtime.messages for select to authenticated
using (
  realtime.messages.extension = 'broadcast'
  and realtime.topic() = 'sticky:' || (select auth.uid())::text
  and sticky.is_active_user((select auth.uid()))
);

notify pgrst, 'reload schema';
