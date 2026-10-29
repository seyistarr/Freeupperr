-- REVIEW ONLY. Production project jmjtqidirpmnegzvmiaq. Do not apply without approval.
-- Generated with Supabase CLI 2.122.0; held outside the automatic migration path.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
-- Fail on unreviewed changes to the existing counter owners. Reapplication is safe.
DO $$
BEGIN
 IF to_regclass('privacy_v2_private.quote_repost_rollout') IS NULL THEN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.toggle_repost(uuid,text)'::regprocedure)
       IS DISTINCT FROM 'e43b1aa6b3b9830cc2635ea85886b34c'
   OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.toggle_repost(uuid,uuid,text)'::regprocedure)
       IS DISTINCT FROM '88c39cc3d310e4d8fb27b66910505d3c' THEN
   RAISE EXCEPTION 'Repost RPC drift: repeat the production audit before applying';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.reposts'::regclass
      AND NOT tgisinternal AND tgname NOT IN ('trg_notify_repost','trg_repost_word_limit')) THEN
   RAISE EXCEPTION 'Unreviewed repost trigger';
  END IF;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid='public.posts'::regclass AND relrowsecurity) THEN
  RAISE EXCEPTION 'Posts RLS must remain enabled';
 END IF;
END $$;
-- Serialize the counter handover with every concurrent legacy write.
LOCK TABLE public.posts, public.reposts IN SHARE ROW EXCLUSIVE MODE;
CREATE TABLE IF NOT EXISTS privacy_v2_private.quote_repost_rollout (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version=1),
 read_enabled boolean NOT NULL DEFAULT true,
 publishing_enabled boolean NOT NULL DEFAULT false
);
ALTER TABLE privacy_v2_private.quote_repost_rollout ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON privacy_v2_private.quote_repost_rollout FROM PUBLIC, anon, authenticated;
INSERT INTO privacy_v2_private.quote_repost_rollout(singleton) VALUES(true) ON CONFLICT DO NOTHING;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS quoted_post_id uuid;
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS is_quote boolean NOT NULL DEFAULT false;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.posts'::regclass AND conname='posts_quoted_post_id_fkey') THEN
  ALTER TABLE public.posts ADD CONSTRAINT posts_quoted_post_id_fkey FOREIGN KEY(quoted_post_id)
   REFERENCES public.posts(id) ON DELETE SET NULL;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.posts'::regclass AND conname='posts_quote_shape') THEN
  ALTER TABLE public.posts ADD CONSTRAINT posts_quote_shape CHECK
   ((is_quote OR quoted_post_id IS NULL) AND id IS DISTINCT FROM quoted_post_id);
 END IF;
END $$;
CREATE INDEX IF NOT EXISTS posts_quoted_post_id_idx ON public.posts(quoted_post_id) WHERE quoted_post_id IS NOT NULL;

-- No content copies, no nested expansion, no protected/verification origins.
-- This private predicate is also evaluated at READ time, not just at creation.
CREATE OR REPLACE FUNCTION privacy_v2_private.quote_target_allowed(p_id uuid,p_viewer uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(
  SELECT 1 FROM public.posts p JOIN public.profiles a ON a.id=p.user_id
  WHERE p.id=p_id AND p.visibility='public' AND p.publishing_state='published'
   AND p.is_hidden IS FALSE AND p.is_deleted IS FALSE
   AND a.is_private IS FALSE AND a.suspended IS FALSE AND a.hide_all_posts IS FALSE
   AND NOT EXISTS(SELECT 1 FROM privacy_v2_private.protected_post_origins o WHERE o.post_id=p.id)
   AND NOT EXISTS(SELECT 1 FROM privacy_v2_private.verification_posts v WHERE v.post_id=p.id)
   AND NOT EXISTS(SELECT 1 FROM privacy_v2_private.post_deletions d WHERE d.post_id=p.id)
   AND NOT EXISTS(SELECT 1 FROM public.blocks b WHERE
    (b.blocker_id=p_viewer AND b.blocked_id=p.user_id) OR
    (b.blocked_id=p_viewer AND b.blocker_id=p.user_id))
 );
$$;
REVOKE ALL ON FUNCTION privacy_v2_private.quote_target_allowed(uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.quote_repost_status()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('schemaVersion',schema_version,'readEnabled',read_enabled,
  'publishingEnabled',publishing_enabled) FROM privacy_v2_private.quote_repost_rollout WHERE singleton;
$$;
REVOKE ALL ON FUNCTION public.quote_repost_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.quote_repost_status() TO anon,authenticated;

-- Only this boolean predicate reads private registries. Original content is
-- projected by the INVOKER below, preserving all current and future post RLS.
CREATE OR REPLACE FUNCTION public.quote_target_readable(p_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((SELECT read_enabled FROM privacy_v2_private.quote_repost_rollout WHERE singleton),false)
  AND privacy_v2_private.quote_target_allowed(p_id,auth.uid());
$$;
REVOKE ALL ON FUNCTION public.quote_target_readable(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.quote_target_readable(uuid) TO anon,authenticated;
CREATE OR REPLACE FUNCTION public.get_quotable_post(p_post_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT jsonb_build_object('id',p.id,'user_id',p.user_id,'title',p.title,'content',p.content,
  'media',p.media,'media_url',p.media_url,'media_type',p.media_type,'thumbnail_url',p.thumbnail_url,
  'created_at',p.created_at,'visibility','public','profiles',jsonb_build_object(
   'id',a.id,'display_name',a.display_name,'username',a.username,'avatar_url',a.avatar_url,
   'verified',a.verified,'verified_status',a.verified_status))
 FROM public.posts p JOIN public.profiles a ON a.id=p.user_id
 WHERE p.id=p_post_id AND public.quote_target_readable(p.id);
$$;
REVOKE ALL ON FUNCTION public.get_quotable_post(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_quotable_post(uuid) TO anon,authenticated;
-- An additive restriction, never a replacement or widening of existing policies.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='posts' AND policyname='quote_repost_target_insert') THEN
  CREATE POLICY quote_repost_target_insert ON public.posts AS RESTRICTIVE
   FOR INSERT TO anon,authenticated WITH CHECK(NOT is_quote OR public.get_quotable_post(quoted_post_id) IS NOT NULL);
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.load_quote_references(p_post_ids uuid[])
RETURNS TABLE(post_id uuid,original jsonb)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF coalesce(cardinality(p_post_ids),0)>100 THEN RAISE EXCEPTION 'At most 100 quote posts per request' USING ERRCODE='22023'; END IF;
 RETURN QUERY SELECT q.id, public.get_quotable_post(q.quoted_post_id)
 FROM public.posts q WHERE q.id=ANY(p_post_ids) AND q.is_quote;
END $$;
REVOKE ALL ON FUNCTION public.load_quote_references(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.load_quote_references(uuid[]) TO anon,authenticated;

-- Validate every write path, including direct REST and SECURITY DEFINER callers.
CREATE OR REPLACE FUNCTION privacy_v2_private.quote_write_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target_owner uuid; m jsonb; enabled boolean;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.is_quote IS DISTINCT FROM OLD.is_quote OR ((OLD.is_quote OR NEW.is_quote) AND NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
   RAISE EXCEPTION 'Quote identity is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.quoted_post_id IS DISTINCT FROM OLD.quoted_post_id AND
    NOT (OLD.is_quote AND NEW.quoted_post_id IS NULL AND NOT EXISTS(SELECT 1 FROM public.posts WHERE id=OLD.quoted_post_id)) THEN
   RAISE EXCEPTION 'Quote target is immutable' USING ERRCODE='23514';
  END IF;
 END IF;
 IF NOT NEW.is_quote THEN RETURN NEW; END IF;
 IF NEW.visibility IS DISTINCT FROM 'public' OR NEW.publishing_state IS DISTINCT FROM 'published' THEN
  RAISE EXCEPTION 'Quotes must be published with Public audience' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM privacy_v2_private.protected_post_origins WHERE post_id=NEW.id) THEN
  RAISE EXCEPTION 'Protected quote media is unsupported' USING ERRCODE='23514';
 END IF;
 IF TG_OP='INSERT' THEN
  SELECT publishing_enabled INTO enabled FROM privacy_v2_private.quote_repost_rollout WHERE singleton FOR SHARE;
  IF NOT coalesce(enabled,false) THEN RAISE EXCEPTION 'Quote publishing is disabled' USING ERRCODE='42501'; END IF;
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM NEW.user_id OR coalesce((auth.jwt()->>'is_anonymous')::boolean,false) THEN
   RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501';
  END IF;
  -- Serialize validation against original deletion/visibility and account changes.
  SELECT user_id INTO target_owner FROM public.posts WHERE id=NEW.quoted_post_id FOR UPDATE;
  PERFORM 1 FROM public.profiles WHERE id IN (target_owner,NEW.user_id) ORDER BY id FOR SHARE;
  IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=NEW.user_id AND suspended IS FALSE)
   OR NOT privacy_v2_private.quote_target_allowed(NEW.quoted_post_id,NEW.user_id) THEN
   RAISE EXCEPTION 'This post cannot be quoted' USING ERRCODE='42501';
  END IF;
  IF NEW.is_hidden IS DISTINCT FROM false OR NEW.is_deleted IS DISTINCT FROM false THEN
   RAISE EXCEPTION 'Invalid initial quote state' USING ERRCODE='23514';
  END IF;
 END IF;
 IF length(coalesce(NEW.title,''))>100 OR length(coalesce(NEW.content,''))>10000
   OR jsonb_typeof(coalesce(NEW.media,'[]'::jsonb))<>'array' OR jsonb_array_length(coalesce(NEW.media,'[]'::jsonb))>20 THEN
  RAISE EXCEPTION 'Invalid quote content or media' USING ERRCODE='22023';
 END IF;
 IF (coalesce(NEW.media_url,'')<>'' AND NEW.media_url !~ '^https?://')
   OR (coalesce(NEW.thumbnail_url,'')<>'' AND NEW.thumbnail_url !~ '^https?://') THEN
  RAISE EXCEPTION 'Invalid public media URL' USING ERRCODE='22023';
 END IF;
 FOR m IN SELECT value FROM jsonb_array_elements(coalesce(NEW.media,'[]'::jsonb)) LOOP
  IF jsonb_typeof(m)<>'object' OR m ?| ARRAY['asset_id','assetId','thumbnail_asset_id','protected']
   OR coalesce(m->>'type','') NOT IN ('image','video') OR coalesce(m->>'url','') !~ '^https?://'
   OR (coalesce(m->>'thumbnailUrl','')<>'' AND m->>'thumbnailUrl' !~ '^https?://') THEN
   RAISE EXCEPTION 'Only existing public image/video media is supported for quotes' USING ERRCODE='22023';
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION privacy_v2_private.quote_write_guard() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS quote_repost_write_guard ON public.posts;
CREATE TRIGGER quote_repost_write_guard BEFORE INSERT OR UPDATE OF is_quote,quoted_post_id,user_id,visibility,publishing_state,is_hidden,is_deleted,media,title,content
ON public.posts FOR EACH ROW EXECUTE FUNCTION privacy_v2_private.quote_write_guard();

-- One counter owner for both plain rows and live, globally public authored quotes.
-- Each plain row and each distinct quote post contributes once (not once per actor).
CREATE OR REPLACE FUNCTION privacy_v2_private.expected_repost_count(p_id uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT ((SELECT count(*) FROM public.reposts WHERE post_id=p_id) +
  (SELECT count(*) FROM public.posts q WHERE q.quoted_post_id=p_id AND q.is_quote
   AND privacy_v2_private.quote_target_allowed(q.id,NULL)
   AND privacy_v2_private.quote_target_allowed(p_id,q.user_id)))::integer;
$$;
REVOKE ALL ON FUNCTION privacy_v2_private.expected_repost_count(uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION privacy_v2_private.refresh_repost_counts(p_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 -- Row locks + a fresh subsequent statement avoid lost updates under READ COMMITTED.
 PERFORM 1 FROM public.posts WHERE id=ANY(p_ids) ORDER BY id FOR UPDATE;
 UPDATE public.posts p SET repost_count=privacy_v2_private.expected_repost_count(p.id)
 WHERE p.id=ANY(p_ids) AND p.repost_count IS DISTINCT FROM privacy_v2_private.expected_repost_count(p.id);
END $$;
REVOKE ALL ON FUNCTION privacy_v2_private.refresh_repost_counts(uuid[]) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION privacy_v2_private.quote_counter_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ids uuid[];
BEGIN
 IF TG_TABLE_NAME='reposts' THEN
  ids:=ARRAY[CASE WHEN TG_OP<>'INSERT' THEN OLD.post_id END,CASE WHEN TG_OP<>'DELETE' THEN NEW.post_id END];
 ELSIF TG_TABLE_NAME='posts' THEN
  ids:=ARRAY[CASE WHEN TG_OP<>'INSERT' THEN OLD.quoted_post_id END,CASE WHEN TG_OP<>'DELETE' THEN NEW.quoted_post_id END,
   CASE WHEN TG_OP<>'DELETE' THEN NEW.id END];
 ELSE
  -- Profile privacy/moderation or a block can invalidate contributions on either side.
  -- This is indexed by quoted_post_id and runs only on relationship/privacy writes.
  SELECT array_agg(DISTINCT quoted_post_id) INTO ids FROM public.posts WHERE quoted_post_id IS NOT NULL;
 END IF;
 PERFORM privacy_v2_private.refresh_repost_counts(ids);
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION privacy_v2_private.quote_counter_event() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS quote_repost_plain_counter ON public.reposts;
CREATE TRIGGER quote_repost_plain_counter AFTER INSERT OR DELETE OR UPDATE OF post_id ON public.reposts
FOR EACH ROW EXECUTE FUNCTION privacy_v2_private.quote_counter_event();
DROP TRIGGER IF EXISTS quote_repost_post_counter ON public.posts;
CREATE TRIGGER quote_repost_post_counter AFTER INSERT OR DELETE OR UPDATE OF quoted_post_id,is_quote,user_id,visibility,publishing_state,is_hidden,is_deleted
ON public.posts FOR EACH ROW EXECUTE FUNCTION privacy_v2_private.quote_counter_event();
DROP TRIGGER IF EXISTS quote_repost_profile_counter ON public.profiles;
CREATE TRIGGER quote_repost_profile_counter AFTER UPDATE OF is_private,suspended,hide_all_posts ON public.profiles
FOR EACH ROW EXECUTE FUNCTION privacy_v2_private.quote_counter_event();
DROP TRIGGER IF EXISTS quote_repost_block_counter ON public.blocks;
CREATE TRIGGER quote_repost_block_counter AFTER INSERT OR DELETE OR UPDATE ON public.blocks
FOR EACH ROW EXECUTE FUNCTION privacy_v2_private.quote_counter_event();
-- Counter values supplied by a client or a legacy SECURITY DEFINER writer are never authoritative.
CREATE OR REPLACE FUNCTION privacy_v2_private.canonical_repost_count()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 NEW.repost_count:=CASE WHEN TG_OP='INSERT' THEN 0 ELSE privacy_v2_private.expected_repost_count(NEW.id) END;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION privacy_v2_private.canonical_repost_count() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS quote_repost_canonical_count ON public.posts;
CREATE TRIGGER quote_repost_canonical_count BEFORE INSERT OR UPDATE OF repost_count ON public.posts
FOR EACH ROW EXECUTE FUNCTION privacy_v2_private.canonical_repost_count();

-- Preserve both deployed RPC contracts; row triggers now own all counter updates.
CREATE OR REPLACE FUNCTION public.toggle_repost(p_post_id uuid,p_user_id uuid,p_comment text DEFAULT '')
RETURNS TABLE(reposted boolean,count integer,out_comment text,out_time timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE exists_before boolean; result_count integer; result_time timestamptz:=now();
BEGIN
 IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.posts WHERE id=p_post_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Post not found'; END IF;
 SELECT EXISTS(SELECT 1 FROM public.reposts WHERE post_id=p_post_id AND user_id=p_user_id) INTO exists_before;
 IF exists_before THEN DELETE FROM public.reposts WHERE post_id=p_post_id AND user_id=p_user_id;
 ELSE INSERT INTO public.reposts(post_id,user_id,comment,created_at) VALUES(p_post_id,p_user_id,coalesce(p_comment,''),result_time);
 END IF;
 SELECT repost_count INTO result_count FROM public.posts WHERE id=p_post_id;
 RETURN QUERY SELECT NOT exists_before,result_count,CASE WHEN exists_before THEN '' ELSE coalesce(p_comment,'') END,
  CASE WHEN exists_before THEN NULL::timestamptz ELSE result_time END;
END $$;
CREATE OR REPLACE FUNCTION public.toggle_repost(p_post_id uuid,p_comment text DEFAULT '')
RETURNS TABLE(reposted boolean,new_count integer,repost_comment text,reposted_at timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT r.reposted,r.count,r.out_comment,r.out_time FROM public.toggle_repost(p_post_id,auth.uid(),p_comment) r;
$$;
-- Existing ACLs remain unchanged on both replaced RPCs.

-- INVOKER insert preserves every existing post INSERT policy and Privacy V2 trigger.
-- A client-generated post ID is the idempotency key: retries return B, never create C.
CREATE OR REPLACE FUNCTION public.create_quote_post(p_post_id uuid,p_quoted_post_id uuid,p_fields jsonb DEFAULT '{}')
RETURNS public.posts LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE result public.posts; input public.posts;
BEGIN
 IF auth.uid() IS NULL OR coalesce((auth.jwt()->>'is_anonymous')::boolean,false) THEN RAISE EXCEPTION 'Not authorized' USING ERRCODE='42501'; END IF;
 IF p_post_id IS NULL OR p_quoted_post_id IS NULL OR p_post_id=p_quoted_post_id THEN RAISE EXCEPTION 'Invalid quote identity' USING ERRCODE='22023'; END IF;
 IF NOT coalesce((public.quote_repost_status()->>'publishingEnabled')::boolean,false) THEN RAISE EXCEPTION 'Quote publishing is disabled' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_fields) IS DISTINCT FROM 'object' OR (p_fields - ARRAY['title','description','content','category','tags','media','media_url','media_type','thumbnail_url','mentions','comments_hidden','sound_id','source','text_template_id','image_embedding'])<>'{}'::jsonb THEN
  RAISE EXCEPTION 'Unexpected quote fields' USING ERRCODE='22023';
 END IF;
 SELECT * INTO result FROM public.posts WHERE id=p_post_id AND user_id=auth.uid();
 IF FOUND THEN
  IF NOT result.is_quote OR result.quoted_post_id IS DISTINCT FROM p_quoted_post_id OR result.is_deleted IS NOT FALSE THEN
   RAISE EXCEPTION 'Quote request ID was already used' USING ERRCODE='23505';
  END IF;
  RETURN result;
 END IF;
 input:=jsonb_populate_record(NULL::public.posts,p_fields);
 INSERT INTO public.posts(id,user_id,is_quote,quoted_post_id,title,description,content,category,tags,media,media_url,media_type,thumbnail_url,mentions,comments_hidden,sound_id,source,text_template_id,image_embedding,visibility)
 VALUES(p_post_id,auth.uid(),true,p_quoted_post_id,coalesce(input.title,''),coalesce(input.description,''),coalesce(input.content,''),coalesce(input.category,'General'),coalesce(input.tags,'{}'),coalesce(input.media,'[]'),input.media_url,input.media_type,input.thumbnail_url,coalesce(input.mentions,'[]'),coalesce(input.comments_hidden,false),input.sound_id,coalesce(input.source,'composer'),input.text_template_id,input.image_embedding,'public')
 ON CONFLICT(id) DO NOTHING RETURNING * INTO result;
 IF result.id IS NULL THEN
  SELECT * INTO result FROM public.posts WHERE id=p_post_id AND user_id=auth.uid() AND is_quote AND quoted_post_id=p_quoted_post_id AND is_deleted IS FALSE;
  IF result.id IS NULL THEN RAISE EXCEPTION 'Quote request ID was already used' USING ERRCODE='23505'; END IF;
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.create_quote_post(uuid,uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_quote_post(uuid,uuid,jsonb) TO authenticated;
-- Reconcile once during the atomic handover (also safe on reapplication).
SELECT privacy_v2_private.refresh_repost_counts(array_agg(id)) FROM public.posts;
NOTIFY pgrst, 'reload schema';
COMMIT;
