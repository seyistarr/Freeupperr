-- Public-only sitemap listing; no private content or media URLs.
create or replace function public.list_public_post_sitemap(p_after text default '', p_limit integer default 1000)
returns table(short_code text, media_type text, created_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select l.code, p.media_type, p.created_at
  from public.post_short_links l
  join public.posts p on p.id = l.post_id
  join public.profiles u on u.id = p.user_id
  where l.code > coalesce(p_after, '')
    and p.visibility = 'public'
    and coalesce(p.is_deleted, false) = false
    and coalesce(p.is_hidden, false) = false
    and coalesce(u.is_private, true) = false
    and coalesce(u.suspended, false) = false
    and nullif(trim(coalesce(u.username, '')), '') is not null
  order by l.code
  limit least(greatest(coalesce(p_limit, 1000), 1), 1000)
$$;
revoke all on function public.list_public_post_sitemap(text, integer) from public, anon, authenticated;
grant execute on function public.list_public_post_sitemap(text, integer) to anon;
