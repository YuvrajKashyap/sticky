-- Expand list/task color channels from 6 to 12.
-- New channels: ember, rose, lime, teal, azure, magenta.

alter table sticky.lists
  drop constraint if exists lists_color_check;

alter table sticky.lists
  add constraint lists_color_check
  check (color in ('sun', 'coral', 'mint', 'sky', 'violet', 'ink', 'ember', 'rose', 'lime', 'teal', 'azure', 'magenta'));

alter table sticky.tasks
  drop constraint if exists tasks_color_check;

alter table sticky.tasks
  add constraint tasks_color_check
  check (color in ('sun', 'coral', 'mint', 'sky', 'violet', 'ink', 'ember', 'rose', 'lime', 'teal', 'azure', 'magenta'));
