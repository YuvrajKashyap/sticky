-- Harden Sticky security-definer helpers by removing broad schema search paths.
-- The functions keep their existing grants, but all object references are now
-- explicit and search_path is empty per Supabase function hardening guidance.

create or replace function sticky.email_is_allowed(email_to_check text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from sticky.allowed_emails
    where lower(email) = lower(email_to_check)
      and is_active = true
  );
$$;

create or replace function sticky.is_active_user(user_to_check uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from sticky.users
    where id = user_to_check
      and is_active = true
  );
$$;

create or replace function sticky.bootstrap_current_user(display_name text default null)
returns sticky.users
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  current_email text := nullif(auth.jwt() ->> 'email', '');
  allowlisted boolean := false;
  allowlisted_role text := 'member';
  created_list_id uuid;
  profile sticky.users;
begin
  if current_user_id is null then
    raise exception 'Sticky requires an authenticated user.';
  end if;

  if current_email is null then
    raise exception 'Sticky could not read an email claim for this session.';
  end if;

  select true, role
    into allowlisted, allowlisted_role
  from sticky.allowed_emails
  where lower(email) = lower(current_email)
    and is_active = true
  limit 1;

  if coalesce(allowlisted, false) = false then
    insert into sticky.users (id, email, display_name, role, is_active, last_seen_at)
    values (current_user_id, current_email, display_name, 'member', false, now())
    on conflict (id) do update
      set email = excluded.email,
          display_name = coalesce(excluded.display_name, sticky.users.display_name),
          is_active = false,
          last_seen_at = now();

    raise exception 'This email is not allowed to use Sticky yet.';
  end if;

  insert into sticky.users (id, email, display_name, role, is_active, last_seen_at)
  values (current_user_id, current_email, display_name, allowlisted_role, true, now())
  on conflict (id) do update
    set email = excluded.email,
        display_name = coalesce(excluded.display_name, sticky.users.display_name),
        role = excluded.role,
        is_active = true,
        last_seen_at = now()
  returning * into profile;

  if not exists (select 1 from sticky.lists where user_id = current_user_id) then
    insert into sticky.lists (user_id, name, color, sort_order)
    values (current_user_id, 'Today', 'sun', 1000)
    returning id into created_list_id;
  else
    select id into created_list_id
    from sticky.lists
    where user_id = current_user_id
    order by sort_order asc, created_at asc
    limit 1;
  end if;

  insert into sticky.user_state (user_id, selected_list_id, last_opened_at)
  values (current_user_id, created_list_id, now())
  on conflict (user_id) do update
    set selected_list_id = coalesce(sticky.user_state.selected_list_id, excluded.selected_list_id),
        last_opened_at = now();

  insert into sticky.user_preferences (user_id)
  values (current_user_id)
  on conflict (user_id) do nothing;

  return profile;
end;
$$;

revoke execute on function sticky.email_is_allowed(text) from public, anon, authenticated;
revoke execute on function sticky.is_active_user(uuid) from public, anon;
revoke execute on function sticky.bootstrap_current_user(text) from public, anon;

grant execute on function sticky.email_is_allowed(text) to service_role;
grant execute on function sticky.is_active_user(uuid) to authenticated, service_role;
grant execute on function sticky.bootstrap_current_user(text) to authenticated, service_role;

notify pgrst, 'reload schema';
