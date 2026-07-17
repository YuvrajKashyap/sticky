-- Cover connected-platform foreign keys used during cascades and provider lookups.
-- The filename matches the version recorded in the production migration ledger.

create index if not exists sticky_task_reminders_task_fk_idx
on sticky.task_reminders (task_id);

create index if not exists sticky_notification_deliveries_user_fk_idx
on sticky.notification_deliveries (user_id);

create index if not exists sticky_notification_deliveries_reminder_fk_idx
on sticky.notification_deliveries (reminder_id)
where reminder_id is not null;

create index if not exists sticky_integration_list_links_user_fk_idx
on sticky.integration_list_links (user_id);

create index if not exists sticky_integration_list_links_list_fk_idx
on sticky.integration_list_links (list_id);

create index if not exists sticky_integration_task_links_user_fk_idx
on sticky.integration_task_links (user_id);

create index if not exists sticky_integration_task_links_task_fk_idx
on sticky.integration_task_links (task_id);

create index if not exists sticky_integration_sync_state_user_fk_idx
on sticky.integration_sync_state (user_id);

create index if not exists sticky_api_credentials_user_fk_idx
on sticky.api_credentials (user_id);
