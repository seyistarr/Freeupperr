-- Correction for staging projects that already applied legacy-media.sql.
-- Include other isolated test/application schemas and materialized snapshots;
-- inaccessible application tables fail closed rather than being skipped.
BEGIN;
DO $$ BEGIN
  IF current_setting('freeupper.privacy_v2_project_ref',true) IS DISTINCT FROM 'tagkrhvgcbnybiuyvjxt' THEN
    RAISE EXCEPTION 'Explicit isolated staging project acknowledgement required'; END IF;
END $$;
-- Read-only dependency inspection in the other isolated fixture schemas.
-- Browser grants and all mutation privileges remain unchanged.
DO $$ DECLARE fixture_schema text; BEGIN
  FOREACH fixture_schema IN ARRAY ARRAY['post_visibility_test','deep_linking_v2_test','profile_seo_test'] LOOP
    IF EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=fixture_schema) THEN
      EXECUTE format('GRANT USAGE ON SCHEMA %I TO service_role',fixture_schema);
      EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO service_role',fixture_schema);
    END IF;
  END LOOP;
END $$;
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
        ('post_media_assets','post_upload_intents','legacy_media_provenance','legacy_media_jobs','legacy_media_sources','legacy_media_events'))
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
REVOKE ALL ON FUNCTION privacy_test.legacy_reference_conflicts(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION privacy_test.legacy_reference_conflicts(uuid,jsonb) TO service_role;
COMMIT;
