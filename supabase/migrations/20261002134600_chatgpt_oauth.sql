-- OAuth material is server-only. Existing API credentials remain unchanged.
create table sticky.oauth_codes (
  code_hash text primary key,
  user_id uuid not null references sticky.users(id) on delete cascade,
  client_id text not null, redirect_uri text not null, resource text not null,
  scopes text[] not null, challenge text not null,
  expires_at timestamptz not null, used_at timestamptz
);
create index oauth_codes_user_idx on sticky.oauth_codes(user_id);
create table sticky.oauth_grants (
  id uuid primary key references sticky.api_credentials(id) on delete cascade,
  client_id text not null, resource text not null,
  expires_at timestamptz not null default (now() + interval '90 days')
);
create table sticky.oauth_refresh_tokens (
  token_hash text primary key,
  grant_id uuid not null references sticky.oauth_grants(id) on delete cascade,
  expires_at timestamptz not null default (now() + interval '30 days'),
  used_at timestamptz
);
create index oauth_refresh_grant_idx on sticky.oauth_refresh_tokens(grant_id);
alter table sticky.oauth_codes enable row level security;
alter table sticky.oauth_grants enable row level security;
alter table sticky.oauth_refresh_tokens enable row level security;
revoke all on sticky.oauth_codes, sticky.oauth_grants, sticky.oauth_refresh_tokens from public, anon, authenticated;
grant all on sticky.oauth_codes, sticky.oauth_grants, sticky.oauth_refresh_tokens to service_role;

create function sticky.exchange_oauth_code(
  p_code_hash text, p_client_id text, p_redirect_uri text, p_resource text,
  p_challenge text, p_id uuid, p_access_hash text, p_refresh_hash text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare c sticky.oauth_codes%rowtype;
begin
  select * into c from sticky.oauth_codes where code_hash = p_code_hash for update;
  if not found or c.used_at is not null or c.expires_at <= now()
    or c.client_id <> p_client_id or c.redirect_uri <> p_redirect_uri
    or c.resource <> p_resource or c.challenge <> p_challenge
    or not exists (select 1 from sticky.users where id = c.user_id and is_active) then return null; end if;
  update sticky.oauth_codes set used_at = now() where code_hash = p_code_hash;
  insert into sticky.api_credentials(id,user_id,name,provider,token_prefix,token_hash,scopes,expires_at)
    values(p_id,c.user_id,'ChatGPT / dot','chatgpt_oauth','stk_' || p_id,p_access_hash,c.scopes,now() + interval '1 hour');
  insert into sticky.oauth_grants(id,client_id,resource) values(p_id,p_client_id,p_resource);
  insert into sticky.oauth_refresh_tokens(token_hash,grant_id) values(p_refresh_hash,p_id);
  return jsonb_build_object('id',p_id,'scopes',c.scopes);
end; $$;

create function sticky.rotate_oauth_token(
  p_refresh_hash text, p_client_id text, p_resource text, p_access_hash text, p_next_refresh_hash text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare t sticky.oauth_refresh_tokens%rowtype; g sticky.oauth_grants%rowtype; c sticky.api_credentials%rowtype;
begin
  select * into t from sticky.oauth_refresh_tokens where token_hash = p_refresh_hash for update;
  if not found then return null; end if;
  select * into g from sticky.oauth_grants where id = t.grant_id for update;
  if not found or g.client_id <> p_client_id or g.resource <> p_resource then return null; end if;
  select * into c from sticky.api_credentials where id = g.id for update;
  if not found or c.revoked_at is not null then return null; end if;
  if t.used_at is not null then
    update sticky.api_credentials set revoked_at = now() where id = g.id;
    return null;
  end if;
  if t.expires_at <= now() or g.expires_at <= now()
    or not exists (select 1 from sticky.users where id = c.user_id and is_active) then return null; end if;
  update sticky.oauth_refresh_tokens set used_at = now() where token_hash = p_refresh_hash;
  insert into sticky.oauth_refresh_tokens(token_hash,grant_id,expires_at)
    values(p_next_refresh_hash,g.id,least(g.expires_at,now() + interval '30 days'));
  update sticky.api_credentials set token_hash = p_access_hash, expires_at = least(g.expires_at,now() + interval '1 hour') where id = g.id;
  return jsonb_build_object('id',g.id,'scopes',c.scopes);
end; $$;

create function sticky.revoke_oauth_token(p_client_id text, p_token_hash text, p_token_prefix text)
returns void language sql security invoker set search_path = '' as $$
  update sticky.api_credentials c set revoked_at = now()
  from sticky.oauth_grants g where g.id = c.id and g.client_id = p_client_id
    and ((c.token_prefix = p_token_prefix and c.token_hash = p_token_hash)
      or exists (select 1 from sticky.oauth_refresh_tokens t where t.grant_id = g.id and t.token_hash = p_token_hash));
$$;
revoke all on function sticky.exchange_oauth_code(text,text,text,text,text,uuid,text,text),
  sticky.rotate_oauth_token(text,text,text,text,text), sticky.revoke_oauth_token(text,text,text) from public, anon, authenticated;
grant execute on function sticky.exchange_oauth_code(text,text,text,text,text,uuid,text,text),
  sticky.rotate_oauth_token(text,text,text,text,text), sticky.revoke_oauth_token(text,text,text) to service_role;
