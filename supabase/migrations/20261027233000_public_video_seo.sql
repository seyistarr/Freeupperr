-- Expose only metadata for public videos belonging to public, unsuspended accounts.
create or replace function public.get_public_video_seo(p_code text)
returns table (published_at timestamptz, public_video_url text, public_thumbnail_url text)
language sql stable security definer set search_path = ''
as $$
 select p.created_at,
   case when p.media_url ~ '^https://res[.]cloudinary[.]com/[^ ]+/video/upload/' then p.media_url else null end,
   case when p.thumbnail_url ~ '^https://(res[.]cloudinary[.]com|jmjtqidirpmnegzvmiaq[.]supabase[.]co)/' then p.thumbnail_url else null end
 from public.post_short_links l
 join public.posts p on p.id=l.post_id
 join public.profiles u on u.id=p.user_id
 where l.code=p_code and p.media_type='video'
   and p.visibility='public' and coalesce(p.is_deleted,false)=false
   and coalesce(p.is_hidden,false)=false
   and coalesce(u.is_private,true)=false
   and coalesce(u.suspended,false)=false
 limit 1
$$;
revoke all on function public.get_public_video_seo(text) from public, anon, authenticated;
grant execute on function public.get_public_video_seo(text) to anon;
