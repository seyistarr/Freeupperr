-- Parent-row surfaces omitted by the original media-only dependency snapshot.
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS sound_id text;
CREATE TABLE public.comments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),post_id uuid,user_id uuid,content text);
CREATE TABLE public.post_likes(post_id uuid,user_id uuid);
CREATE TABLE public.reposts(post_id uuid,user_id uuid,comment text);
CREATE TABLE public.notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),post_id uuid,comment_id uuid,receiver_id uuid,content text);
CREATE TABLE public.mentions(post_id uuid);
CREATE TABLE public.post_hashtags(post_id uuid);
CREATE TABLE public.post_media(post_id uuid);
CREATE TABLE public.post_short_links(post_id uuid);
CREATE TABLE public.post_views(post_id uuid);
CREATE TABLE public.shares(post_id uuid);
CREATE TABLE public.bookmarks(post_id uuid);
CREATE TABLE public.sounds(source_post_id uuid);
DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['comments','post_likes','reposts','notifications','mentions','post_hashtags','post_media','post_short_links','post_views','shares','bookmarks','sounds'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tbl);
  EXECUTE format('CREATE POLICY legacy_open ON public.%I FOR ALL TO anon,authenticated USING(true) WITH CHECK(true)',tbl);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO anon,authenticated,service_role',tbl);
 END LOOP;
END $$;
-- The production anonymous post policy also bounds every child row lookup.
GRANT SELECT ON public.posts TO anon;
CREATE POLICY anonymous_public ON public.posts FOR SELECT TO anon
USING(visibility='public' AND publishing_state='published' AND is_hidden IS FALSE AND is_deleted IS FALSE);
