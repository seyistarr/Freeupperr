-- Review-only migration. Do not run against production until approved.
create table if not exists public.post_short_links (
  code text primary key check (code ~ '^[A-Za-z0-9_-]{6,16}$'),
  post_id uuid not null unique references public.posts(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.post_short_links enable row level security;
revoke all on public.post_short_links from public, anon, authenticated;
-- Privileged server workflow must generate and insert codes with a uniqueness retry.
-- A dedicated public preview RPC can return ONLY explicitly public posts.
create or replace function public.get_public_post_by_short_code(p_code text)
returns table (
  id uuid, media_type text, title text, description text, content text,
  media_url text, thumbnail_url text, text_template_id text
)
language sql stable security definer
set search_path = ''
as $$
  select p.id, p.media_type, p.title, p.description, p.content,
         p.media_url, p.thumbnail_url, p.text_template_id
  from public.post_short_links l
  join public.posts p on p.id = l.post_id
  join public.profiles u on u.id = p.user_id
  where l.code = p_code
    and p.visibility = 'public'
    and p.is_deleted is false
    and coalesce(p.is_hidden, false) = false
    and u.is_private is false
  limit 1
$$;
revoke all on function public.get_public_post_by_short_code(text) from public;
grant execute on function public.get_public_post_by_short_code(text) to anon, authenticated;
