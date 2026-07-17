-- First-class Sticky calendars and events. Tasks keep due dates; events model
-- time commitments and can be linked to tasks for time blocking.

create table if not exists sticky.calendars (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references sticky.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  color text not null default 'sky'
    check (color in ('sun','coral','mint','sky','violet','ink','ember','rose','lime','teal','azure','magenta')),
  timezone text not null default 'America/Chicago',
  is_default boolean not null default false,
  is_visible boolean not null default true,
  archived_at timestamptz,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists sticky_calendars_one_default_idx
on sticky.calendars (user_id)
where is_default and archived_at is null;

create index if not exists sticky_calendars_user_visible_idx
on sticky.calendars (user_id, is_visible, archived_at);

create trigger set_sticky_calendars_updated_at
before update on sticky.calendars
for each row execute function sticky.set_updated_at();

create trigger bump_sticky_calendars_version
before update on sticky.calendars
for each row execute function sticky.bump_record_version();

create table if not exists sticky.calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references sticky.users(id) on delete cascade,
  calendar_id uuid not null references sticky.calendars(id) on delete cascade,
  task_id uuid references sticky.tasks(id) on delete set null,
  title text not null check (char_length(trim(title)) between 1 and 240),
  details text not null default '' check (char_length(details) <= 20000),
  location text not null default '' check (char_length(location) <= 500),
  all_day boolean not null default false,
  start_at timestamptz,
  end_at timestamptz,
  start_date date,
  end_date date,
  timezone text not null default 'America/Chicago',
  recurrence text[] not null default '{}'::text[],
  status text not null default 'confirmed'
    check (status in ('confirmed', 'tentative', 'cancelled')),
  transparency text not null default 'opaque'
    check (transparency in ('opaque', 'transparent')),
  color text
    check (color is null or color in ('sun','coral','mint','sky','violet','ink','ember','rose','lime','teal','azure','magenta')),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sticky_calendar_events_schedule_check check (
    (
      all_day
      and start_date is not null
      and end_date is not null
      and end_date > start_date
      and start_at is null
      and end_at is null
    )
    or
    (
      not all_day
      and start_at is not null
      and end_at is not null
      and end_at > start_at
      and start_date is null
      and end_date is null
    )
  )
);

create index if not exists sticky_calendar_events_user_start_idx
on sticky.calendar_events (user_id, start_at)
where not all_day and status <> 'cancelled';

create index if not exists sticky_calendar_events_user_date_idx
on sticky.calendar_events (user_id, start_date)
where all_day and status <> 'cancelled';

create index if not exists sticky_calendar_events_calendar_idx
on sticky.calendar_events (calendar_id);

create index if not exists sticky_calendar_events_task_idx
on sticky.calendar_events (task_id)
where task_id is not null;

create trigger set_sticky_calendar_events_updated_at
before update on sticky.calendar_events
for each row execute function sticky.set_updated_at();

create trigger bump_sticky_calendar_events_version
before update on sticky.calendar_events
for each row execute function sticky.bump_record_version();

alter table sticky.integration_accounts
drop constraint if exists integration_accounts_provider_check;

alter table sticky.integration_accounts
add constraint integration_accounts_provider_check
check (provider in ('google_tasks', 'google_workspace', 'poke'));

create table if not exists sticky.integration_calendar_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references sticky.users(id) on delete cascade,
  integration_account_id uuid not null references sticky.integration_accounts(id) on delete cascade,
  calendar_id uuid not null references sticky.calendars(id) on delete cascade,
  external_calendar_id text not null,
  sync_enabled boolean not null default true,
  sync_direction text not null default 'two_way'
    check (sync_direction in ('two_way', 'import_only', 'export_only')),
  is_default_target boolean not null default false,
  external_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (integration_account_id, calendar_id),
  unique (integration_account_id, external_calendar_id)
);

create unique index if not exists sticky_integration_calendar_default_target_idx
on sticky.integration_calendar_links (integration_account_id)
where is_default_target and sync_enabled;

create index if not exists sticky_integration_calendar_links_user_idx
on sticky.integration_calendar_links (user_id);

create index if not exists sticky_integration_calendar_links_calendar_idx
on sticky.integration_calendar_links (calendar_id);

create trigger set_sticky_integration_calendar_links_updated_at
before update on sticky.integration_calendar_links
for each row execute function sticky.set_updated_at();

create table if not exists sticky.integration_event_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references sticky.users(id) on delete cascade,
  integration_account_id uuid not null references sticky.integration_accounts(id) on delete cascade,
  event_id uuid not null references sticky.calendar_events(id) on delete cascade,
  external_calendar_id text not null,
  external_event_id text not null,
  external_etag text,
  external_html_link text,
  sync_snapshot jsonb not null default '{}'::jsonb,
  external_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (integration_account_id, event_id),
  unique (integration_account_id, external_calendar_id, external_event_id)
);

create index if not exists sticky_integration_event_links_user_idx
on sticky.integration_event_links (user_id);

create index if not exists sticky_integration_event_links_event_idx
on sticky.integration_event_links (event_id);

create trigger set_sticky_integration_event_links_updated_at
before update on sticky.integration_event_links
for each row execute function sticky.set_updated_at();

create table if not exists sticky.integration_calendar_sync_state (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references sticky.users(id) on delete cascade,
  integration_account_id uuid not null references sticky.integration_accounts(id) on delete cascade,
  external_calendar_id text not null,
  sync_token text,
  last_started_at timestamptz,
  last_succeeded_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (integration_account_id, external_calendar_id)
);

create index if not exists sticky_integration_calendar_sync_state_user_idx
on sticky.integration_calendar_sync_state (user_id);

create trigger set_sticky_integration_calendar_sync_state_updated_at
before update on sticky.integration_calendar_sync_state
for each row execute function sticky.set_updated_at();

insert into sticky.calendars (user_id, name, color, timezone, is_default)
select u.id, 'Sticky', 'sky', 'America/Chicago', true
from sticky.users u
where u.is_active
  and not exists (
    select 1 from sticky.calendars c
    where c.user_id = u.id and c.is_default and c.archived_at is null
  );

alter table sticky.calendars enable row level security;
alter table sticky.calendar_events enable row level security;
alter table sticky.integration_calendar_links enable row level security;
alter table sticky.integration_event_links enable row level security;
alter table sticky.integration_calendar_sync_state enable row level security;

create policy "Sticky users can read own calendars"
on sticky.calendars for select to authenticated
using (user_id = (select auth.uid()) and sticky.is_active_user((select auth.uid())));

create policy "Sticky users can read own calendar events"
on sticky.calendar_events for select to authenticated
using (user_id = (select auth.uid()) and sticky.is_active_user((select auth.uid())));

create policy "Sticky users can read own calendar links"
on sticky.integration_calendar_links for select to authenticated
using (user_id = (select auth.uid()) and sticky.is_active_user((select auth.uid())));

create policy "Sticky users can read own event links"
on sticky.integration_event_links for select to authenticated
using (user_id = (select auth.uid()) and sticky.is_active_user((select auth.uid())));

create policy "Sticky users can read own calendar sync state"
on sticky.integration_calendar_sync_state for select to authenticated
using (user_id = (select auth.uid()) and sticky.is_active_user((select auth.uid())));

grant select on sticky.calendars, sticky.calendar_events,
  sticky.integration_calendar_links, sticky.integration_event_links,
  sticky.integration_calendar_sync_state to authenticated;

revoke insert, update, delete on sticky.calendars, sticky.calendar_events,
  sticky.integration_calendar_links, sticky.integration_event_links,
  sticky.integration_calendar_sync_state from authenticated;

grant all on sticky.calendars, sticky.calendar_events,
  sticky.integration_calendar_links, sticky.integration_event_links,
  sticky.integration_calendar_sync_state to service_role;

drop trigger if exists broadcast_sticky_calendars on sticky.calendars;
create trigger broadcast_sticky_calendars
after insert or update or delete on sticky.calendars
for each row execute function sticky.broadcast_user_change();

drop trigger if exists broadcast_sticky_calendar_events on sticky.calendar_events;
create trigger broadcast_sticky_calendar_events
after insert or update or delete on sticky.calendar_events
for each row execute function sticky.broadcast_user_change();

create or replace function sticky.enqueue_calendar_outbox()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := coalesce(new.user_id, old.user_id);
  aggregate_id uuid := coalesce(new.id, old.id);
  event_payload jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  external_links jsonb := '[]'::jsonb;
begin
  if tg_op = 'DELETE' then
    select coalesce(
      jsonb_agg(jsonb_build_object(
        'integrationAccountId', link.integration_account_id,
        'externalCalendarId', link.external_calendar_id,
        'externalEventId', link.external_event_id
      )),
      '[]'::jsonb
    )
    into external_links
    from sticky.integration_event_links link
    where link.event_id = old.id;

    event_payload := event_payload || jsonb_build_object('externalLinks', external_links);
  end if;

  insert into sticky.outbox_events (
    user_id, aggregate_type, aggregate_id, event_type, payload, idempotency_key
  ) values (
    owner_id,
    'calendar_event',
    aggregate_id,
    case when tg_op = 'DELETE' then 'calendar_event.deleted' else 'calendar_event.upserted' end,
    event_payload,
    'db:calendar_events:' || aggregate_id::text || ':' || txid_current()::text || ':' || lower(tg_op)
  )
  on conflict on constraint outbox_events_user_id_idempotency_key_event_type_key do nothing;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke execute on function sticky.enqueue_calendar_outbox() from public, anon, authenticated;
grant execute on function sticky.enqueue_calendar_outbox() to service_role;

drop trigger if exists queue_sticky_calendar_events_outbox_upsert on sticky.calendar_events;
create trigger queue_sticky_calendar_events_outbox_upsert
after insert or update on sticky.calendar_events
for each row execute function sticky.enqueue_calendar_outbox();

drop trigger if exists queue_sticky_calendar_events_outbox_delete on sticky.calendar_events;
create trigger queue_sticky_calendar_events_outbox_delete
before delete on sticky.calendar_events
for each row execute function sticky.enqueue_calendar_outbox();

notify pgrst, 'reload schema';
