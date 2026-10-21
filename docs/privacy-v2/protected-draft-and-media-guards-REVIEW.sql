-- REVIEW ONLY. Depends on complete protected-first release guards and explicit approval.
-- Never execute this independently or enable production publishing from this file.
BEGIN;
CREATE FUNCTION public.create_protected_draft(p_owner uuid,p_post uuid,p_visibility text,p_plan jsonb,p_fields jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE item jsonb; videos integer; images integer;
BEGIN
 IF p_post IS NULL OR p_owner IS NULL OR p_visibility IS NULL OR p_visibility NOT IN ('followers','friends','only_me') OR
  jsonb_typeof(p_plan) IS DISTINCT FROM 'array' OR jsonb_array_length(p_plan) NOT BETWEEN 1 AND 20 OR
  NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_owner AND suspended=false)
 THEN RAISE EXCEPTION 'Owned restricted image/video draft required'; END IF;
 -- A video plan has exactly two slots: video 0 and required image poster 20.
 SELECT count(*) FILTER(WHERE value->>'type'='video'),count(*) FILTER(WHERE value->>'type'='image')
  INTO videos,images FROM jsonb_array_elements(p_plan);
 IF videos=0 THEN
  IF images<>jsonb_array_length(p_plan) OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_plan) WITH ORDINALITY e(value,n)
    WHERE value<>jsonb_build_object('slot',n-1,'type','image','role','media'))
  THEN RAISE EXCEPTION 'Up to twenty ordered images required'; END IF;
 ELSIF videos<>1 OR images<>1 OR p_plan<>'[{"slot":0,"type":"video","role":"media"},{"slot":20,"type":"image","role":"thumbnail"}]'::jsonb
 THEN RAISE EXCEPTION 'One video and its protected poster required'; END IF;
 IF jsonb_typeof(p_fields) IS DISTINCT FROM 'object' OR
  (p_fields-ARRAY['title','content','tags','source','comments_hidden'])<>'{}'::jsonb OR
  coalesce(p_fields->>'source','') NOT IN ('composer','studio') OR
  p_fields::text ~* '(https?://|blob:|data:|cloudinary\.com|/upload/)' OR
  (p_fields ? 'title' AND jsonb_typeof(p_fields->'title')<>'string') OR
  (p_fields ? 'content' AND jsonb_typeof(p_fields->'content')<>'string') OR
  length(coalesce(p_fields->>'title',''))>200 OR length(coalesce(p_fields->>'content',''))>20000 OR
  (p_fields ? 'comments_hidden' AND jsonb_typeof(p_fields->'comments_hidden')<>'boolean') OR
  jsonb_typeof(p_fields->'tags') IS DISTINCT FROM 'array' OR jsonb_array_length(p_fields->'tags')>30 OR
  EXISTS(SELECT 1 FROM jsonb_array_elements(p_fields->'tags') t WHERE jsonb_typeof(t)<>'string' OR length(t#>>'{}')>100)
 THEN RAISE EXCEPTION 'Unsupported protected payload'; END IF;
 -- Written only by this service-only transition, never inferred from editable
 -- visibility/media fields. Both inserts roll back together on any failure.
 INSERT INTO privacy_v2_private.protected_post_origins(post_id,owner_id) VALUES(p_post,p_owner);
 INSERT INTO public.posts(id,user_id,visibility,is_hidden,is_deleted,publishing_state,media,media_plan,publish_payload,draft_expires_at)
 VALUES(p_post,p_owner,p_visibility,true,false,'draft','[]',p_plan,p_fields,now()+interval '1 hour');
 RETURN jsonb_build_object('id',p_post,'status','draft');
END $$;

CREATE FUNCTION public.guard_protected_first_references() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m jsonb; a public.post_media_assets; raw jsonb=to_jsonb(NEW); n integer; origin_owner uuid;
BEGIN
 IF TG_OP='UPDATE' AND NEW.id IS DISTINCT FROM OLD.id THEN RAISE EXCEPTION 'Post identity is immutable'; END IF;
 SELECT owner_id INTO origin_owner FROM privacy_v2_private.protected_post_origins WHERE post_id=NEW.id;
 IF NOT FOUND THEN RETURN NEW; END IF; -- Legacy guard is a separate optional component.
 IF origin_owner IS DISTINCT FROM NEW.user_id OR NEW.visibility IS NULL OR
  NEW.visibility NOT IN ('followers','friends','only_me') OR
  (TG_OP='UPDATE' AND (NEW.id<>OLD.id OR NEW.user_id<>OLD.user_id OR
   NEW.media_plan IS DISTINCT FROM OLD.media_plan OR NEW.publish_payload IS DISTINCT FROM OLD.publish_payload))
 THEN RAISE EXCEPTION 'Protected origin and payload are immutable'; END IF;
 IF NEW.publishing_state<>'published' THEN RETURN NEW; END IF;
 IF NEW.is_hidden IS DISTINCT FROM false OR NEW.is_deleted IS DISTINCT FROM false THEN RETURN NEW; END IF;
 IF raw::text ~* '(https?://|blob:|data:|cloudinary\.com|/upload/)' OR
  EXISTS(SELECT 1 FROM jsonb_each(raw) e WHERE e.key ~* '(url|public_id|sound_id|text_template_id|overlay|original_post|source_post|quoted_post|repost_of)'
   AND e.value NOT IN ('null'::jsonb,'false'::jsonb,'""'::jsonb,'[]'::jsonb,'{}'::jsonb))
 THEN RAISE EXCEPTION 'Public references, music, text templates and overlays are unsupported'; END IF;
 n=jsonb_array_length(NEW.media);
 IF jsonb_typeof(NEW.media) IS DISTINCT FROM 'array' OR n NOT BETWEEN 1 AND 20
 THEN RAISE EXCEPTION 'Protected images or one video required'; END IF;
 FOR m IN SELECT value FROM jsonb_array_elements(NEW.media) LOOP
  IF (m-ARRAY['type','asset_id','thumbnail_asset_id'])<>'{}'::jsonb OR
   coalesce(m->>'type','') NOT IN ('image','video') OR m->>'asset_id' IS NULL OR
   (m->>'type'='video' AND (n<>1 OR m->>'thumbnail_asset_id' IS NULL))
  THEN RAISE EXCEPTION 'Invalid protected media'; END IF;
  SELECT * INTO a FROM public.post_media_assets WHERE id=(m->>'asset_id')::uuid;
  IF NOT FOUND OR a.post_id IS DISTINCT FROM NEW.id OR a.owner_id IS DISTINCT FROM NEW.user_id OR a.status IS DISTINCT FROM 'ready' OR
   a.delivery_type IS DISTINCT FROM 'authenticated' OR a.resource_type IS DISTINCT FROM m->>'type' OR a.format IS NULL OR
   (a.resource_type='image' AND a.format NOT IN ('jpg','jpeg','png','webp','avif','gif')) OR
   (a.resource_type='video' AND a.format NOT IN ('mp4','webm','mov','m4v'))
  THEN RAISE EXCEPTION 'Registered owned protected media required'; END IF;
  IF m->>'thumbnail_asset_id' IS NOT NULL THEN
   SELECT * INTO a FROM public.post_media_assets WHERE id=(m->>'thumbnail_asset_id')::uuid;
   IF NOT FOUND OR a.post_id IS DISTINCT FROM NEW.id OR a.owner_id IS DISTINCT FROM NEW.user_id OR a.status IS DISTINCT FROM 'ready' OR
    a.delivery_type IS DISTINCT FROM 'authenticated' OR a.resource_type IS DISTINCT FROM 'image' OR a.format IS NULL OR a.format NOT IN ('jpg','jpeg','png','webp','avif','gif')
   THEN RAISE EXCEPTION 'Registered owned protected thumbnail required'; END IF;
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER privacy_v2_protected_first_references BEFORE INSERT OR UPDATE ON public.posts
 FOR EACH ROW EXECUTE FUNCTION public.guard_protected_first_references();
CREATE FUNCTION public.set_new_protected_visibility(p_owner uuid,p_post uuid,p_visibility text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF p_visibility IS NULL OR p_visibility NOT IN ('followers','friends','only_me') OR
  NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_owner AND suspended=false)
 THEN RAISE EXCEPTION 'Explicit supported audience required'; END IF;
 PERFORM 1 FROM public.posts p JOIN privacy_v2_private.protected_post_origins o ON o.post_id=p.id AND o.owner_id=p.user_id
  WHERE p.id=p_post AND p.user_id=p_owner AND p.publishing_state='published' AND p.is_hidden=false AND p.is_deleted=false
  FOR UPDATE OF p;
 IF NOT FOUND THEN RAISE EXCEPTION 'Only posts protected from creation may use this transition'; END IF;
 UPDATE public.posts SET visibility=p_visibility WHERE id=p_post;
 RETURN jsonb_build_object('id',p_post,'visibility',p_visibility);
END $$;
CREATE FUNCTION public.protected_first_capabilities()
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT '{"version":1,"new_protected_posts":true,"legacy_conversion_required":false}'::jsonb
$$;
REVOKE ALL ON FUNCTION public.create_protected_draft(uuid,uuid,text,jsonb,jsonb),
 public.guard_protected_first_references(),public.set_new_protected_visibility(uuid,uuid,text),public.protected_first_capabilities() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_protected_draft(uuid,uuid,text,jsonb,jsonb),
 public.guard_protected_first_references(),public.set_new_protected_visibility(uuid,uuid,text),public.protected_first_capabilities() TO service_role;

COMMIT;
