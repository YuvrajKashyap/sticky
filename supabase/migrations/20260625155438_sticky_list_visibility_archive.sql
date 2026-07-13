-- Add reversible list archive and dashboard visibility controls.

alter table sticky.lists
  add column if not exists is_visible_on_board boolean not null default true,
  add column if not exists archived_at timestamptz;

create index if not exists sticky_lists_user_visible_sort_idx
on sticky.lists (user_id, is_visible_on_board, sort_order, created_at)
where archived_at is null;

create index if not exists sticky_lists_user_archived_idx
on sticky.lists (user_id, archived_at desc, sort_order)
where archived_at is not null;
