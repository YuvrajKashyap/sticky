-- Add the independent Sticky appearance axes: light/dark theme and pad/wood board style.

alter table sticky.user_preferences
  add column if not exists board_style text not null default 'pad';

update sticky.user_preferences
set color_mode = 'light'
where color_mode = 'system';

alter table sticky.user_preferences
  alter column color_mode set default 'light',
  alter column board_style set default 'pad';

alter table sticky.user_preferences
  drop constraint if exists user_preferences_color_mode_check,
  drop constraint if exists sticky_user_preferences_color_mode_check,
  drop constraint if exists sticky_user_preferences_board_style_check;

alter table sticky.user_preferences
  add constraint sticky_user_preferences_color_mode_check
    check (color_mode in ('light', 'dark')),
  add constraint sticky_user_preferences_board_style_check
    check (board_style in ('pad', 'wood'));

notify pgrst, 'reload schema';
