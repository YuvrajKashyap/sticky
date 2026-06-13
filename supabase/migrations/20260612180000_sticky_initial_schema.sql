-- Sticky production schema for the shared yk-platform Supabase project.
-- Scope: this migration only creates and grants objects in sticky.*.

create schema if not exists sticky;

grant usage on schema sticky to authenticated, service_role;

create or replace function sticky.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists sticky.allowed_emails (
  email text primary key,
  role text not null default 'owner' check (role in ('owner', 'member')),
  is_active boolean not null default true,
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists sticky.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text,
  role text not null default 'member' check (role in ('owner', 'member')),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz
);

create trigger set_sticky_users_updated_at
before update on sticky.users
for each row execute function sticky.set_updated_at();

create table if not exists sticky.user_state (
  user_id uuid primary key references sticky.users(id) on delete cascade,
  selected_list_id uuid,
  search_query text not null default '',
  last_opened_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_sticky_user_state_updated_at
before update on sticky.user_state
for each row execute function sticky.set_updated_at();

create table if not exists sticky.user_preferences (
  user_id uuid primary key references sticky.users(id) on delete cascade,
  completed_open_by_list jsonb not null default '{}'::jsonb,
  density text not null default 'comfortable' check (density in ('compact', 'comfortable')),
  color_mode text not null default 'system' check (color_mode in ('system', 'light', 'dark')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_sticky_user_preferences_updated_at
before update on sticky.user_preferences
for each row execute function sticky.set_updated_at();

create table if not exists sticky.lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references sticky.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  color text not null default 'sun' check (color in ('sun', 'coral', 'mint', 'sky', 'violet', 'ink')),
  sort_order integer not null default 1000,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger set_sticky_lists_updated_at
before update on sticky.lists
for each row execute function sticky.set_updated_at();

create unique index if not exists sticky_lists_user_name_idx
on sticky.lists (user_id, lower(name));

create index if not exists sticky_lists_user_sort_idx
on sticky.lists (user_id, sort_order, created_at);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'sticky_user_state_selected_list_id_fkey'
  ) then
    alter table sticky.user_state
      add constraint sticky_user_state_selected_list_id_fkey
      foreign key (selected_list_id)
      references sticky.lists(id)
      on delete set null;
  end if;
end;
$$;

create table if not exists sticky.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references sticky.users(id) on delete cascade,
  list_id uuid not null references sticky.lists(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 180),
  details text not null default '',
  color text not null default 'sun' check (color in ('sun', 'coral', 'mint', 'sky', 'violet', 'ink')),
  due_date date,
  due_time time,
  timezone text not null default 'America/Chicago',
  is_completed boolean not null default false,
  completed_at timestamptz,
  sort_order integer not null default 1000,
  completed_sort_order integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sticky_tasks_completed_shape check (
    (is_completed = false and completed_at is null)
    or (is_completed = true and completed_at is not null)
  )
);

create trigger set_sticky_tasks_updated_at
before update on sticky.tasks
for each row execute function sticky.set_updated_at();

create index if not exists sticky_tasks_user_list_active_sort_idx
on sticky.tasks (user_id, list_id, is_completed, sort_order, created_at);

create index if not exists sticky_tasks_user_due_idx
on sticky.tasks (user_id, due_date, due_time)
where due_date is not null;

create table if not exists sticky.subtasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references sticky.users(id) on delete cascade,
  task_id uuid not null references sticky.tasks(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 160),
  is_completed boolean not null default false,
  completed_at timestamptz,
  sort_order integer not null default 1000,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sticky_subtasks_completed_shape check (
    (is_completed = false and completed_at is null)
    or (is_completed = true and completed_at is not null)
  )
);

create trigger set_sticky_subtasks_updated_at
before update on sticky.subtasks
for each row execute function sticky.set_updated_at();

create index if not exists sticky_subtasks_task_sort_idx
on sticky.subtasks (user_id, task_id, sort_order, created_at);

create table if not exists sticky.task_recurrence_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references sticky.users(id) on delete cascade,
  task_id uuid not null references sticky.tasks(id) on delete cascade,
  frequency text not null check (frequency in ('daily', 'weekly', 'monthly', 'yearly', 'custom')),
  interval_count integer not null default 1 check (interval_count between 1 and 365),
  days_of_week smallint[] not null default '{}'::smallint[],
  month_day smallint check (month_day between 1 and 31),
  starts_on date not null default current_date,
  end_type text not null default 'never' check (end_type in ('never', 'on_date', 'after_count')),
  end_date date,
  occurrence_count integer check (occurrence_count is null or occurrence_count > 0),
  timezone text not null default 'America/Chicago',
  paused boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_id),
  constraint sticky_recurrence_end_shape check (
    (end_type = 'never' and end_date is null and occurrence_count is null)
    or (end_type = 'on_date' and end_date is not null and occurrence_count is null)
    or (end_type = 'after_count' and end_date is null and occurrence_count is not null)
  )
);

create trigger set_sticky_task_recurrence_rules_updated_at
before update on sticky.task_recurrence_rules
for each row execute function sticky.set_updated_at();

create index if not exists sticky_recurrence_user_task_idx
on sticky.task_recurrence_rules (user_id, task_id);

create table if not exists sticky.task_activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references sticky.users(id) on delete cascade,
  task_id uuid references sticky.tasks(id) on delete set null,
  list_id uuid references sticky.lists(id) on delete set null,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists sticky_task_activity_user_created_idx
on sticky.task_activity (user_id, created_at desc);

create or replace function sticky.email_is_allowed(email_to_check text)
returns boolean
language sql
stable
security definer
set search_path = sticky
as $$
  select exists (
    select 1
    from sticky.allowed_emails
    where lower(email) = lower(email_to_check)
      and is_active = true
  );
$$;

create or replace function sticky.is_active_user(user_to_check uuid)
returns boolean
language sql
stable
security definer
set search_path = sticky
as $$
  select exists (
    select 1
    from sticky.users
    where id = user_to_check
      and is_active = true
  );
$$;

create or replace function sticky.bootstrap_current_user(display_name text default null)
returns sticky.users
language plpgsql
security definer
set search_path = sticky, auth, public
as $$
declare
  current_user_id uuid := auth.uid();
  current_email text := nullif(auth.jwt() ->> 'email', '');
  allowlisted boolean := false;
  allowlisted_role text := 'member';
  created_list_id uuid;
  profile sticky.users;
begin
  if current_user_id is null then
    raise exception 'Sticky requires an authenticated user.';
  end if;

  if current_email is null then
    raise exception 'Sticky could not read an email claim for this session.';
  end if;

  select true, role
    into allowlisted, allowlisted_role
  from sticky.allowed_emails
  where lower(email) = lower(current_email)
    and is_active = true
  limit 1;

  if coalesce(allowlisted, false) = false then
    insert into sticky.users (id, email, display_name, role, is_active, last_seen_at)
    values (current_user_id, current_email, display_name, 'member', false, now())
    on conflict (id) do update
      set email = excluded.email,
          display_name = coalesce(excluded.display_name, sticky.users.display_name),
          is_active = false,
          last_seen_at = now();

    raise exception 'This email is not allowed to use Sticky yet.';
  end if;

  insert into sticky.users (id, email, display_name, role, is_active, last_seen_at)
  values (current_user_id, current_email, display_name, allowlisted_role, true, now())
  on conflict (id) do update
    set email = excluded.email,
        display_name = coalesce(excluded.display_name, sticky.users.display_name),
        role = excluded.role,
        is_active = true,
        last_seen_at = now()
  returning * into profile;

  if not exists (select 1 from sticky.lists where user_id = current_user_id) then
    insert into sticky.lists (user_id, name, color, sort_order)
    values (current_user_id, 'Today', 'sun', 1000)
    returning id into created_list_id;
  else
    select id into created_list_id
    from sticky.lists
    where user_id = current_user_id
    order by sort_order asc, created_at asc
    limit 1;
  end if;

  insert into sticky.user_state (user_id, selected_list_id, last_opened_at)
  values (current_user_id, created_list_id, now())
  on conflict (user_id) do update
    set selected_list_id = coalesce(sticky.user_state.selected_list_id, excluded.selected_list_id),
        last_opened_at = now();

  insert into sticky.user_preferences (user_id)
  values (current_user_id)
  on conflict (user_id) do nothing;

  return profile;
end;
$$;

create or replace function sticky.prevent_recurrence_with_subtasks()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1 from sticky.subtasks
    where task_id = new.task_id
      and user_id = new.user_id
  ) then
    raise exception 'Repeating stickies cannot have subtasks.';
  end if;
  return new;
end;
$$;

create trigger prevent_sticky_recurrence_with_subtasks
before insert or update on sticky.task_recurrence_rules
for each row execute function sticky.prevent_recurrence_with_subtasks();

create or replace function sticky.prevent_subtask_on_recurring_task()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1 from sticky.task_recurrence_rules
    where task_id = new.task_id
      and user_id = new.user_id
  ) then
    raise exception 'Repeating stickies cannot have subtasks.';
  end if;
  return new;
end;
$$;

create trigger prevent_sticky_subtask_on_recurring_task
before insert or update on sticky.subtasks
for each row execute function sticky.prevent_subtask_on_recurring_task();

alter table sticky.allowed_emails enable row level security;
alter table sticky.users enable row level security;
alter table sticky.user_state enable row level security;
alter table sticky.user_preferences enable row level security;
alter table sticky.lists enable row level security;
alter table sticky.tasks enable row level security;
alter table sticky.subtasks enable row level security;
alter table sticky.task_recurrence_rules enable row level security;
alter table sticky.task_activity enable row level security;

create policy "Sticky users can read themselves"
on sticky.users for select
to authenticated
using (id = (select auth.uid()));

create policy "Sticky users can read own state"
on sticky.user_state for select
to authenticated
using (user_id = (select auth.uid()) and sticky.is_active_user((select auth.uid())));

create policy "Sticky users can update own state"
on sticky.user_state for update
to authenticated
using (user_id = (select auth.uid()) and sticky.is_active_user((select auth.uid())))
with check (
  user_id = (select auth.uid())
  and sticky.is_active_user((select auth.uid()))
  and (
    selected_list_id is null
    or exists (
      select 1 from sticky.lists
      where id = selected_list_id
        and user_id = (select auth.uid())
    )
  )
);

create policy "Sticky users can insert own state"
on sticky.user_state for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and sticky.is_active_user((select auth.uid()))
  and (
    selected_list_id is null
    or exists (
      select 1 from sticky.lists
      where id = selected_list_id
        and user_id = (select auth.uid())
    )
  )
);

create policy "Sticky users can read own preferences"
on sticky.user_preferences for select
to authenticated
using (user_id = (select auth.uid()) and sticky.is_active_user((select auth.uid())));

create policy "Sticky users can update own preferences"
on sticky.user_preferences for update
to authenticated
using (user_id = (select auth.uid()) and sticky.is_active_user((select auth.uid())))
with check (user_id = (select auth.uid()) and sticky.is_active_user((select auth.uid())));

create policy "Sticky users can insert own preferences"
on sticky.user_preferences for insert
to authenticated
with check (user_id = (select auth.uid()) and sticky.is_active_user((select auth.uid())));

create policy "Sticky users can read own lists"
on sticky.lists for select
to authenticated
using (user_id = (select auth.uid()) and sticky.is_active_user((select auth.uid())));

create policy "Sticky users can insert own lists"
on sticky.lists for insert
to authenticated
with check (user_id = (select auth.uid()) and sticky.is_active_user((select auth.uid())));

create policy "Sticky users can update own lists"
on sticky.lists for update
to authenticated
using (user_id = (select auth.uid()) and sticky.is_active_user((select auth.uid())))
with check (user_id = (select auth.uid()) and sticky.is_active_user((select auth.uid())));

create policy "Sticky users can delete own lists"
on sticky.lists for delete
to authenticated
using (user_id = (select auth.uid()) and sticky.is_active_user((select auth.uid())));

create policy "Sticky users can read own tasks"
on sticky.tasks for select
to authenticated
using (user_id = (select auth.uid()) and sticky.is_active_user((select auth.uid())));

create policy "Sticky users can insert own tasks"
on sticky.tasks for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and sticky.is_active_user((select auth.uid()))
  and exists (
    select 1 from sticky.lists
    where id = list_id
      and user_id = (select auth.uid())
  )
);

create policy "Sticky users can update own tasks"
on sticky.tasks for update
to authenticated
using (user_id = (select auth.uid()) and sticky.is_active_user((select auth.uid())))
with check (
  user_id = (select auth.uid())
  and sticky.is_active_user((select auth.uid()))
  and exists (
    select 1 from sticky.lists
    where id = list_id
      and user_id = (select auth.uid())
  )
);

create policy "Sticky users can delete own tasks"
on sticky.tasks for delete
to authenticated
using (user_id = (select auth.uid()) and sticky.is_active_user((select auth.uid())));

create policy "Sticky users can read own subtasks"
on sticky.subtasks for select
to authenticated
using (user_id = (select auth.uid()) and sticky.is_active_user((select auth.uid())));

create policy "Sticky users can insert own subtasks"
on sticky.subtasks for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and sticky.is_active_user((select auth.uid()))
  and exists (
    select 1 from sticky.tasks
    where id = task_id
      and user_id = (select auth.uid())
  )
);

create policy "Sticky users can update own subtasks"
on sticky.subtasks for update
to authenticated
using (user_id = (select auth.uid()) and sticky.is_active_user((select auth.uid())))
with check (
  user_id = (select auth.uid())
  and sticky.is_active_user((select auth.uid()))
  and exists (
    select 1 from sticky.tasks
    where id = task_id
      and user_id = (select auth.uid())
  )
);

create policy "Sticky users can delete own subtasks"
on sticky.subtasks for delete
to authenticated
using (user_id = (select auth.uid()) and sticky.is_active_user((select auth.uid())));

create policy "Sticky users can read own recurrence rules"
on sticky.task_recurrence_rules for select
to authenticated
using (user_id = (select auth.uid()) and sticky.is_active_user((select auth.uid())));

create policy "Sticky users can insert own recurrence rules"
on sticky.task_recurrence_rules for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and sticky.is_active_user((select auth.uid()))
  and exists (
    select 1 from sticky.tasks
    where id = task_id
      and user_id = (select auth.uid())
  )
);

create policy "Sticky users can update own recurrence rules"
on sticky.task_recurrence_rules for update
to authenticated
using (user_id = (select auth.uid()) and sticky.is_active_user((select auth.uid())))
with check (
  user_id = (select auth.uid())
  and sticky.is_active_user((select auth.uid()))
  and exists (
    select 1 from sticky.tasks
    where id = task_id
      and user_id = (select auth.uid())
  )
);

create policy "Sticky users can delete own recurrence rules"
on sticky.task_recurrence_rules for delete
to authenticated
using (user_id = (select auth.uid()) and sticky.is_active_user((select auth.uid())));

create policy "Sticky users can read own activity"
on sticky.task_activity for select
to authenticated
using (user_id = (select auth.uid()) and sticky.is_active_user((select auth.uid())));

grant execute on function sticky.email_is_allowed(text) to authenticated, service_role;
grant execute on function sticky.is_active_user(uuid) to authenticated, service_role;
grant execute on function sticky.bootstrap_current_user(text) to authenticated, service_role;

grant select on sticky.users to authenticated;
grant select, insert, update on sticky.user_state to authenticated;
grant select, insert, update on sticky.user_preferences to authenticated;
grant select, insert, update, delete on sticky.lists to authenticated;
grant select, insert, update, delete on sticky.tasks to authenticated;
grant select, insert, update, delete on sticky.subtasks to authenticated;
grant select, insert, update, delete on sticky.task_recurrence_rules to authenticated;
grant select on sticky.task_activity to authenticated;

grant all on all tables in schema sticky to service_role;
grant all on all routines in schema sticky to service_role;
grant usage, select on all sequences in schema sticky to service_role;

notify pgrst, 'reload schema';
