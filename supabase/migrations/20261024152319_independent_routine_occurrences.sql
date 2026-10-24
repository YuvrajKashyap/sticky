-- Dated task rows are occurrences. Templates survive removal of a repeat rule,
-- so disabling a routine does not erase its history. No legacy dates are inferred.
create table sticky.routine_templates (
  id uuid primary key,
  user_id uuid not null references sticky.users(id) on delete cascade,
  list_id uuid not null references sticky.lists(id) on delete cascade,
  template jsonb not null,
  schedule jsonb not null,
  tracking_since date not null,
  scan_from date not null,
  generated_count integer not null default 0,
  retired boolean not null default false,
  created_at timestamptz not null default now()
);
alter table sticky.routine_templates enable row level security;
create policy routine_templates_owner_read on sticky.routine_templates for select to authenticated
using (user_id = (select auth.uid()) and sticky.is_active_user((select auth.uid())));
grant select on sticky.routine_templates to authenticated;
grant all on sticky.routine_templates to service_role;

create table sticky.routine_schedule_versions (
  id uuid primary key default gen_random_uuid(),
  routine_id uuid not null references sticky.routine_templates(id) on delete cascade,
  user_id uuid not null references sticky.users(id) on delete cascade,
  effective_at timestamptz not null default now(),
  schedule jsonb not null
);
alter table sticky.routine_schedule_versions enable row level security;
create policy routine_schedule_versions_owner_read on sticky.routine_schedule_versions for select to authenticated
using (user_id = (select auth.uid()) and sticky.is_active_user((select auth.uid())));
grant select on sticky.routine_schedule_versions to authenticated;
grant all on sticky.routine_schedule_versions to service_role;

alter table sticky.tasks
  add column routine_id uuid references sticky.routine_templates(id),
  add column scheduled_date date,
  add column occurrence_status text check (occurrence_status in ('pending','completed','not_completed','skipped','unknown','not_scheduled'));
create unique index sticky_routine_date_unique on sticky.tasks(routine_id, scheduled_date) where routine_id is not null;
create index sticky_routine_history_idx on sticky.tasks(user_id, routine_id, scheduled_date);
create index sticky_pending_routine_idx on sticky.tasks(user_id,routine_id,scheduled_date)
  where occurrence_status = 'pending' and not is_completed;
create index sticky_active_dashboard_idx on sticky.tasks(user_id,id)
  where not is_completed and (routine_id is null or occurrence_status = 'pending');
alter table sticky.tasks add constraint sticky_occurrence_shape check (
  (routine_id is null and scheduled_date is null and occurrence_status is null)
  or (routine_id is not null and scheduled_date is not null and occurrence_status is not null)
);

-- Evaluate a calendar date, not an elapsed 24-hour duration (DST safe).
create or replace function sticky.routine_scheduled_on(s jsonb, d date) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  anchor date := (s->>'starts_on')::date;
  n integer := (s->>'interval_count')::integer;
  f text := s->>'frequency';
  months integer;
  last_day integer;
  dom integer := extract(day from d);
  weekly_match boolean;
  monthly_match boolean;
  day_value integer;
begin
  if d < anchor or (s->>'end_type' = 'on_date' and d > (s->>'end_date')::date) then return false; end if;
  months := (extract(year from d)::integer - extract(year from anchor)::integer) * 12 + extract(month from d)::integer - extract(month from anchor)::integer;
  last_day := extract(day from (date_trunc('month', d) + interval '1 month - 1 day'));
  weekly_match := mod(((d - extract(dow from d)::integer) - (anchor - extract(dow from anchor)::integer)) / 7, n) = 0
    and exists(select 1 from jsonb_array_elements_text(s->'days_of_week') x where x::integer = extract(dow from d));
  if f = 'monthly' and jsonb_array_length(coalesce(s->'month_days','[]')) > 0 then
    monthly_match := false;
    for day_value in select x::integer from jsonb_array_elements_text(s->'month_days') x loop
      monthly_match := monthly_match or dom = case when day_value = -1 then last_day else least(day_value, last_day) end;
    end loop;
  else
    monthly_match := dom = least(coalesce((s->>'month_day')::integer, extract(day from anchor)::integer), last_day);
  end if;
  case f
    when 'daily' then return mod(d - anchor, n) = 0;
    when 'weekly' then
      if jsonb_array_length(s->'days_of_week') = 0 then return mod(d - anchor, n * 7) = 0; end if;
      return weekly_match;
    when 'monthly' then return mod(months, n) = 0 and monthly_match;
    when 'yearly' then return mod(months, n * 12) = 0 and monthly_match;
    when 'custom' then
      if jsonb_array_length(s->'days_of_week') = 0 and s->>'month_day' is null then return mod(d - anchor, n) = 0; end if;
      return weekly_match or (s->>'month_day' is not null and mod(months, n) = 0 and monthly_match);
    else return false;
  end case;
end $$;

-- Only trusted server callers can choose the clock. Public reads never accept it.
create or replace function sticky.reconcile_routine_occurrences(p_request_user_id uuid, p_now timestamptz default now(), p_routine_id uuid default null)
returns integer language plpgsql security invoker set search_path = '' as $$
declare r sticky.routine_templates; d date; today date; inserted integer; total integer := 0; latest_id uuid;
begin
  if ((select auth.uid()) is not null and (select auth.uid()) <> p_request_user_id)
    or ((select auth.uid()) is null and coalesce((select auth.role()),'') <> 'service_role')
    or not sticky.is_active_user(p_request_user_id) then raise exception 'Access denied' using errcode = '42501'; end if;
  for r in select * from sticky.routine_templates where user_id = p_request_user_id and (p_routine_id is null or id = p_routine_id) order by id for update loop
    today := (p_now at time zone (r.schedule->>'timezone'))::date;
    -- Each row retains its original timezone even when the template changes.
    update sticky.tasks set occurrence_status = 'not_completed'
      where user_id = p_request_user_id and routine_id = r.id and occurrence_status = 'pending'
        and not is_completed and scheduled_date < (p_now at time zone timezone)::date;
    d := r.scan_from;
    while d <= today loop
      if not r.retired and not (r.schedule->>'paused')::boolean
         and sticky.routine_scheduled_on(r.schedule, d)
         and (r.schedule->>'end_type' <> 'after_count' or r.generated_count < (r.schedule->>'occurrence_count')::integer) then
        insert into sticky.tasks(user_id,list_id,title,details,color,due_date,due_time,timezone,sort_order,routine_id,scheduled_date,occurrence_status)
        values(r.user_id,r.list_id,r.template->>'title',coalesce(r.template->>'details',''),r.template->>'color',d,
          (r.template->>'due_time')::time,r.schedule->>'timezone',coalesce((r.template->>'sort_order')::integer,1000),r.id,d,
          case when d < today then 'not_completed' else 'pending' end)
        on conflict (routine_id,scheduled_date) where routine_id is not null do update
          set occurrence_status = excluded.occurrence_status, title = excluded.title,
            details = excluded.details, color = excluded.color, list_id = excluded.list_id,
            due_date = excluded.due_date, due_time = excluded.due_time, timezone = excluded.timezone
          where sticky.tasks.occurrence_status = 'not_scheduled';
        get diagnostics inserted = row_count;
        total := total + inserted;
        r.generated_count := r.generated_count + inserted;
      end if;
      d := d + 1;
    end loop;
    update sticky.routine_templates set scan_from = greatest(scan_from, today + 1), generated_count = r.generated_count where id = r.id;
    -- Compatibility pointer only; the schedule and template no longer live on this task.
    select id into latest_id from sticky.tasks where routine_id = r.id and user_id = r.user_id order by scheduled_date desc limit 1;
    if latest_id is not null and pg_trigger_depth() = 0 then update sticky.task_recurrence_rules set task_id = latest_id where id = r.id and task_id <> latest_id; end if;
  end loop;
  return total;
end $$;
revoke execute on function sticky.reconcile_routine_occurrences(uuid,timestamptz,uuid) from public, anon, authenticated;
grant execute on function sticky.reconcile_routine_occurrences(uuid,timestamptz,uuid) to service_role;

-- Narrow owner-bound materialization entry point for authenticated workspace
-- reads. No date, routine, or data payload is accepted from the browser.
create or replace function sticky.reconcile_my_routines(p_request_user_id uuid default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare uid uuid := coalesce((select auth.uid()), p_request_user_id);
begin
  if p_request_user_id is not null and uid <> p_request_user_id then raise exception 'Access denied' using errcode = '42501'; end if;
  return sticky.reconcile_routine_occurrences(uid);
end $$;
revoke execute on function sticky.reconcile_my_routines(uuid) from public, anon;
grant execute on function sticky.reconcile_my_routines(uuid) to authenticated, service_role;

-- Seed only the currently linked occurrence. Older completed task rows remain
-- untouched in the completed piles; names are not reliable routine identities.
insert into sticky.routine_templates(id,user_id,list_id,template,schedule,tracking_since,scan_from,generated_count)
select r.id,r.user_id,t.list_id,to_jsonb(t),to_jsonb(r),
  (now() at time zone r.timezone)::date,greatest((now() at time zone r.timezone)::date,t.due_date,r.starts_on),
  case when t.due_date is not null then 1 else 0 end
from sticky.task_recurrence_rules r join sticky.tasks t on t.id = r.task_id;
update sticky.tasks t set routine_id = r.id, scheduled_date = coalesce(t.due_date,r.starts_on),
  occurrence_status = case when t.is_completed then 'completed'
    when coalesce(t.due_date,r.starts_on) < (now() at time zone t.timezone)::date then 'unknown' else 'pending' end
from sticky.task_recurrence_rules r where r.task_id = t.id
  and (not t.is_completed or t.due_date is not null);
insert into sticky.routine_schedule_versions(routine_id,user_id,schedule)
select id,user_id,schedule from sticky.routine_templates;

create or replace function sticky.sync_routine_template() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare t sticky.tasks; today date; first_date date; cancelled integer; s jsonb;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() = 1 then
      update sticky.routine_templates set retired = true where id = old.id;
      update sticky.tasks set occurrence_status = 'not_scheduled' where routine_id = old.id
        and occurrence_status = 'pending' and scheduled_date >= (now() at time zone timezone)::date;
    end if;
    return old;
  end if;
  s := to_jsonb(new) - 'task_id' - 'updated_at';
  if tg_op = 'UPDATE' and s = to_jsonb(old) - 'task_id' - 'updated_at' then return new; end if;
  today := (now() at time zone new.timezone)::date;
  if tg_op = 'INSERT' then
    select * into strict t from sticky.tasks where id = new.task_id and user_id = new.user_id;
    if t.routine_id = new.id then
      update sticky.routine_templates set retired = false, schedule = to_jsonb(new), scan_from = today
        where id = new.id and user_id = new.user_id;
      insert into sticky.routine_schedule_versions(routine_id,user_id,schedule) values(new.id,new.user_id,to_jsonb(new));
      perform sticky.reconcile_routine_occurrences(new.user_id,now(),new.id);
      return new;
    end if;
    first_date := greatest(coalesce(t.due_date,new.starts_on),new.starts_on);
    -- The first occurrence must itself satisfy weekday/month-day selections.
    while not sticky.routine_scheduled_on(to_jsonb(new),first_date) loop
      if first_date > new.starts_on + 146100 or (new.end_type = 'on_date' and first_date > new.end_date) then
        raise exception 'This recurrence has no scheduled date within its bounds.' using errcode = '22023';
      end if;
      first_date := first_date + 1;
    end loop;
    insert into sticky.routine_templates(id,user_id,list_id,template,schedule,tracking_since,scan_from,generated_count)
    values(new.id,new.user_id,t.list_id,to_jsonb(t),to_jsonb(new),today,greatest(today,first_date),case when new.paused then 0 else 1 end);
    update sticky.tasks set routine_id = new.id, scheduled_date = first_date, due_date = first_date,
      occurrence_status = case when is_completed then 'completed' when new.paused then 'not_scheduled' when first_date < today then 'unknown' else 'pending' end
      where id = new.task_id;
  else
    perform sticky.reconcile_routine_occurrences(new.user_id, now(), new.id);
    -- Pause cancels an unchecked current day. Schedule edits release future
    -- allocations; the new schedule may reactivate the same dated ID when due.
    -- This also prevents an old future allocation consuming a finite new count.
    update sticky.tasks set occurrence_status = 'not_scheduled'
      where routine_id = new.id and not is_completed and occurrence_status = 'pending'
        and ((new.paused and scheduled_date >= today) or scheduled_date > today);
    get diagnostics cancelled = row_count;
    update sticky.routine_templates set schedule = to_jsonb(new), retired = false,
      scan_from = case when old.paused and not new.paused then today else greatest(scan_from,today + 1) end, generated_count = case
        when old.end_type is distinct from new.end_type or old.occurrence_count is distinct from new.occurrence_count then 0 else greatest(0,generated_count - cancelled) end
      where id = new.id;
  end if;
  insert into sticky.routine_schedule_versions(routine_id,user_id,schedule) values(new.id,new.user_id,to_jsonb(new));
  if tg_op = 'UPDATE' and old.paused and not new.paused then
    perform sticky.reconcile_routine_occurrences(new.user_id,now(),new.id);
  end if;
  return new;
end $$;
create trigger sync_routine_template after insert or update or delete on sticky.task_recurrence_rules
for each row execute function sticky.sync_routine_template();

create or replace function sticky.sync_occurrence_completion() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if old.routine_id is not null and (new.routine_id is distinct from old.routine_id or new.scheduled_date is distinct from old.scheduled_date) then
    raise exception 'An occurrence identity cannot be changed; edit the future routine schedule instead.';
  end if;
  if new.routine_id is not null then
    if new.is_completed then new.occurrence_status := 'completed';
    elsif old.is_completed and new.occurrence_status is not distinct from old.occurrence_status then
      new.occurrence_status := case when new.scheduled_date < (now() at time zone new.timezone)::date then 'not_completed' else 'pending' end;
    end if;
  end if;
  return new;
end $$;
create trigger sync_occurrence_completion before update on sticky.tasks for each row execute function sticky.sync_occurrence_completion();

-- Clearing a completed pile must not delete a routine's future schedule.
alter table sticky.task_recurrence_rules drop constraint task_recurrence_rules_task_id_fkey;

create or replace function sticky.sync_routine_task_fields() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.routine_id is not null and new.scheduled_date >= (now() at time zone new.timezone)::date
     and (new.title,new.details,new.color,new.due_time,new.list_id) is distinct from (old.title,old.details,old.color,old.due_time,old.list_id) then
    update sticky.routine_templates set list_id = new.list_id,
      template = template || jsonb_build_object('title',new.title,'details',new.details,'color',new.color,'due_time',new.due_time)
      where id = new.routine_id and user_id = new.user_id;
  end if;
  return new;
end $$;
create trigger sync_routine_task_fields after update on sticky.tasks for each row execute function sticky.sync_routine_task_fields();

create or replace function sticky.remove_routine_rule() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  delete from sticky.task_recurrence_rules where id = old.id;
  return old;
end $$;
create trigger remove_routine_rule before delete on sticky.routine_templates for each row execute function sticky.remove_routine_rule();

-- Old clients may still send a guessed next task. Ignore that guess and only
-- complete the exact requested occurrence. Never create/advance on completion.
create or replace function sticky.complete_task_with_recurrence(
  p_task_id uuid, p_next_task_id uuid default null, p_next_due_date date default null,
  p_next_due_time time default null, p_next_occurrence_count integer default null, p_request_user_id uuid default null
) returns void language plpgsql security invoker set search_path = '' as $$
declare uid uuid := sticky.resolve_command_user(p_request_user_id); already_completed boolean;
begin
  select is_completed into already_completed from sticky.tasks where id = p_task_id and user_id = uid for update;
  if already_completed then return; end if;
  perform sticky.set_task_completed(p_task_id, true, p_request_user_id);
end $$;

create or replace function sticky.undo_recurring_completion(
  p_task_id uuid, p_generated_task_id uuid, p_recurrence_rule_id uuid, p_occurrence_count integer default null, p_request_user_id uuid default null
) returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform sticky.set_task_completed(p_task_id, false, p_request_user_id);
end $$;

-- Replaces the date-moving catch-up contract without destroying old days.
create or replace function sticky.advance_recurring_task(p_task_id uuid,p_next_due_date date,p_next_occurrence_count integer default null,p_request_user_id uuid default null)
returns void language plpgsql security invoker set search_path = '' as $$
declare uid uuid := sticky.resolve_command_user(p_request_user_id); rid uuid;
begin
  select routine_id into rid from sticky.tasks where id = p_task_id and user_id = uid;
  if rid is null then raise exception 'Routine occurrence not found'; end if;
  perform sticky.reconcile_routine_occurrences(uid, now(), rid);
end $$;

create index routine_templates_user_idx on sticky.routine_templates(user_id);
create index routine_templates_list_idx on sticky.routine_templates(list_id);
create index routine_schedule_versions_owner_idx on sticky.routine_schedule_versions(user_id,routine_id,effective_at);
create index routine_schedule_versions_routine_idx on sticky.routine_schedule_versions(routine_id);

-- Compatibility worker also reconciles without changing a recorded date.
create or replace function sticky.advance_recurring_task_for_worker(
  p_task_id uuid, p_next_due_date date, p_next_occurrence_count integer default null,
  p_reason text default 'recurrence_worker', p_skipped_count integer default null
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare t sticky.tasks;
begin
  select * into t from sticky.tasks where id = p_task_id;
  if not found or t.routine_id is null then return false; end if;
  return sticky.reconcile_routine_occurrences(t.user_id,now(),t.routine_id) > 0;
end $$;

-- Explicit grants, including replacements, keep old and new RPC boundaries narrow.
revoke execute on function sticky.routine_scheduled_on(jsonb,date) from public,anon,authenticated;
grant execute on function sticky.routine_scheduled_on(jsonb,date) to service_role;
revoke execute on function sticky.sync_routine_template() from public,anon,authenticated;
revoke execute on function sticky.sync_occurrence_completion() from public,anon,authenticated;
revoke execute on function sticky.sync_routine_task_fields() from public,anon,authenticated;
revoke execute on function sticky.remove_routine_rule() from public,anon,authenticated;
revoke execute on function sticky.complete_task_with_recurrence(uuid,uuid,date,time,integer,uuid) from public,anon,authenticated;
revoke execute on function sticky.undo_recurring_completion(uuid,uuid,uuid,integer,uuid) from public,anon,authenticated;
revoke execute on function sticky.advance_recurring_task(uuid,date,integer,uuid) from public,anon,authenticated;
revoke execute on function sticky.advance_recurring_task_for_worker(uuid,date,integer,text,integer) from public,anon,authenticated;
grant execute on function sticky.complete_task_with_recurrence(uuid,uuid,date,time,integer,uuid) to service_role;
grant execute on function sticky.undo_recurring_completion(uuid,uuid,uuid,integer,uuid) to service_role;
grant execute on function sticky.advance_recurring_task(uuid,date,integer,uuid) to service_role;
grant execute on function sticky.advance_recurring_task_for_worker(uuid,date,integer,text,integer) to service_role;

create or replace function sticky.set_routine_due_time(p_routine_id uuid,p_due_time time,p_request_user_id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare uid uuid := sticky.resolve_command_user(p_request_user_id);
begin
  if not sticky.is_active_user(uid) then raise exception 'Access denied' using errcode = '42501'; end if;
  update sticky.routine_templates set template = template || jsonb_build_object('due_time',p_due_time)
    where id = p_routine_id and user_id = uid;
  if not found then raise exception 'Routine not found' using errcode = '42501'; end if;
end $$;
revoke execute on function sticky.set_routine_due_time(uuid,time,uuid) from public,anon,authenticated;
grant execute on function sticky.set_routine_due_time(uuid,time,uuid) to service_role;
