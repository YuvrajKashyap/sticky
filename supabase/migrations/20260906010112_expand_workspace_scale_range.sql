alter table sticky.user_preferences
  drop constraint sticky_user_preferences_interface_scale_check,
  add constraint sticky_user_preferences_interface_scale_check
    check (interface_scale between 50 and 250);
