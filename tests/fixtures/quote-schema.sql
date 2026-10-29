-- Synthetic rows only. Relevant production functions/policies are loaded verbatim from quote-production-catalog.json.
-- image_embedding is text locally; pgvector similarity and unrelated notifications are outside this fixture.
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth; CREATE SCHEMA privacy_v2_private;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
GRANT USAGE ON SCHEMA auth TO anon,authenticated;
CREATE TABLE public.profiles(id uuid PRIMARY KEY,display_name text,username text,avatar_url text,verified boolean DEFAULT false,verified_status text DEFAULT 'none',is_private boolean DEFAULT false,suspended boolean DEFAULT false,hide_all_posts boolean DEFAULT false,is_admin boolean DEFAULT false);
CREATE TABLE public.follows(follower_id uuid,following_id uuid,status text DEFAULT 'active');
CREATE TABLE public.blocks(blocker_id uuid,blocked_id uuid);
CREATE TABLE privacy_v2_private.follow_approvals(follower_id uuid,following_id uuid,approval_kind text);
CREATE TABLE privacy_v2_private.protected_post_origins(post_id uuid PRIMARY KEY,owner_id uuid);
CREATE TABLE privacy_v2_private.post_deletions(post_id uuid PRIMARY KEY,owner_id uuid,deleted_at timestamptz DEFAULT now(),purge_after timestamptz,permanent boolean DEFAULT false,previous_state text,previous_hidden boolean);
CREATE TABLE privacy_v2_private.verification_posts(post_id uuid PRIMARY KEY,owner_id uuid,expires_at timestamptz,retired_at timestamptz);
CREATE TABLE public.post_media_assets(post_id uuid,status text);
CREATE TABLE public.posts(
 id uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL,
 title text NOT NULL,
 description text,
 content text,
 media_url text,
 media_type text,
 category text DEFAULT 'General'::text,
 tags text[] DEFAULT '{}'::text[],
 likes_count integer DEFAULT 0,
 comments_count integer DEFAULT 0,
 shares_count integer DEFAULT 0,
 views integer DEFAULT 0,
 created_at timestamp with time zone DEFAULT now(),
 updated_at timestamp with time zone DEFAULT now(),
 media jsonb,
 version integer DEFAULT 1,
 edited_at timestamp with time zone,
 is_deleted boolean DEFAULT false,
 deleted_at timestamp with time zone,
 visibility text DEFAULT 'public'::text,
 repost_count integer NOT NULL DEFAULT 0,
 thumbnail_url text,
 image_public_id text,
 video_public_id text,
 mentions jsonb DEFAULT '[]'::jsonb,
 share_count integer DEFAULT 0,
 bookmark_count integer DEFAULT 0,
 like_count integer DEFAULT 0,
 comment_count integer DEFAULT 0,
 is_hidden boolean DEFAULT false,
 comments_hidden boolean DEFAULT false,
 sound_id text,
 is_pinned boolean NOT NULL DEFAULT false,
 source text NOT NULL DEFAULT 'composer'::text,
 text_template_id text,
 image_embedding text,
 publishing_state text NOT NULL DEFAULT 'published'::text,
 media_plan jsonb NOT NULL DEFAULT '[]'::jsonb,
 publish_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
 draft_expires_at timestamp with time zone,
 cleanup_lease uuid,
 cleanup_lease_until timestamp with time zone
);
CREATE TABLE public.reposts(
 id uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
 post_id uuid NOT NULL,
 user_id uuid NOT NULL,
 comment text DEFAULT ''::text,
 created_at timestamp with time zone NOT NULL DEFAULT now(),
 UNIQUE(post_id,user_id),FOREIGN KEY(post_id) REFERENCES public.posts(id) ON DELETE CASCADE);
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reposts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.posts TO anon,authenticated;
GRANT SELECT ON public.reposts TO authenticated;
GRANT SELECT ON public.posts,public.profiles TO anon;
GRANT SELECT(id,display_name,username,avatar_url,verified,verified_status,is_private,hide_all_posts,is_admin) ON public.profiles TO authenticated;
-- Profile-tab authorization is unchanged and tested by the existing profile suite.
CREATE FUNCTION public.can_view_profile_tab(uuid,text) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
REVOKE ALL ON SCHEMA privacy_v2_private FROM PUBLIC,anon,authenticated;
