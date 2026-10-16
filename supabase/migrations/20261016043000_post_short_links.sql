-- Apply to production only after review, before enabling short-link sharing.
CREATE TABLE IF NOT EXISTS public.post_short_links (
  post_id uuid PRIMARY KEY REFERENCES public.posts(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-zA-Z0-9_-]{6,16}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.post_short_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.post_short_links FROM anon, authenticated;
CREATE OR REPLACE FUNCTION public.ensure_post_short_link(p_post_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE candidate text; existing text; attempt integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.posts WHERE id=p_post_id AND visibility='public' AND is_deleted=false AND is_hidden=false) THEN RETURN NULL; END IF;
  SELECT code INTO existing FROM public.post_short_links WHERE post_id=p_post_id;
  IF existing IS NOT NULL THEN RETURN existing; END IF;
  FOR attempt IN 1..12 LOOP
    candidate := substr(md5(gen_random_uuid()::text || p_post_id::text),1,10);
    INSERT INTO public.post_short_links(post_id,code) VALUES (p_post_id,candidate)
      ON CONFLICT DO NOTHING;
    SELECT code INTO existing FROM public.post_short_links WHERE post_id=p_post_id;
    IF existing IS NOT NULL THEN RETURN existing; END IF;
  END LOOP;
  RAISE EXCEPTION 'Unable to allocate unique short code';
END; $$;
REVOKE ALL ON FUNCTION public.ensure_post_short_link(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_post_short_link(uuid) TO anon,authenticated;
CREATE OR REPLACE FUNCTION public.resolve_public_post_short_link(p_code text)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
 SELECT p.id FROM public.post_short_links l JOIN public.posts p ON p.id=l.post_id
 WHERE l.code=p_code AND p.visibility='public' AND p.is_deleted=false AND p.is_hidden=false LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.resolve_public_post_short_link(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_public_post_short_link(text) TO anon,authenticated;
-- Backfill existing public posts; new codes are generated on first share.
INSERT INTO public.post_short_links(post_id,code)
SELECT id,substr(md5(id::text),1,12) FROM public.posts
WHERE visibility='public' AND is_deleted=false AND is_hidden=false
ON CONFLICT DO NOTHING;
