-- STAGING ONLY: synthetic post snapshots restored to a separate private table.
-- This exercise deliberately cannot overwrite privacy_test.posts or public.*.
BEGIN;
DO $$ BEGIN
 IF current_setting('freeupper.privacy_v2_project_ref',true) IS DISTINCT FROM 'tagkrhvgcbnybiuyvjxt'
 THEN RAISE EXCEPTION 'Isolated staging acknowledgement required'; END IF;
END $$;
CREATE TABLE privacy_test.recovery_exercises (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_project text NOT NULL CHECK(source_project='tagkrhvgcbnybiuyvjxt'),
 backup jsonb NOT NULL, restored jsonb, created_at timestamptz NOT NULL DEFAULT now(), restored_at timestamptz
);
ALTER TABLE privacy_test.recovery_exercises ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON privacy_test.recovery_exercises FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON privacy_test.recovery_exercises TO service_role;
CREATE FUNCTION privacy_test.synthetic_recovery_exercise(p_action text,p_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE snapshot jsonb; e privacy_test.recovery_exercises;
BEGIN
 IF p_action='backup' THEN
  SELECT jsonb_agg(to_jsonb(p) ORDER BY id) INTO snapshot FROM privacy_test.posts p
   WHERE user_id='ea903e28-c74f-4202-9d4a-3dd9bd2a2178' AND id IN (
    'f352427f-29e3-4088-8dd3-c825ee29c04d','5dddda69-b3a7-4d78-8baa-e88571b6274b');
  IF jsonb_array_length(snapshot) IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'Exact synthetic fixtures required'; END IF;
  INSERT INTO privacy_test.recovery_exercises(source_project,backup) VALUES('tagkrhvgcbnybiuyvjxt',snapshot) RETURNING * INTO e;
 ELSIF p_action='restore-exercise' THEN
  SELECT * INTO e FROM privacy_test.recovery_exercises WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR e.source_project<>'tagkrhvgcbnybiuyvjxt' OR jsonb_array_length(e.backup)<>2 OR
   EXISTS(SELECT 1 FROM jsonb_array_elements(e.backup) p WHERE p->>'user_id'<>'ea903e28-c74f-4202-9d4a-3dd9bd2a2178'
    OR p->>'id' NOT IN ('f352427f-29e3-4088-8dd3-c825ee29c04d','5dddda69-b3a7-4d78-8baa-e88571b6274b'))
   THEN RAISE EXCEPTION 'Synthetic staging backup required'; END IF;
  -- Recovery target is a separate JSON snapshot, not the live publishing tables.
  UPDATE privacy_test.recovery_exercises SET restored=backup,restored_at=coalesce(restored_at,now()) WHERE id=p_id RETURNING * INTO e;
 ELSE RAISE EXCEPTION 'Unknown exercise action'; END IF;
 RETURN jsonb_build_object('exercise_id',e.id,'rows',jsonb_array_length(e.backup),
  'restored',e.restored IS NOT NULL,'matches',e.restored=e.backup,'target','privacy_test.recovery_exercises.restored');
END $$;
REVOKE ALL ON FUNCTION privacy_test.synthetic_recovery_exercise(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION privacy_test.synthetic_recovery_exercise(text,uuid) TO service_role;
-- Read-only monitoring; no URL inventories, snapshots or credentials returned.
CREATE FUNCTION privacy_test.privacy_v2_monitor() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT jsonb_build_object('pending_legacy',(SELECT count(*) FROM privacy_test.legacy_media_jobs WHERE state IN ('quarantined','revoking','verified')),
  'due_unverified',(SELECT count(*) FROM privacy_test.legacy_media_jobs WHERE state='revoking' AND
    now()>=greatest(revocation_started_at+interval '31 days','2026-11-20 21:04:08+00'::timestamptz)),
  'failed_jobs',(SELECT count(*) FROM privacy_test.legacy_media_jobs WHERE last_error IS NOT NULL),
  'expired_drafts',(SELECT count(*) FROM privacy_test.posts WHERE publishing_state='draft' AND draft_expires_at<now() AND legacy_migration_state IS DISTINCT FROM 'pending'),
  'cleanup_retry',(SELECT count(*) FROM privacy_test.post_upload_intents WHERE cleanup_pending AND cleanup_after<now()),
  'safety_violation',(SELECT count(*) FROM privacy_test.posts WHERE legacy_migration_state='pending' AND (NOT is_hidden OR publishing_state='published')))
$$;
REVOKE ALL ON FUNCTION privacy_test.privacy_v2_monitor() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION privacy_test.privacy_v2_monitor() TO service_role;
COMMIT;
