-- proto-feedback-kit: optional Supabase backend for prototypes hosted outside claude.ai.
--
-- Anyone with the review link can read and comment under a typed name, with no account.
-- The owner signs in with a private owner key (from their own link) to resolve, mark
-- comments "Do next" and delete anything.
--
-- Tables live in schema `pf`, which the Data API never exposes. The page only calls the
-- public pf_* functions below, which check every write. Safe to run more than once.
--
-- Identity:
--   * A commenter's browser keeps a random secret. Their public author id is
--     'a_' + the first 20 hex characters of sha256(secret). Only the holder of the
--     secret can edit or delete their own comments.
--   * The original project key keeps author id 'owner'. Extra keys in pf.owner_keys
--     use 'owner:<id>', with independent names and rate buckets. All carry byOwner = true.
--
-- Errors use PostgREST's PTxxx codes, so the HTTP status says what went wrong:
--   400 invalid_argument, 403 not_granted, 404 unknown project, 429 rate_limited/quota_exceeded.

create schema if not exists pf;
revoke all on schema pf from public, anon, authenticated;

create table if not exists pf.projects (
  slug text primary key check (slug ~ '^[a-z0-9][a-z0-9-]{2,63}$'),
  owner_key_hash bytea not null,
  max_docs int not null default 5000,
  max_names int not null default 500,
  created_at timestamptz not null default now()
);

alter table pf.projects add column if not exists max_names int not null default 500;

create table if not exists pf.owner_keys (
  project text not null references pf.projects (slug) on delete cascade,
  owner_id text not null check (owner_id ~ '^[a-z0-9][a-z0-9-]{0,23}$'),
  key_hash bytea not null,
  created_at timestamptz not null default now(),
  primary key (project, owner_id),
  unique (project, key_hash)
);
revoke all on pf.owner_keys from public, anon, authenticated;

create table if not exists pf.docs (
  project text not null references pf.projects (slug) on delete cascade,
  collection text not null check (collection in ('comments', 'replies')),
  id text not null check (id ~ '^[A-Za-z0-9_-]{6,40}$'),
  author text not null,
  by_owner boolean not null default false,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project, collection, id)
);

-- '__proto__' would collide with plain-object keys in the page.
alter table pf.docs drop constraint if exists docs_id_check;
alter table pf.docs add constraint docs_id_check
  check (id ~ '^[A-Za-z0-9_-]{6,40}$' and id <> '__proto__');

create table if not exists pf.names (
  project text not null references pf.projects (slug) on delete cascade,
  author text not null,
  name text not null check (char_length(name) between 1 and 60),
  updated_at timestamptz not null default now(),
  primary key (project, author)
);

create table if not exists pf.write_log (
  at timestamptz not null default now(),
  project text not null,
  author text not null,
  ip text
);
create index if not exists write_log_author_at on pf.write_log (author, at);
create index if not exists write_log_ip_at on pf.write_log (ip, at);
create index if not exists write_log_project_at on pf.write_log (project, at);

-- No policies: only the security-definer functions below touch these tables.
alter table pf.projects enable row level security;
alter table pf.owner_keys enable row level security;
alter table pf.docs enable row level security;
alter table pf.names enable row level security;
alter table pf.write_log enable row level security;

-- Helpers ------------------------------------------------------------------

create or replace function pf.fail(p_status text, p_code text) returns void
language plpgsql set search_path = '' as $$
begin
  raise exception '%', p_code using errcode = 'PT' || p_status;
end $$;

create or replace function pf.require_project(p_project text) returns void
language plpgsql stable set search_path = '' as $$
begin
  if p_project is null or not exists (select 1 from pf.projects where slug = p_project) then
    perform pf.fail('404', 'not_found');
  end if;
end $$;

create or replace function pf.owner_of(p_project text, p_owner_key text) returns text
language sql stable set search_path = '' as $$
  select case
    when p_owner_key is null or p_owner_key = '' then null
    when exists (
    select 1 from pf.projects
    where slug = p_project and owner_key_hash = sha256(convert_to(p_owner_key, 'UTF8')))
      then 'owner'
    else (select 'owner:' || owner_id from pf.owner_keys
      where project = p_project and key_hash = sha256(convert_to(p_owner_key, 'UTF8')))
  end
$$;

create or replace function pf.is_owner(p_project text, p_owner_key text) returns boolean
language sql stable set search_path = '' as $$
  select pf.owner_of(p_project, p_owner_key) is not null
$$;

create or replace function pf.author_of(p_secret text) returns text
language plpgsql immutable set search_path = '' as $$
begin
  if p_secret is null or p_secret !~ '^[A-Za-z0-9_-]{32,128}$' then
    perform pf.fail('400', 'invalid_argument');
  end if;
  -- Reviewer ids always start with 'a_', outside the reserved owner namespace.
  return 'a_' || left(encode(sha256(convert_to(p_secret, 'UTF8')), 'hex'), 20);
end $$;

-- Supabase's Cloudflare edge sets cf-connecting-ip itself (a client-sent one is refused).
-- x-forwarded-for is only a fallback for self-hosted setups behind a trusted proxy.
create or replace function pf.client_ip() returns text
language plpgsql stable set search_path = '' as $$
declare v_headers json;
begin
  v_headers := nullif(current_setting('request.headers', true), '')::json;
  return coalesce(v_headers ->> 'cf-connecting-ip',
                  nullif(trim(split_part(v_headers ->> 'x-forwarded-for', ',', 1)), ''));
exception when others then
  return null;
end $$;

-- Per author 20 writes a minute, per IP 60 a minute, per project 3000 a day.
-- Each owner only has a per-project per-minute limit (60), so a flood of comments can never lock
-- them out of resolving or deleting. Writes to one project run one at a time (an
-- advisory lock held to the end of the transaction), so concurrent calls can't all
-- slip under a limit or a quota.
create or replace function pf.check_rate(p_project text, p_author text) returns void
language plpgsql set search_path = '' as $$
declare v_ip text := pf.client_ip();
begin
  perform pg_advisory_xact_lock(hashtext('pf:' || p_project));
  if random() < 0.02 then
    delete from pf.write_log where at < now() - interval '2 days';
  end if;
  if p_author = 'owner' or p_author like 'owner:%' then
    if (select count(*) from pf.write_log
          where project = p_project and author = p_author and at > now() - interval '1 minute') >= 60 then
      perform pf.fail('429', 'rate_limited');
    end if;
  elsif (select count(*) from pf.write_log
        where author = p_author and at > now() - interval '1 minute') >= 20
     or (v_ip is not null and (select count(*) from pf.write_log
        where ip = v_ip and author <> 'owner' and author not like 'owner:%'
          and at > now() - interval '1 minute') >= 60)
     or (select count(*) from pf.write_log
        where project = p_project and author <> 'owner' and author not like 'owner:%'
          and at > now() - interval '1 day') >= 3000 then
    perform pf.fail('429', 'rate_limited');
  end if;
  insert into pf.write_log (project, author, ip) values (p_project, p_author, v_ip);
end $$;

revoke all on all functions in schema pf from public, anon, authenticated;
alter default privileges in schema pf revoke execute on functions from public;

-- Public API ----------------------------------------------------------------

-- What the panel shows: the newest 1000 docs, plus names for their authors.
create or replace function public.pf_list(p_project text) returns jsonb
language sql stable security definer set search_path = '' as $$
  with d as (
    select * from pf.docs where project = p_project
    order by created_at desc limit 1000)
  select jsonb_build_object(
    'docs', coalesce((
      select jsonb_agg(jsonb_build_object(
          'collection', d.collection, 'id', d.id, 'author', d.author, 'byOwner', d.by_owner,
          'data', d.data, 'createdAt', d.created_at, 'updatedAt', d.updated_at)
        order by d.created_at desc)
      from d), '[]'::jsonb),
    'names', coalesce((
      select jsonb_object_agg(n.author, n.name) from pf.names n
      where n.project = p_project and n.author in (select author from d)),
      '{}'::jsonb),
    'serverTime', now())
$$;
create index if not exists docs_project_created on pf.docs (project, created_at desc);

-- Who this browser is: { author, isOwner }. Owner key wins over the secret.
create or replace function public.pf_whoami(p_project text, p_secret text, p_owner_key text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_author text;
begin
  perform pf.require_project(p_project);
  v_author := pf.owner_of(p_project, p_owner_key);
  if v_author is not null then
    return jsonb_build_object('author', v_author, 'isOwner', true);
  end if;
  return jsonb_build_object('author', pf.author_of(p_secret), 'isOwner', false);
end $$;

-- Create or change a comment or reply. p_merge = true applies p_data as a patch.
-- Only the owner can set owner fields (status, resolvedIn, approved, ...); for anyone
-- else those keep their stored values, and a new comment starts open.
create or replace function public.pf_write(
  p_project text, p_collection text, p_id text, p_data jsonb,
  p_secret text, p_owner_key text default null, p_merge boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_owner boolean;
  v_author text;
  v_row pf.docs%rowtype;
  v_exists boolean;
  v_data jsonb;
  -- 'by' marks a Claude reply; only the owner key may set it.
  v_guarded text[] := array['status', 'resolvedIn', 'resolvedAt', 'resolvedBy', 'approved', 'approvedAt', 'by'];
  k text;
begin
  perform pf.require_project(p_project);
  v_author := pf.owner_of(p_project, p_owner_key);
  v_owner := v_author is not null;
  v_author := coalesce(v_author, pf.author_of(p_secret));

  if p_collection is null or p_collection not in ('comments', 'replies')
     or p_id is null or p_id !~ '^[A-Za-z0-9_-]{6,40}$' or p_id = '__proto__'
     or p_data is null or jsonb_typeof(p_data) <> 'object'
     or pg_column_size(p_data) > 8000
     or char_length(coalesce(p_data ->> 'text', '')) > 4000 then
    perform pf.fail('400', 'invalid_argument');
  end if;

  perform pf.check_rate(p_project, v_author);

  select * into v_row from pf.docs
    where project = p_project and collection = p_collection and id = p_id
    for update;
  v_exists := found;

  if v_exists then
    if not v_owner and v_row.author <> v_author then
      perform pf.fail('403', 'not_granted');
    end if;
    v_data := case when p_merge then v_row.data || p_data else p_data end;
  else
    if (select count(*) from pf.docs where project = p_project)
       >= (select max_docs from pf.projects where slug = p_project) then
      perform pf.fail('429', 'quota_exceeded');
    end if;
    v_data := p_data;
  end if;

  if not v_owner then
    foreach k in array v_guarded loop
      v_data := v_data - k;
      if v_exists and v_row.data ? k then
        v_data := v_data || jsonb_build_object(k, v_row.data -> k);
      end if;
    end loop;
    if not v_exists and p_collection = 'comments' then
      v_data := v_data || '{"status": "open", "resolvedIn": null}'::jsonb;
    end if;
  end if;

  -- The server decides who wrote it.
  v_data := v_data || jsonb_build_object(
    'author', case when v_exists then v_row.author else v_author end,
    'byOwner', case when v_exists then v_row.by_owner else v_owner end);
  if pg_column_size(v_data) > 9000 then
    perform pf.fail('400', 'invalid_argument');
  end if;

  if v_exists then
    update pf.docs set data = v_data, updated_at = now()
      where project = p_project and collection = p_collection and id = p_id
      returning * into v_row;
  else
    insert into pf.docs (project, collection, id, author, by_owner, data)
      values (p_project, p_collection, p_id, v_author, v_owner, v_data)
      returning * into v_row;
  end if;

  return jsonb_build_object(
    'collection', v_row.collection, 'id', v_row.id, 'author', v_row.author,
    'byOwner', v_row.by_owner, 'data', v_row.data,
    'createdAt', v_row.created_at, 'updatedAt', v_row.updated_at);
end $$;

-- Delete your own comment or reply (the owner can delete any). Deleting a comment
-- also deletes its replies.
create or replace function public.pf_delete(
  p_project text, p_collection text, p_id text, p_secret text, p_owner_key text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_owner boolean;
  v_author text;
  v_row_author text;
begin
  perform pf.require_project(p_project);
  v_author := pf.owner_of(p_project, p_owner_key);
  v_owner := v_author is not null;
  v_author := coalesce(v_author, pf.author_of(p_secret));
  if p_collection is null or p_collection not in ('comments', 'replies') then
    perform pf.fail('400', 'invalid_argument');
  end if;
  perform pf.check_rate(p_project, v_author);
  select author into v_row_author from pf.docs
    where project = p_project and collection = p_collection and id = p_id
    for update;
  if not found then
    return;
  end if;
  if not v_owner and v_row_author <> v_author then
    perform pf.fail('403', 'not_granted');
  end if;
  delete from pf.docs
    where project = p_project and collection = p_collection and id = p_id
      and author = v_row_author;
  if p_collection = 'comments' then
    delete from pf.docs
      where project = p_project and collection = 'replies' and data ->> 'commentId' = p_id;
  end if;
end $$;

-- Set the name shown beside this browser's comments.
create or replace function public.pf_set_name(
  p_project text, p_secret text, p_name text, p_owner_key text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_author text;
  v_name text;
begin
  perform pf.require_project(p_project);
  v_author := coalesce(pf.owner_of(p_project, p_owner_key), pf.author_of(p_secret));
  v_name := left(btrim(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]]+', ' ', 'g')), 60);
  if v_name = '' then
    perform pf.fail('400', 'invalid_argument');
  end if;
  perform pf.check_rate(p_project, v_author);
  if not exists (select 1 from pf.names where project = p_project and author = v_author)
     and (select count(*) from pf.names where project = p_project)
         >= (select max_names from pf.projects where slug = p_project) then
    perform pf.fail('429', 'quota_exceeded');
  end if;
  insert into pf.names (project, author, name) values (p_project, v_author, v_name)
    on conflict (project, author) do update set name = excluded.name, updated_at = now();
  return jsonb_build_object('author', v_author, 'name', v_name);
end $$;

revoke all on function public.pf_list(text) from public;
revoke all on function public.pf_whoami(text, text, text) from public;
revoke all on function public.pf_write(text, text, text, jsonb, text, text, boolean) from public;
revoke all on function public.pf_delete(text, text, text, text, text) from public;
revoke all on function public.pf_set_name(text, text, text, text) from public;
grant execute on function public.pf_list(text) to anon, authenticated;
grant execute on function public.pf_whoami(text, text, text) to anon, authenticated;
grant execute on function public.pf_write(text, text, text, jsonb, text, text, boolean) to anon, authenticated;
grant execute on function public.pf_delete(text, text, text, text, text) to anon, authenticated;
grant execute on function public.pf_set_name(text, text, text, text) to anon, authenticated;

-- Add a project (run as the database owner, never from the page):
--   insert into pf.projects (slug, owner_key_hash)
--   values ('my-proto-x7k2q', sha256(convert_to('<owner key>', 'UTF8')));
-- Add a separate owner identity (1-24 lowercase letters, digits or hyphens; start
-- with a letter or digit). Share that owner's private ?owner=<key> link only with them:
--   insert into pf.owner_keys (project, owner_id, key_hash)
--   values ('<slug>', '<id>', sha256(convert_to('<key>', 'UTF8')));
-- Revoke the extra key without removing its comments or display name:
--   delete from pf.owner_keys where project = '<slug>' and owner_id = '<id>';
-- A key maps to one owner per project. To give one person the same link in several
-- projects, add one row per project with the same key; it grants access only where
-- its hash was provisioned. Reusing an owner_id restores its identity.
