-- Sticky owns one durable agent reminder per active task. Existing reminders
-- remain explicit; newly generated defaults are marked so due-time changes can
-- reschedule them without overriding a user's chosen offset.
alter table sticky.task_reminders
  add column if not exists is_default boolean not null default false;

-- Push is no longer a user-facing delivery channel. Preserve historical rows,
-- but make every still-pending reminder deliver through the linked Poke agent.
update sticky.task_reminders
set channels = array['poke']::text[]
where status = 'scheduled'
  and channels is distinct from array['poke']::text[];

-- Older clients allowed the same task reminder to be added repeatedly. Keep
-- the newest Poke-capable reminder and make the sleeping workflows for the
-- other rows harmless; they will observe status=cancelled and exit.
with ranked as (
  select
    id,
    row_number() over (
      partition by user_id, task_id
      order by
        (channels @> array['poke']::text[]) desc,
        created_at desc,
        id desc
    ) as position
  from sticky.task_reminders
  where status = 'scheduled'
)
update sticky.task_reminders as reminder
set status = 'cancelled',
    last_error = null
from ranked
where reminder.id = ranked.id
  and ranked.position > 1;

create unique index if not exists sticky_one_scheduled_reminder_per_task_idx
on sticky.task_reminders (user_id, task_id)
where status = 'scheduled';

create index if not exists sticky_default_reminders_task_idx
on sticky.task_reminders (user_id, task_id, is_default)
where status = 'scheduled';
