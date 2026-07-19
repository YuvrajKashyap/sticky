-- User-owned daily agenda schedule. Delivery itself remains server-controlled
-- through the existing notification_deliveries audit table and Poke channel.

alter table sticky.user_preferences
  add column if not exists daily_agenda_enabled boolean not null default true,
  add column if not exists daily_agenda_time time(0) without time zone not null default '06:00:00',
  add column if not exists daily_agenda_timezone text not null default 'America/Chicago',
  add column if not exists daily_agenda_schedule_version bigint not null default 1,
  add column if not exists daily_agenda_workflow_run_id text,
  add column if not exists daily_agenda_last_sent_on date,
  add column if not exists daily_agenda_last_sent_at timestamptz;

alter table sticky.user_preferences
  drop constraint if exists sticky_user_preferences_daily_agenda_timezone_check,
  drop constraint if exists sticky_user_preferences_daily_agenda_schedule_version_check;

alter table sticky.user_preferences
  add constraint sticky_user_preferences_daily_agenda_timezone_check
    check (char_length(trim(daily_agenda_timezone)) between 1 and 100),
  add constraint sticky_user_preferences_daily_agenda_schedule_version_check
    check (daily_agenda_schedule_version > 0);

comment on column sticky.user_preferences.daily_agenda_time is
  'Local wall-clock time for the daily Poke agenda.';
comment on column sticky.user_preferences.daily_agenda_timezone is
  'IANA timezone used to resolve the local daily agenda time, including DST.';
comment on column sticky.user_preferences.daily_agenda_schedule_version is
  'Monotonic generation used to retire obsolete durable scheduler runs.';

notify pgrst, 'reload schema';
