-- Interface size can now run from 25% to 400%, and Auto calibration from
-- -30 to +30, so the console fits any display from a tiny laptop to a kiosk.
alter table sticky.user_preferences
  drop constraint if exists sticky_user_preferences_interface_scale_check,
  add constraint sticky_user_preferences_interface_scale_check
    check (interface_scale between 25 and 400);

alter table sticky.user_preferences
  drop constraint if exists sticky_user_preferences_interface_auto_bias_check,
  add constraint sticky_user_preferences_interface_auto_bias_check
    check (interface_auto_bias between -30 and 30);
