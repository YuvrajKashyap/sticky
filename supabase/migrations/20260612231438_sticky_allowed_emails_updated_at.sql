-- Add update tracking for the allowlist access table.

alter table sticky.allowed_emails
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists set_sticky_allowed_emails_updated_at on sticky.allowed_emails;

create trigger set_sticky_allowed_emails_updated_at
before update on sticky.allowed_emails
for each row execute function sticky.set_updated_at();
