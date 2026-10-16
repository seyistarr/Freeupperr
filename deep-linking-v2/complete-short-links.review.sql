-- Deep Linking V2 — complete migration CANDIDATE, review-only.
-- Do not apply to production until a migration review and negative privacy tests pass.
-- Assumes pgcrypto installed as extensions.pgcrypto (verified 2026-10-16).
begin;
create table if not exists public.post_short_links (
  code text primary key check (code ~ '^[A-Za-z0-9_-]{6,16}$'),
  post_id uuid not null unique references public.posts(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.post_short_links enable row level security;
revoke all on public.post_short_links from public, anon, authenticated;

create or replace function public.allocate_post_short_code(p_post_id uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  candidate text;
  attempt integer;
begin
  -- Only invoked by the post-insert trigger or a privileged backfill.
  -- Never grant EXECUTE to client roles.
  select code into candidate from public.post_short_links where post_id = p_post_id;
  if candidate is not null then return candidate; end if;
  for attempt in 1..12 loop
    candidate := translate(rtrim(pg_catalog.encode(extensions.gen_random_bytes(7), 'base64'), '='), '+/', '-_');
    insert into public.post_short_links (code, post_id)
      values (candidate, p_post_id)
      on conflict do nothing;
    if found then return candidate; end if;
    select code into candidate from public.post_short_links where post_id = p_post_id;
    if candidate is not null then return candidate; end if;
  end loop;
  raise exception 'Could not allocate post short code';
end;
$$;
revoke all on function public.allocate_post_short_code(uuid) from public, anon, authenticated;

create or replace function public.create_post_short_link_on_insert()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform public.allocate_post_short_code(new.id);
  return new;
end;
$$;
revoke all on function public.create_post_short_link_on_insert() from public, anon, authenticated;
drop trigger if exists trg_create_post_short_link on public.posts;
create trigger trg_create_post_short_link after insert on public.posts
for each row execute function public.create_post_short_link_on_insert();

-- Only expose a code if BOTH the post and author are publicly visible.
-- Return no rows for private accounts, restricted, hidden or deleted posts.
create or replace function public.get_public_short_code_for_post(p_post_id uuid)
returns table (short_code text)
language sql stable security definer set search_path = ''
as $$
  select l.code
  from public.post_short_links l
  join public.posts p on p.id = l.post_id
  join public.profiles u on u.id = p.user_id
  where p.id = p_post_id
    and p.visibility = 'public'
    and coalesce(p.is_deleted, false) = false
    and coalesce(p.is_hidden, false) = false
    and coalesce(u.is_private, true) = false
  limit 1
$$;
revoke all on function public.get_public_short_code_for_post(uuid) from public;
grant execute on function public.get_public_short_code_for_post(uuid) to anon, authenticated;

create or replace function public.get_public_post_by_short_code(p_code text)
returns table (
  id uuid, media_type text, title text, description text, content text,
  media_url text, thumbnail_url text, text_template_id text, short_code text
)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.media_type, p.title, p.description, p.content,
         p.media_url, p.thumbnail_url, p.text_template_id, l.code
  from public.post_short_links l
  join public.posts p on p.id = l.post_id
  join public.profiles u on u.id = p.user_id
  where l.code = p_code
    and p.visibility = 'public'
    and coalesce(p.is_deleted, false) = false
    and coalesce(p.is_hidden, false) = false
    and coalesce(u.is_private, true) = false
  limit 1
$$;
revoke all on function public.get_public_post_by_short_code(text) from public;
grant execute on function public.get_public_post_by_short_code(text) to anon, authenticated;
commit;

-- Backfill in separate small transactions, not in this migration.
-- Example: select public.allocate_post_short_code(id)
-- from public.posts p
-- where not exists (select 1 from public.post_short_links l where l.post_id=p.id)
-- order by p.created_at limit 250;
-- IMPORTANT: verify function ownership, role grants, PostgREST RPC exposure,
-- media URL public-delivery policy, and RLS tests before production execution.
