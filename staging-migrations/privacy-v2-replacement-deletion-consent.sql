-- STAGING ONLY. Apply after owner-consent and independent-revocation migrations.
-- Does not delete assets, change job states, reset clocks or qualify observations.
BEGIN;
DO $$ BEGIN
 IF current_setting('freeupper.privacy_v2_project_ref',true) IS DISTINCT FROM 'tagkrhvgcbnybiuyvjxt'
 THEN RAISE EXCEPTION 'Isolated staging acknowledgement required'; END IF;
END $$;
CREATE TABLE privacy_test.legacy_replacement_checks (
 job_id uuid NOT NULL REFERENCES privacy_test.legacy_media_jobs,
 slot integer NOT NULL CHECK(slot BETWEEN 0 AND 20),
 owner_id uuid NOT NULL, post_id uuid NOT NULL,
 entry_snapshot jsonb NOT NULL, cloudinary_asset_id text NOT NULL,
 copy_version bigint NOT NULL CHECK(copy_version>0),
 bytes bigint NOT NULL CHECK(bytes BETWEEN 1 AND 52428800),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 verified_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(job_id,slot)
);
ALTER TABLE privacy_test.legacy_replacement_checks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON privacy_test.legacy_replacement_checks FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON privacy_test.legacy_replacement_checks TO service_role;
ALTER TABLE privacy_test.legacy_owner_consents
 ADD COLUMN deletion_authorized_at timestamptz,
 ADD COLUMN deletion_job_id uuid REFERENCES privacy_test.legacy_media_jobs,
 ADD COLUMN deletion_replacements jsonb;

CREATE FUNCTION privacy_test.legacy_replacement_evidence(p_owner uuid,p_post uuid,p_job uuid,
 p_slot integer,p_asset text,p_version bigint,p_digest jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE j privacy_test.legacy_media_jobs; e jsonb; c jsonb; r privacy_test.legacy_replacement_checks;
BEGIN
 PERFORM 1 FROM privacy_test.posts WHERE id=p_post AND user_id=p_owner FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Owned post required'; END IF;
 SELECT * INTO j FROM privacy_test.legacy_media_jobs WHERE id=p_job AND post_id=p_post AND owner_id=p_owner FOR UPDATE;
 SELECT value INTO e FROM jsonb_array_elements(j.plan->'entries') WHERE (value->>'slot')::integer=p_slot;
 c=j.copies->p_slot::text;
 IF e IS NULL OR c->>'asset_id' IS DISTINCT FROM p_asset OR p_version IS NULL OR p_version<=0 OR
 NOT EXISTS(SELECT 1 FROM privacy_test.post_media_assets a WHERE a.id=(c->>'registry_id')::uuid
  AND a.post_id=p_post AND a.owner_id=p_owner AND a.cloudinary_asset_id=p_asset
  AND a.delivery_type='authenticated' AND a.status='ready' AND a.resource_type=e->>'type')
 THEN RAISE EXCEPTION 'Registered replacement identity required'; END IF;
 IF p_digest IS NOT NULL THEN
  IF j.state NOT IN ('copying','quarantined') OR j.revocation_started_at IS NOT NULL OR
   jsonb_typeof(p_digest) IS DISTINCT FROM 'object' OR
   (p_digest - ARRAY['bytes','sha256'])<>'{}'::jsonb OR
   coalesce(p_digest->>'sha256','') !~ '^[a-f0-9]{64}$' OR
   coalesce((p_digest->>'bytes')::bigint,0) NOT BETWEEN 1 AND 52428800
  THEN RAISE EXCEPTION 'Pre-deletion byte verification required'; END IF;
  INSERT INTO privacy_test.legacy_replacement_checks(job_id,slot,owner_id,post_id,entry_snapshot,
   cloudinary_asset_id,copy_version,bytes,sha256)
  VALUES(p_job,p_slot,p_owner,p_post,e,p_asset,p_version,(p_digest->>'bytes')::bigint,p_digest->>'sha256')
  ON CONFLICT(job_id,slot) DO NOTHING;
 END IF;
 SELECT * INTO r FROM privacy_test.legacy_replacement_checks WHERE job_id=p_job AND slot=p_slot;
 IF NOT FOUND OR r.owner_id<>p_owner OR r.post_id<>p_post OR r.entry_snapshot<>e OR
  r.cloudinary_asset_id<>p_asset OR r.copy_version<>p_version OR
  (p_digest IS NOT NULL AND (r.bytes<>(p_digest->>'bytes')::bigint OR r.sha256<>p_digest->>'sha256'))
 THEN RAISE EXCEPTION 'Immutable replacement evidence differs or is absent'; END IF;
 RETURN jsonb_build_object('bytes',r.bytes,'sha256',r.sha256);
END $$;

CREATE FUNCTION privacy_test.legacy_replacement_set(p_owner uuid,p_post uuid,p_job uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE j privacy_test.legacy_media_jobs; e jsonb; c jsonb; r privacy_test.legacy_replacement_checks; result jsonb='[]';
BEGIN
 SELECT * INTO j FROM privacy_test.legacy_media_jobs WHERE id=p_job AND post_id=p_post AND owner_id=p_owner;
 IF NOT FOUND OR jsonb_array_length(j.plan->'entries') NOT BETWEEN 1 AND 21
 THEN RAISE EXCEPTION 'Replacement inventory required'; END IF;
 FOR e IN SELECT value FROM jsonb_array_elements(j.plan->'entries') ORDER BY (value->>'slot')::integer LOOP
  c=j.copies->(e->>'slot');
  SELECT * INTO r FROM privacy_test.legacy_replacement_checks WHERE job_id=p_job AND slot=(e->>'slot')::integer;
  IF NOT FOUND OR r.owner_id<>p_owner OR r.post_id<>p_post OR r.entry_snapshot<>e OR
   r.cloudinary_asset_id IS DISTINCT FROM c->>'asset_id' OR
   NOT EXISTS(SELECT 1 FROM privacy_test.post_media_assets a WHERE a.id=(c->>'registry_id')::uuid
    AND a.post_id=p_post AND a.owner_id=p_owner AND a.status='ready' AND a.delivery_type='authenticated'
    AND a.cloudinary_asset_id=r.cloudinary_asset_id AND a.resource_type=e->>'type')
  THEN RAISE EXCEPTION 'Every replacement needs immutable delivery verification'; END IF;
  result=result || jsonb_build_array(jsonb_build_object('slot',r.slot,'asset_id',r.cloudinary_asset_id,
   'version',r.copy_version,'bytes',r.bytes,'sha256',r.sha256));
 END LOOP;
 RETURN result;
END $$;
CREATE FUNCTION privacy_test.legacy_deletion_authorized(p_owner uuid,p_post uuid,p_job uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE c privacy_test.legacy_owner_consents;
BEGIN
 SELECT * INTO c FROM privacy_test.legacy_owner_consents WHERE post_id=p_post AND owner_id=p_owner
  AND deletion_job_id=p_job AND deletion_authorized_at IS NOT NULL;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM privacy_test.profiles WHERE id=p_owner AND suspended=false)
  OR NOT EXISTS(SELECT 1 FROM privacy_test.legacy_media_jobs j WHERE j.id=p_job AND j.post_id=p_post
   AND j.owner_id=p_owner AND j.state IN ('quarantined','revoking') AND j.target_visibility=c.visibility)
 THEN RETURN false; END IF;
 RETURN c.deletion_replacements=privacy_test.legacy_replacement_set(p_owner,p_post,p_job);
END $$;

ALTER FUNCTION privacy_test.legacy_owner_consent(uuid,uuid,text,text,boolean) RENAME TO legacy_owner_consent_before_deletion;
CREATE FUNCTION privacy_test.legacy_owner_consent(p_owner uuid,p_post uuid,p_action text,
 p_visibility text DEFAULT NULL,p_acknowledge boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE j privacy_test.legacy_media_jobs; copies jsonb; result jsonb;
BEGIN
 PERFORM 1 FROM privacy_test.posts WHERE id=p_post AND user_id=p_owner FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Owned post required'; END IF;
 SELECT * INTO j FROM privacy_test.legacy_media_jobs WHERE post_id=p_post AND owner_id=p_owner FOR UPDATE;
 IF p_action='legacy-delete-consent' THEN
  IF p_acknowledge IS NOT TRUE OR p_visibility IS DISTINCT FROM j.target_visibility OR
   j.state IS DISTINCT FROM 'quarantined' OR NOT EXISTS(
    SELECT 1 FROM privacy_test.profiles WHERE id=p_owner AND suspended=false)
  THEN RAISE EXCEPTION 'Explicit post-quarantine owner deletion authorization required'; END IF;
  copies=privacy_test.legacy_replacement_set(p_owner,p_post,j.id);
  UPDATE privacy_test.legacy_owner_consents SET deletion_authorized_at=coalesce(deletion_authorized_at,now()),
   deletion_job_id=j.id,deletion_replacements=copies WHERE post_id=p_post AND owner_id=p_owner
    AND quarantine_consented_at IS NOT NULL AND visibility=p_visibility;
  IF NOT FOUND THEN RAISE EXCEPTION 'Current owner consent required'; END IF;
  INSERT INTO privacy_test.legacy_media_events(job_id,action,details)
   VALUES(j.id,'owner_delete_authorization',jsonb_build_object('replacement_set',copies));
 END IF;
 result=privacy_test.legacy_owner_consent_before_deletion(p_owner,p_post,
  CASE WHEN p_action='legacy-delete-consent' THEN 'legacy-status' ELSE p_action END,p_visibility,p_acknowledge);
 RETURN result || jsonb_build_object('deletion_authorized',
  CASE WHEN j.state IN ('quarantined','revoking') THEN privacy_test.legacy_deletion_authorized(p_owner,p_post,j.id) ELSE false END);
END $$;
CREATE FUNCTION privacy_test.guard_legacy_deletion_consent() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NEW.state='revoking' AND privacy_test.legacy_deletion_authorized(NEW.owner_id,NEW.post_id,NEW.id) IS NOT TRUE
 THEN RAISE EXCEPTION 'Owner deletion authorization and verified replacements required'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER legacy_deletion_consent_gate BEFORE UPDATE OF state ON privacy_test.legacy_media_jobs
 FOR EACH ROW EXECUTE FUNCTION privacy_test.guard_legacy_deletion_consent();
REVOKE ALL ON FUNCTION privacy_test.legacy_replacement_evidence(uuid,uuid,uuid,integer,text,bigint,jsonb),
 privacy_test.legacy_replacement_set(uuid,uuid,uuid),privacy_test.legacy_deletion_authorized(uuid,uuid,uuid),
 privacy_test.legacy_owner_consent(uuid,uuid,text,text,boolean),privacy_test.guard_legacy_deletion_consent()
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION privacy_test.legacy_replacement_evidence(uuid,uuid,uuid,integer,text,bigint,jsonb),
 privacy_test.legacy_replacement_set(uuid,uuid,uuid),privacy_test.legacy_deletion_authorized(uuid,uuid,uuid),
 privacy_test.legacy_owner_consent(uuid,uuid,text,text,boolean),privacy_test.guard_legacy_deletion_consent()
 TO service_role;
-- Exclude only this job's internal evidence store from the application-wide
-- dependency scan. Evidence snapshots themselves contain the old public ID.
DO $$ DECLARE definition text; BEGIN
 definition=pg_get_functiondef('privacy_test.legacy_reference_conflicts(uuid,jsonb)'::regprocedure);
 IF position('''independent_revocation_receipts''' IN definition)=0
 THEN RAISE EXCEPTION 'Unexpected dependency inventory definition'; END IF;
 EXECUTE replace(definition,'''independent_revocation_receipts''',
  '''independent_revocation_receipts'',''legacy_replacement_checks''');
END $$;
COMMIT;
