-- STAGING ONLY. Trusted operator verifies cross-account immutable S3 receipts before this service-only RPC.
BEGIN;
DO $$ BEGIN
 IF current_setting('freeupper.privacy_v2_project_ref',true) IS DISTINCT FROM 'tagkrhvgcbnybiuyvjxt'
 THEN RAISE EXCEPTION 'Isolated staging acknowledgement required'; END IF;
END $$;
CREATE TABLE privacy_test.independent_revocation_receipts (
 job_id uuid PRIMARY KEY REFERENCES privacy_test.legacy_media_jobs, receipts jsonb NOT NULL,
 observations jsonb NOT NULL, accepted_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE privacy_test.independent_revocation_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON privacy_test.independent_revocation_receipts FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON privacy_test.independent_revocation_receipts TO service_role;
CREATE FUNCTION privacy_test.guard_independent_revocation() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NEW.observations IS DISTINCT FROM OLD.observations OR (NEW.state='verified' AND OLD.state<>'verified') THEN
  IF now()<'2026-11-20 21:04:08+00'::timestamptz OR NEW.revocation_started_at>now()-interval '31 days'
  THEN RAISE EXCEPTION 'Revocation deadline has not elapsed'; END IF;
  IF NOT EXISTS(SELECT 1 FROM privacy_test.independent_revocation_receipts r WHERE r.job_id=NEW.id AND r.observations=NEW.observations)
  THEN RAISE EXCEPTION 'Independent immutable runner receipts require verified ingestion'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER independent_revocation_gate BEFORE UPDATE ON privacy_test.legacy_media_jobs
 FOR EACH ROW EXECUTE FUNCTION privacy_test.guard_independent_revocation();
CREATE FUNCTION privacy_test.reject_evidence_mutation() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'Evidence is append-only'; END $$;
CREATE TRIGGER legacy_events_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON privacy_test.legacy_media_events
 FOR EACH STATEMENT EXECUTE FUNCTION privacy_test.reject_evidence_mutation();
REVOKE UPDATE,DELETE,TRUNCATE ON privacy_test.legacy_media_events FROM service_role;
CREATE TRIGGER runner_receipts_append_only BEFORE UPDATE OR DELETE OR TRUNCATE ON privacy_test.independent_revocation_receipts
 FOR EACH STATEMENT EXECUTE FUNCTION privacy_test.reject_evidence_mutation();
-- Only the server-side operator ingestion CLI calls this after AWS expected-owner,
-- object-version/COMPLIANCE, independent identities, digest and origin checks.
CREATE FUNCTION privacy_test.ingest_independent_revocation(p_job uuid,p_manifest jsonb,p_receipts jsonb)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE j privacy_test.legacy_media_jobs; f jsonb; a jsonb; b jsonb; obs jsonb; probe_count integer;
BEGIN
 SELECT * INTO j FROM privacy_test.legacy_media_jobs WHERE id=p_job FOR UPDATE;
 SELECT x INTO f FROM jsonb_array_elements(p_manifest->'jobs') x WHERE x->>'id'=p_job::text;
 a=p_receipts->0; b=p_receipts->1;
 IF j.id IS NULL OR j.owner_id<>'ea903e28-c74f-4202-9d4a-3dd9bd2a2178' OR j.state NOT IN ('revoking','verified')
 OR jsonb_array_length(j.plan->'sources')<1
 OR (SELECT count(*) FROM jsonb_object_keys(j.copies))<>jsonb_array_length(j.plan->'entries')
 OR NOT EXISTS(SELECT 1 FROM privacy_test.posts p WHERE p.id=j.post_id AND p.is_hidden=true AND p.publishing_state='draft' AND p.legacy_migration_state='pending' AND to_jsonb(p)=j.current_row)
 OR (j.lease_until IS NOT NULL AND j.lease_until>now()) OR f IS NULL
 OR p_manifest->>'project' IS DISTINCT FROM 'tagkrhvgcbnybiuyvjxt' OR p_manifest->>'cloud' IS DISTINCT FROM 'sxdcqs5x'
 OR p_manifest->>'synthetic' IS DISTINCT FROM 'true' OR jsonb_array_length(p_receipts) IS DISTINCT FROM 2
 OR a->>'runner' IS DISTINCT FROM 'first' OR b->>'runner' IS DISTINCT FROM 'second'
 OR a->>'account' IS NOT DISTINCT FROM b->>'account' OR a->>'bucket' IS NOT DISTINCT FROM b->>'bucket'
 OR a->>'manifest_sha256' IS DISTINCT FROM b->>'manifest_sha256'
 OR (f->>'revoked_at')::timestamptz IS DISTINCT FROM j.revocation_started_at
 OR now()<greatest(j.revocation_started_at+interval '31 days','2026-11-20 21:04:08+00'::timestamptz)
 OR (a->>'checked_at')::timestamptz<greatest(j.revocation_started_at+interval '31 days','2026-11-20 21:04:08+00'::timestamptz)
 OR (b->>'checked_at')::timestamptz<(a->>'checked_at')::timestamptz+interval '1 hour'
 OR (b->>'stored_at')::timestamptz<(a->>'stored_at')::timestamptz+interval '1 hour'
 OR (b->>'checked_at')::timestamptz<now()-interval '1 hour' OR (b->>'checked_at')::timestamptz>now()
 OR (SELECT count(*) FROM jsonb_object_keys(j.deletions))<>jsonb_array_length(j.plan->'sources')
 THEN RAISE EXCEPTION 'Independent evidence incomplete or not due'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_receipts) r WHERE
  r->>'checked_at' IS NULL OR r->>'stored_at' IS NULL OR r->>'retention_until' IS NULL OR
  coalesce(r->>'bucket','') !~ '^freeupper-staging-revocation-[a-z0-9-]+$' OR
  coalesce(r->>'version','')='' OR coalesce(r->>'account','') !~ '^[0-9]{12}$' OR
  coalesce(r->>'sha256','') !~ '^[a-f0-9]{64}$' OR coalesce(r->>'manifest_sha256','') !~ '^[a-f0-9]{64}$' OR
  (r->>'retention_until')::timestamptz<now()+interval '1 day' OR
  (r->>'stored_at')::timestamptz<(r->>'checked_at')::timestamptz OR
  (r->>'stored_at')::timestamptz>(r->>'checked_at')::timestamptz+interval '10 minutes')
 THEN RAISE EXCEPTION 'Immutable receipts required'; END IF;
 IF EXISTS((SELECT u FROM jsonb_array_elements_text(f->'urls') u EXCEPT SELECT u FROM jsonb_array_elements(j.plan->'sources') s CROSS JOIN LATERAL jsonb_array_elements_text(s->'probe_urls') u)
 UNION ALL (SELECT u FROM jsonb_array_elements(j.plan->'sources') s CROSS JOIN LATERAL jsonb_array_elements_text(s->'probe_urls') u EXCEPT SELECT u FROM jsonb_array_elements_text(f->'urls') u))
 THEN RAISE EXCEPTION 'Probe inventory changed'; END IF;
 SELECT sum(jsonb_array_length(s->'probe_urls')) INTO probe_count FROM jsonb_array_elements(j.plan->'sources') s;
 obs=jsonb_build_array(jsonb_build_object('vantage','first','at',a->>'checked_at','probe_count',probe_count,'outcome','absent'),
   jsonb_build_object('vantage','second','at',b->>'checked_at','probe_count',probe_count,'outcome','absent'));
 IF EXISTS(SELECT 1 FROM privacy_test.independent_revocation_receipts r WHERE r.job_id=j.id) THEN
  IF EXISTS(SELECT 1 FROM privacy_test.independent_revocation_receipts r WHERE r.job_id=j.id AND r.receipts=p_receipts AND r.observations=j.observations) AND j.state='verified' THEN RETURN; END IF;
  RAISE EXCEPTION 'Immutable receipts differ; operator recovery required';
 END IF;
 INSERT INTO privacy_test.independent_revocation_receipts(job_id,receipts,observations) VALUES(j.id,p_receipts,obs);
 UPDATE privacy_test.legacy_media_jobs SET observations=obs,state='verified',verified_at=now(),updated_at=now() WHERE id=j.id;
 INSERT INTO privacy_test.legacy_media_events(job_id,action,details) VALUES(j.id,'independent_receipts',jsonb_build_object('receipts',p_receipts));
END $$;
REVOKE ALL ON FUNCTION privacy_test.ingest_independent_revocation(uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION privacy_test.ingest_independent_revocation(uuid,jsonb,jsonb) TO service_role;
COMMIT;
