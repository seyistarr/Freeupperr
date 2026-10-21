-- Isolated staging only. Existing quarantined synthetic jobs remain hidden.
BEGIN;
DO $$ BEGIN
 IF current_setting('freeupper.privacy_v2_project_ref',true) IS DISTINCT FROM 'tagkrhvgcbnybiuyvjxt'
 THEN RAISE EXCEPTION 'Isolated staging acknowledgement required'; END IF;
END $$;
CREATE TABLE privacy_test.legacy_owner_consents (
 post_id uuid PRIMARY KEY REFERENCES privacy_test.posts, owner_id uuid NOT NULL REFERENCES privacy_test.profiles,
 visibility text NOT NULL CHECK(visibility IN ('followers','friends','only_me')),
 source_row jsonb NOT NULL, consented_at timestamptz NOT NULL DEFAULT now(), quarantine_consented_at timestamptz
);
ALTER TABLE privacy_test.legacy_owner_consents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON privacy_test.legacy_owner_consents FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON privacy_test.legacy_owner_consents TO service_role;
CREATE FUNCTION privacy_test.legacy_owner_consent(p_owner uuid,p_post uuid,p_action text,p_visibility text DEFAULT NULL,p_acknowledge boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE p privacy_test.posts; j privacy_test.legacy_media_jobs; c privacy_test.legacy_owner_consents;
BEGIN
 SELECT * INTO p FROM privacy_test.posts WHERE id=p_post AND user_id=p_owner FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Owned post required'; END IF;
 SELECT * INTO j FROM privacy_test.legacy_media_jobs WHERE post_id=p_post;
 SELECT * INTO c FROM privacy_test.legacy_owner_consents WHERE post_id=p_post;
 IF p_action='legacy-consent' THEN
  IF NOT EXISTS(SELECT 1 FROM privacy_test.profiles WHERE id=p_owner AND suspended=false) OR p_acknowledge IS NOT TRUE OR p_visibility IS NULL OR p_visibility NOT IN ('followers','friends','only_me')
    OR p.visibility<>'public' OR p.is_hidden IS NOT FALSE OR p.is_deleted IS NOT FALSE OR j.id IS NOT NULL
    THEN RAISE EXCEPTION 'Explicit consent on unchanged Public post required'; END IF;
  IF c.post_id IS NOT NULL AND (c.visibility<>p_visibility OR c.source_row<>to_jsonb(p))
    THEN RAISE EXCEPTION 'Consent differs; operator review required'; END IF;
  INSERT INTO privacy_test.legacy_owner_consents(post_id,owner_id,visibility,source_row)
    VALUES(p_post,p_owner,p_visibility,to_jsonb(p)) ON CONFLICT(post_id) DO NOTHING;
 ELSIF p_action='legacy-quarantine-consent' THEN
  IF p_acknowledge IS NOT TRUE OR c.post_id IS NULL OR j.state IS DISTINCT FROM 'copying'
    OR c.visibility IS DISTINCT FROM p_visibility OR c.visibility<>j.target_visibility OR c.source_row<>to_jsonb(p)
    OR (SELECT count(*) FROM jsonb_object_keys(j.copies))<>jsonb_array_length(j.plan->'entries')
    THEN RAISE EXCEPTION 'All copies and current owner consent required'; END IF;
  UPDATE privacy_test.legacy_owner_consents SET quarantine_consented_at=coalesce(quarantine_consented_at,now()) WHERE post_id=p_post;
 ELSIF p_action<>'legacy-status' THEN RAISE EXCEPTION 'Unknown consent action'; END IF;
 SELECT * INTO c FROM privacy_test.legacy_owner_consents WHERE post_id=p_post;
 RETURN jsonb_build_object('state',coalesce(j.state,CASE WHEN c.post_id IS NULL THEN 'not_requested' ELSE 'awaiting_operator' END),
   'visibility',coalesce(j.target_visibility,c.visibility),'quarantine_authorized',c.quarantine_consented_at IS NOT NULL,
   'irreversible',coalesce(j.state IN ('quarantined','revoking','verified','complete'),false),
   'earliest_check',CASE WHEN j.revocation_started_at IS NOT NULL THEN greatest(j.revocation_started_at+interval '31 days','2026-11-20 21:04:08+00'::timestamptz) END);
END $$;
REVOKE ALL ON FUNCTION privacy_test.legacy_owner_consent(uuid,uuid,text,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION privacy_test.legacy_owner_consent(uuid,uuid,text,text,boolean) TO service_role;
CREATE FUNCTION privacy_test.require_legacy_owner_consent() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' OR (NEW.state='quarantined' AND OLD.state='copying') THEN
  IF NOT EXISTS(SELECT 1 FROM privacy_test.legacy_owner_consents c WHERE c.post_id=NEW.post_id AND c.owner_id=NEW.owner_id
    AND c.visibility=NEW.target_visibility AND c.source_row=NEW.original_row
    AND (TG_OP='INSERT' OR c.quarantine_consented_at IS NOT NULL))
    THEN RAISE EXCEPTION 'Current owner consent required'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER legacy_owner_consent_gate BEFORE INSERT OR UPDATE OF state ON privacy_test.legacy_media_jobs
 FOR EACH ROW EXECUTE FUNCTION privacy_test.require_legacy_owner_consent();
CREATE OR REPLACE FUNCTION privacy_test.legacy_reference_conflicts(p_post uuid,p_sources jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE t record; total integer=0; hits integer;
BEGIN
  FOR t IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname !~ '^pg_' AND n.nspname NOT IN
      ('information_schema','auth','storage','realtime','_realtime','vault','net','cron','extensions',
       'graphql','graphql_public','supabase_functions','supabase_migrations','pgsodium','pgsodium_masks')
      AND c.relkind IN ('r','p','m')
      AND NOT (n.nspname='privacy_test' AND c.relname IN
        ('post_media_assets','post_upload_intents','legacy_media_provenance','legacy_media_jobs','legacy_media_sources','legacy_media_events','legacy_owner_consents','recovery_exercises','independent_revocation_receipts'))
  LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I r WHERE %s AND (EXISTS
      (SELECT 1 FROM jsonb_array_elements($2) s WHERE position(s->>''public_id'' IN to_jsonb(r)::text)>0
        OR position(s->>''asset_id'' IN to_jsonb(r)::text)>0
        OR position(replace(s->>''public_id'',''/'','':'') IN to_jsonb(r)::text)>0
        OR position(lower(replace(s->>''public_id'',''/'',''%%2F'')) IN lower(to_jsonb(r)::text))>0)
      OR to_jsonb(r)::text ~ ''(l_audio:|l_fetch:|/l_|,l_|/u_|,u_|/t_|/s--)''
      OR (to_jsonb(r)->>''source_post_id''=$1::text OR to_jsonb(r)->>''quoted_post_id''=$1::text
      OR to_jsonb(r)->>''original_post_id''=$1::text OR
      (%L IN (''reposts'',''quotes'',''post_quotes'') AND to_jsonb(r)->>''post_id''=$1::text)))',
      t.nspname,t.relname,CASE WHEN t.nspname='privacy_test' AND t.relname='posts' THEN 'r.id<>$1' ELSE 'true' END,t.relname)
      INTO hits USING p_post,p_sources;
    total=total+hits;
  END LOOP;
  -- A registered asset already belonging to any post is not a legacy source.
  SELECT count(*) INTO hits FROM privacy_test.post_media_assets a WHERE EXISTS
    (SELECT 1 FROM jsonb_array_elements(p_sources) s WHERE a.cloudinary_asset_id=s->>'asset_id'
      OR a.cloudinary_public_id=s->>'public_id');
  RETURN total+hits;
END $$;

COMMIT;
