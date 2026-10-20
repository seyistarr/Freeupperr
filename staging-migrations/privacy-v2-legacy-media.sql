-- STAGING ONLY: tagkrhvgcbnybiuyvjxt, after readers-cleanup. Never apply to public.
BEGIN;
DO $$ BEGIN
  IF current_setting('freeupper.privacy_v2_project_ref',true) IS DISTINCT FROM 'tagkrhvgcbnybiuyvjxt' THEN
    RAISE EXCEPTION 'Explicit isolated staging project acknowledgement required'; END IF;
END $$;
ALTER TABLE privacy_test.posts ADD COLUMN IF NOT EXISTS legacy_migration_state text
  CHECK (legacy_migration_state IN ('pending','complete'));
-- Provenance must come from reviewed upload/audit records, never URL possession
-- or user-supplied Cloudinary context. Operators supply only evidence digests.
CREATE TABLE privacy_test.legacy_media_provenance (
  cloudinary_asset_id text PRIMARY KEY CHECK(cloudinary_asset_id ~ '^[a-f0-9]{32}$'),
  post_id uuid NOT NULL REFERENCES privacy_test.posts, owner_id uuid NOT NULL REFERENCES privacy_test.profiles,
  public_id text NOT NULL, resource_type text NOT NULL CHECK(resource_type IN ('image','video')),
  source_version bigint NOT NULL, evidence_sha256 text NOT NULL CHECK(evidence_sha256 ~ '^[a-f0-9]{64}$'),
  reviewed_by text NOT NULL CHECK(length(reviewed_by) BETWEEN 2 AND 100), reviewed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE privacy_test.legacy_media_provenance ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON privacy_test.legacy_media_provenance FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON privacy_test.legacy_media_provenance TO service_role;
CREATE FUNCTION privacy_test.verified_legacy_source(p_owner uuid,p_post uuid,p_asset text,p_public_id text,p_version bigint,p_type text)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM privacy_test.legacy_media_provenance WHERE owner_id=p_owner AND post_id=p_post
    AND cloudinary_asset_id=p_asset AND public_id=p_public_id AND source_version=p_version AND resource_type=p_type)
$$;
REVOKE ALL ON FUNCTION privacy_test.verified_legacy_source(uuid,uuid,text,text,bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION privacy_test.verified_legacy_source(uuid,uuid,text,text,bigint,text) TO service_role;
CREATE TABLE privacy_test.legacy_media_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), post_id uuid NOT NULL UNIQUE REFERENCES privacy_test.posts,
  owner_id uuid NOT NULL REFERENCES privacy_test.profiles, target_visibility text NOT NULL CHECK(target_visibility IN ('followers','friends','only_me')),
  state text NOT NULL DEFAULT 'copying' CHECK(state IN ('copying','quarantined','revoking','verified','complete','abandoned')),
  original_row jsonb NOT NULL, current_row jsonb NOT NULL, plan jsonb NOT NULL,
  copies jsonb NOT NULL DEFAULT '{}'::jsonb, deletions jsonb NOT NULL DEFAULT '{}'::jsonb,
  observations jsonb NOT NULL DEFAULT '[]'::jsonb, lease uuid, lease_until timestamptz,
  revocation_started_at timestamptz, verified_at timestamptz,
  last_error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE privacy_test.legacy_media_sources (
  cloudinary_asset_id text PRIMARY KEY CHECK(cloudinary_asset_id ~ '^[a-f0-9]{32}$'),
  job_id uuid NOT NULL REFERENCES privacy_test.legacy_media_jobs, public_id text NOT NULL,
  resource_type text NOT NULL CHECK(resource_type IN ('image','video')),
  UNIQUE(public_id,resource_type)
);
CREATE TABLE privacy_test.legacy_media_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, job_id uuid NOT NULL REFERENCES privacy_test.legacy_media_jobs,
  action text NOT NULL, details jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE privacy_test.legacy_media_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_test.legacy_media_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_test.legacy_media_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON privacy_test.legacy_media_jobs,privacy_test.legacy_media_sources,privacy_test.legacy_media_events FROM PUBLIC,anon,authenticated;
GRANT ALL ON privacy_test.legacy_media_jobs,privacy_test.legacy_media_sources,privacy_test.legacy_media_events TO service_role;
GRANT USAGE,SELECT ON SEQUENCE privacy_test.legacy_media_events_id_seq TO service_role;

-- Fail closed if ANY staging table contains a shared URL/asset identity. This
-- intentionally blocks sounds and copied quote/repost snapshots; no deletion
-- can silently break someone else's Public post or original sound.
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

CREATE FUNCTION privacy_test.unsupported_protected_reference(value jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE item record;
BEGIN
  IF jsonb_typeof(value)='object' THEN
    FOR item IN SELECT * FROM jsonb_each(value) LOOP
      IF item.key ~* '(url|poster|audio|music|sound|overlay|original)' AND
        item.value NOT IN ('null'::jsonb,'false'::jsonb,'""'::jsonb,'[]'::jsonb,'{}'::jsonb) THEN RETURN true; END IF;
      IF privacy_test.unsupported_protected_reference(item.value) THEN RETURN true; END IF;
    END LOOP;
  ELSIF jsonb_typeof(value)='array' THEN
    FOR item IN SELECT x FROM jsonb_array_elements(value) x LOOP
      IF privacy_test.unsupported_protected_reference(item.x) THEN RETURN true; END IF;
    END LOOP;
  END IF;
  RETURN false;
END $$;
REVOKE ALL ON FUNCTION privacy_test.unsupported_protected_reference(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION privacy_test.unsupported_protected_reference(jsonb) TO service_role;
CREATE FUNCTION privacy_test.guard_protected_post_references() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE m jsonb; a privacy_test.post_media_assets%ROWTYPE; n integer; raw jsonb=to_jsonb(NEW);
BEGIN
  IF NEW.visibility IS NULL OR NEW.visibility NOT IN ('public','followers','friends','only_me') THEN RAISE EXCEPTION 'Invalid audience'; END IF;
  IF NEW.visibility='public' OR NEW.publishing_state<>'published' THEN RETURN NEW; END IF;
  IF NEW.legacy_migration_state='pending' OR privacy_test.unsupported_protected_reference(raw) OR raw::text ~* '(https?://|blob:|data:|cloudinary\.com|/upload/)' OR
    coalesce(raw->>'sound_id','')<>'' OR coalesce(raw->>'text_template_id','')<>'' OR
    coalesce(NEW.publish_payload->>'sound_id','')<>'' OR coalesce(NEW.publish_payload->>'audio_url','')<>'' OR
    coalesce(NEW.publish_payload->>'text_template_id','')<>'' OR
    coalesce(NEW.publish_payload->'textOverlays','[]'::jsonb)<>'[]'::jsonb THEN
    RAISE EXCEPTION 'Legacy or unsupported media must remain blocked'; END IF;
  IF EXISTS(SELECT 1 FROM privacy_test.legacy_media_jobs j WHERE j.post_id=NEW.id AND j.state<>'complete' AND
    NOT (j.state='verified' AND NEW.legacy_migration_state='complete' AND j.verified_at>=now()-interval '1 hour' AND
      j.revocation_started_at<=now()-interval '31 days')) THEN
    RAISE EXCEPTION 'Legacy revocation verification required'; END IF;
  n=jsonb_array_length(NEW.media);
  IF jsonb_typeof(NEW.media) IS DISTINCT FROM 'array' OR n IS NULL OR n NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'Protected image/video media required'; END IF;
  FOR m IN SELECT value FROM jsonb_array_elements(NEW.media) LOOP
    IF (m - ARRAY['type','asset_id','thumbnail_asset_id'])<>'{}'::jsonb OR
      m->>'type' IS NULL OR m->>'type' NOT IN ('image','video') OR m->>'asset_id' IS NULL OR
      (m->>'type'='video' AND (n<>1 OR m->>'thumbnail_asset_id' IS NULL)) THEN
      RAISE EXCEPTION 'Invalid protected media reference'; END IF;
    SELECT * INTO a FROM privacy_test.post_media_assets WHERE id=(m->>'asset_id')::uuid;
    IF NOT FOUND OR a.post_id<>NEW.id OR a.owner_id<>NEW.user_id OR a.status<>'ready' OR
      a.delivery_type<>'authenticated' OR a.resource_type<>m->>'type' THEN RAISE EXCEPTION 'Unregistered protected media'; END IF;
    IF m->>'thumbnail_asset_id' IS NOT NULL THEN
      SELECT * INTO a FROM privacy_test.post_media_assets WHERE id=(m->>'thumbnail_asset_id')::uuid;
      IF NOT FOUND OR a.post_id<>NEW.id OR a.owner_id<>NEW.user_id OR a.status<>'ready' OR
        a.delivery_type<>'authenticated' OR a.resource_type<>'image' THEN RAISE EXCEPTION 'Unregistered protected poster'; END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER privacy_v2_protected_references BEFORE INSERT OR UPDATE ON privacy_test.posts
  FOR EACH ROW EXECUTE FUNCTION privacy_test.guard_protected_post_references();
-- Defense in depth for pre-existing rows; URLs cannot leak via direct table reads.
CREATE POLICY privacy_v2_no_legacy_restricted_urls ON privacy_test.posts AS RESTRICTIVE FOR SELECT TO anon,authenticated
USING (visibility='public' OR (legacy_migration_state IS DISTINCT FROM 'pending' AND
  to_jsonb(posts)::text !~* '(https?://|blob:|data:|cloudinary\.com|/upload/)'));

CREATE OR REPLACE FUNCTION privacy_test.legacy_media_transition(p_owner uuid,p_post uuid,p_action text,p_lease uuid DEFAULT NULL,p_data jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE p privacy_test.posts%ROWTYPE; j privacy_test.legacy_media_jobs%ROWTYPE;
  e jsonb; c jsonb; s jsonb; refs jsonb; registry_id uuid; col text; probe_count integer;
BEGIN
  SELECT * INTO p FROM privacy_test.posts WHERE id=p_post AND user_id=p_owner FOR UPDATE;
  IF NOT FOUND OR p.is_deleted IS DISTINCT FROM false OR NOT EXISTS(SELECT 1 FROM privacy_test.profiles WHERE id=p_owner AND suspended=false) THEN
    RAISE EXCEPTION 'Owned post unavailable'; END IF;
  SELECT * INTO j FROM privacy_test.legacy_media_jobs WHERE post_id=p_post AND owner_id=p_owner FOR UPDATE;
  IF p_action='inspect' THEN RETURN jsonb_build_object('post',to_jsonb(p),'job',CASE WHEN j.id IS NULL THEN NULL ELSE to_jsonb(j) END); END IF;
  IF p_action='begin' THEN
    IF j.id IS NOT NULL THEN RETURN to_jsonb(j); END IF;
    IF p.visibility<>'public' OR p.publishing_state<>'published' OR p.is_hidden IS DISTINCT FROM false OR
      p_data->'source_row' IS DISTINCT FROM to_jsonb(p) OR p_data->>'visibility' NOT IN ('followers','friends','only_me') OR
      jsonb_array_length(p_data->'plan'->'entries') NOT BETWEEN 1 AND 21 OR
      jsonb_array_length(p_data->'plan'->'sources') NOT BETWEEN 1 AND 21 OR
      privacy_test.legacy_reference_conflicts(p_post,p_data->'plan'->'sources')>0 THEN RAISE EXCEPTION 'Unsafe legacy plan'; END IF;
    INSERT INTO privacy_test.legacy_media_jobs(post_id,owner_id,target_visibility,original_row,current_row,plan)
      VALUES(p_post,p_owner,p_data->>'visibility',to_jsonb(p),to_jsonb(p),p_data->'plan') RETURNING * INTO j;
    FOR s IN SELECT value FROM jsonb_array_elements(j.plan->'sources') LOOP
      IF NOT privacy_test.verified_legacy_source(p_owner,p_post,s->>'asset_id',s->>'public_id',(s->>'version')::bigint,s->>'resource_type') THEN RAISE EXCEPTION 'Reviewed ownership provenance required'; END IF;
      INSERT INTO privacy_test.legacy_media_sources VALUES(s->>'asset_id',j.id,s->>'public_id',s->>'resource_type');
    END LOOP;
  ELSE
    IF j.id IS NULL OR j.state='abandoned' THEN RAISE EXCEPTION 'Migration unavailable'; END IF;
    IF p_lease IS NULL THEN RAISE EXCEPTION 'Migration lease required'; END IF;
    IF p_action='lease' THEN
      IF j.lease_until>now() AND j.lease IS DISTINCT FROM p_lease THEN RAISE EXCEPTION 'Migration busy'; END IF;
      UPDATE privacy_test.legacy_media_jobs SET lease=p_lease,lease_until=now()+interval '15 minutes' WHERE id=j.id RETURNING * INTO j;
      RETURN to_jsonb(j);
    END IF;
    IF j.lease IS DISTINCT FROM p_lease THEN RAISE EXCEPTION 'Migration lease required'; END IF;
    IF p_action='release' THEN
      UPDATE privacy_test.legacy_media_jobs SET lease_until=now() WHERE id=j.id; RETURN to_jsonb(j); END IF;
    IF j.lease_until IS NULL OR j.lease_until<=now() THEN RAISE EXCEPTION 'Migration lease expired'; END IF;
    IF j.state='complete' THEN RETURN to_jsonb(j); END IF;
    IF p_action='failure' THEN
      UPDATE privacy_test.legacy_media_jobs SET last_error='operation_failed',lease_until=now(),updated_at=now(),
        state=CASE WHEN state='verified' THEN 'revoking' ELSE state END,
        verified_at=CASE WHEN state='verified' THEN NULL ELSE verified_at END,
        observations=CASE WHEN state='verified' THEN '[]'::jsonb ELSE observations END,
        revocation_started_at=CASE WHEN state='verified' THEN now() ELSE revocation_started_at END WHERE id=j.id;
      INSERT INTO privacy_test.legacy_media_events(job_id,action,details) VALUES(j.id,'failure','{}');
      RETURN jsonb_build_object('state',j.state);
    END IF;
    IF p_action NOT IN ('remove_copy','abandon') AND to_jsonb(p) IS DISTINCT FROM j.current_row THEN RAISE EXCEPTION 'Post changed; operator recovery required'; END IF;
    IF p_action NOT IN ('remove_copy','abandon') AND privacy_test.legacy_reference_conflicts(p_post,j.plan->'sources')>0 THEN RAISE EXCEPTION 'Shared dependency blocks migration'; END IF;
    IF p_action='copy' THEN
      IF j.state<>'copying' THEN RAISE EXCEPTION 'Copies are frozen'; END IF;
      SELECT value INTO e FROM jsonb_array_elements(j.plan->'entries') WHERE value->>'slot'=p_data->>'slot';
      c=p_data->'copy';
      IF e IS NULL OR c->>'public_id'<>e->>'target_public_id' OR c->>'resource_type'<>e->>'type' OR
        c->>'asset_id' !~ '^[a-f0-9]{32}$' OR c->>'format' !~ '^[a-z0-9]{2,8}$' THEN RAISE EXCEPTION 'Invalid protected copy'; END IF;
      IF j.copies ? (e->>'slot') THEN
        IF j.copies->(e->>'slot')->>'asset_id'<>c->>'asset_id' THEN RAISE EXCEPTION 'Copy identity changed'; END IF;
      ELSE
        registry_id=gen_random_uuid();
        INSERT INTO privacy_test.post_media_assets(id,post_id,owner_id,status,delivery_type,cloudinary_public_id,cloudinary_asset_id,resource_type,format)
          VALUES(registry_id,p_post,p_owner,'ready','authenticated',c->>'public_id',c->>'asset_id',c->>'resource_type',c->>'format');
        UPDATE privacy_test.legacy_media_jobs SET copies=copies || jsonb_build_object(e->>'slot',c || jsonb_build_object('registry_id',registry_id)) WHERE id=j.id;
      END IF;
    ELSIF p_action='refresh_probes' THEN
      IF j.state NOT IN ('copying','quarantined') OR j.revocation_started_at IS NOT NULL OR
        jsonb_array_length(p_data->'sources')<>jsonb_array_length(j.plan->'sources') THEN RAISE EXCEPTION 'Probe refresh unavailable'; END IF;
      FOR s IN SELECT value FROM jsonb_array_elements(p_data->'sources') LOOP
        SELECT value INTO e FROM jsonb_array_elements(j.plan->'sources') x WHERE x->>'asset_id'=s->>'asset_id';
        IF e IS NULL OR (e-'probe_urls') IS DISTINCT FROM (s-'probe_urls') OR
          NOT s->'probe_urls' @> e->'probe_urls' THEN RAISE EXCEPTION 'Probe identity changed'; END IF;
      END LOOP;
      UPDATE privacy_test.legacy_media_jobs SET plan=jsonb_set(plan,'{sources}',p_data->'sources') WHERE id=j.id;
    ELSIF p_action='remove_copy' THEN
      IF j.state<>'copying' THEN RAISE EXCEPTION 'Cannot remove copies after quarantine'; END IF;
      UPDATE privacy_test.post_media_assets SET status='failed' WHERE id=(j.copies->(p_data->>'slot')->>'registry_id')::uuid AND post_id=p_post AND owner_id=p_owner;
      UPDATE privacy_test.legacy_media_jobs SET copies=copies-(p_data->>'slot') WHERE id=j.id;
    ELSIF p_action='abandon' THEN
      IF j.state<>'copying' OR j.copies<>'{}'::jsonb THEN RAISE EXCEPTION 'Copy cleanup required'; END IF;
      UPDATE privacy_test.legacy_media_jobs SET state='abandoned' WHERE id=j.id;
    ELSIF p_action='quarantine' THEN
      IF j.state<>'copying' OR EXISTS(SELECT 1 FROM jsonb_array_elements(j.plan->'entries') x WHERE NOT j.copies ? (x->>'slot')) THEN
        RAISE EXCEPTION 'Incomplete protected copies'; END IF;
      UPDATE privacy_test.posts SET is_hidden=true,publishing_state='draft',draft_expires_at=NULL,legacy_migration_state='pending' WHERE id=p_post RETURNING * INTO p;
      UPDATE privacy_test.legacy_media_jobs SET state='quarantined',current_row=to_jsonb(p) WHERE id=j.id;
    ELSIF p_action='revoking' THEN
      IF j.state NOT IN ('quarantined','revoking') THEN RAISE EXCEPTION 'Quarantine required'; END IF;
      UPDATE privacy_test.legacy_media_jobs SET state='revoking',revocation_started_at=coalesce(revocation_started_at,now()) WHERE id=j.id;
    ELSIF p_action='deleted' THEN
      IF j.state<>'revoking' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(j.plan->'sources') x WHERE x->>'asset_id'=p_data->>'asset_id') THEN
        RAISE EXCEPTION 'Unexpected deletion'; END IF;
      -- CDN waiting begins after the LAST source deletion, not the first one.
      -- Retries of already absent sources do not endlessly restart the clock;
      -- a source actually deleted again after restoration always does.
      UPDATE privacy_test.legacy_media_jobs SET
        revocation_started_at=CASE WHEN NOT deletions ? (p_data->>'asset_id') OR p_data->>'reset_wait'='true' THEN now() ELSE revocation_started_at END,
        observations=CASE WHEN NOT deletions ? (p_data->>'asset_id') OR p_data->>'reset_wait'='true' THEN '[]'::jsonb ELSE observations END,
        deletions=CASE WHEN NOT deletions ? (p_data->>'asset_id') OR p_data->>'reset_wait'='true'
          THEN deletions || jsonb_build_object(p_data->>'asset_id',now()) ELSE deletions END WHERE id=j.id;
    ELSIF p_action='observe' THEN
      SELECT sum(jsonb_array_length(x->'probe_urls')) INTO probe_count FROM jsonb_array_elements(j.plan->'sources') x;
      IF j.state NOT IN ('revoking','verified') OR j.revocation_started_at>now()-interval '31 days' OR
        (SELECT count(*) FROM jsonb_object_keys(j.deletions))<>jsonb_array_length(j.plan->'sources') OR
        coalesce(p_data->>'vantage','') !~ '^[A-Za-z0-9_-]{2,50}$' OR (p_data->>'probe_count')::int IS DISTINCT FROM probe_count OR
        p_data->>'outcome' IS DISTINCT FROM 'absent' THEN RAISE EXCEPTION 'Revocation remains unverified'; END IF;
      IF EXISTS(SELECT 1 FROM jsonb_array_elements(j.observations) x WHERE x->>'vantage'<>p_data->>'vantage' AND
        (x->>'at')::timestamptz<=now()-interval '1 hour') THEN
        UPDATE privacy_test.legacy_media_jobs SET state='verified',verified_at=now() WHERE id=j.id;
      END IF;
      UPDATE privacy_test.legacy_media_jobs SET observations=observations || jsonb_build_array(jsonb_build_object(
        'vantage',p_data->>'vantage','at',now(),'probe_count',probe_count,'outcome','absent')) WHERE id=j.id;
    ELSIF p_action='finalize' THEN
      IF j.state<>'verified' OR j.verified_at<now()-interval '1 hour' OR
        j.revocation_started_at>now()-interval '31 days' THEN RAISE EXCEPTION 'Fresh revocation verification required'; END IF;
      SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('type',r->>'type',
        'asset_id',j.copies->(r->>'slot')->>'registry_id',
        'thumbnail_asset_id',j.copies->(r->>'thumbnail_slot')->>'registry_id'))) INTO refs
        FROM jsonb_array_elements(j.plan->'refs') r;
      -- Columns present in fuller staging clones are cleared transactionally too.
      FOR col IN SELECT column_name FROM information_schema.columns WHERE table_schema='privacy_test' AND table_name='posts'
        AND column_name IN ('media_url','thumbnail_url','poster_url','original_url','download_url','audio_url','sound_id','text_template_id') LOOP
        EXECUTE format('UPDATE privacy_test.posts SET %I=NULL WHERE id=$1',col) USING p_post;
      END LOOP;
      UPDATE privacy_test.posts SET media=refs,publish_payload=j.plan->'payload',visibility=j.target_visibility,
        publishing_state='published',is_hidden=false,legacy_migration_state='complete' WHERE id=p_post RETURNING * INTO p;
      UPDATE privacy_test.legacy_media_jobs SET state='complete',current_row=to_jsonb(p) WHERE id=j.id;
    ELSE RAISE EXCEPTION 'Unknown migration transition'; END IF;
    UPDATE privacy_test.legacy_media_jobs SET updated_at=now(),last_error=NULL WHERE id=j.id;
  END IF;
  INSERT INTO privacy_test.legacy_media_events(job_id,action,details) VALUES(j.id,p_action,
    jsonb_build_object('slot',p_data->'slot','asset_id',p_data->'asset_id','vantage',p_data->'vantage'));
  SELECT * INTO j FROM privacy_test.legacy_media_jobs WHERE id=j.id;
  RETURN to_jsonb(j);
END $$;
CREATE FUNCTION privacy_test.set_protected_visibility(p_owner uuid,p_post uuid,p_visibility text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE p privacy_test.posts%ROWTYPE;
BEGIN
  IF p_visibility IS NULL OR p_visibility NOT IN ('followers','friends','only_me') THEN RAISE EXCEPTION 'Explicit restricted audience required'; END IF;
  SELECT * INTO p FROM privacy_test.posts WHERE id=p_post AND user_id=p_owner FOR UPDATE;
  IF NOT FOUND OR p.is_hidden IS DISTINCT FROM false OR p.is_deleted OR p.publishing_state<>'published' OR
    NOT EXISTS(SELECT 1 FROM privacy_test.profiles WHERE id=p_owner AND suspended=false) THEN RAISE EXCEPTION 'Owned published post unavailable'; END IF;
  -- The independent trigger enforces protected references and legacy revocation.
  UPDATE privacy_test.posts SET visibility=p_visibility WHERE id=p_post;
  RETURN jsonb_build_object('id',p_post,'visibility',p_visibility);
END $$;
REVOKE ALL ON FUNCTION privacy_test.set_protected_visibility(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION privacy_test.set_protected_visibility(uuid,uuid,text) TO service_role;
REVOKE ALL ON FUNCTION privacy_test.legacy_reference_conflicts(uuid,jsonb),
  privacy_test.guard_protected_post_references(),privacy_test.legacy_media_transition(uuid,uuid,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION privacy_test.legacy_reference_conflicts(uuid,jsonb),
  privacy_test.guard_protected_post_references(),privacy_test.legacy_media_transition(uuid,uuid,text,uuid,jsonb) TO service_role;
COMMIT;
