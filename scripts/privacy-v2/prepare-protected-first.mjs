// Offline, review-only SQL generation. Never connects to a database or cloud.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const root = new URL('../../', import.meta.url);
const read = file => readFileSync(new URL(file, root), 'utf8');
function functionSQL(sql, name) {
  const start = sql.search(new RegExp('CREATE (?:OR REPLACE )?FUNCTION privacy_test\\.' + name + '\\('));
  if (start < 0) throw Error('Missing reviewed core routine: ' + name);
  const end = sql.indexOf('$$;', sql.indexOf('AS $$', start));
  if (end < 0) throw Error('Unexpected SQL routine delimiter');
  return sql.slice(start, end + 3);
}
export function prepareProtectedFirst() {
  const paths = ['staging-migrations/privacy-v2-protected-publishing.sql',
    'staging-migrations/privacy-v2-readers-cleanup.sql', 'staging-migrations/privacy-v2-protected-first.sql',
    'staging-migrations/privacy-v2-upload-reservation-retry.sql'];
  const [publishing, readers, core, retry] = paths.map(read);
  const port = value => value.replaceAll('privacy_test.', 'public.')
    .replaceAll('freeupper-privacy-v2-staging/', 'freeupper-protected-v2/')
    .replaceAll('public.protected_post_origins', 'privacy_v2_private.protected_post_origins')
    .replaceAll('post_media_assets_staging_unique_asset', 'post_media_assets_protected_unique_asset');
  let base = publishing.slice(publishing.indexOf('ALTER TABLE privacy_test.posts'), publishing.indexOf('-- Service-only,'));
  // Public posting retains its current browser writes. Only new private
  // origins/intents/registry are server-managed; never revoke all posts writes.
  base = base.replace('REVOKE INSERT,UPDATE,DELETE ON privacy_test.posts FROM PUBLIC,anon,authenticated;\n', '');
  let origins = core.slice(core.indexOf('CREATE TABLE privacy_test.protected_post_origins'), core.lastIndexOf('COMMIT;'));
  origins = origins.replace("LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$\nDECLARE m jsonb;", () => "LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$\nDECLARE m jsonb;");
  // Trigger definer is needed only to inspect the private origin/registry while
  // preserving ordinary browser Public writes. It exposes no queryable data.
  const cleanupNames = ['claim_protected_cleanup','record_protected_cleanup','protected_cleanup_candidates'];
  let cleanup = cleanupNames.map(name => functionSQL(readers,name)).join('\n');
  cleanup = cleanup.replace("IF NOT FOUND THEN RAISE EXCEPTION 'Draft unavailable'; END IF;",
    "IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM privacy_test.protected_post_origins WHERE post_id=p_post AND owner_id=p_owner) THEN RAISE EXCEPTION 'Draft unavailable'; END IF;");
  cleanup = cleanup.replace("WHERE (p.cleanup_lease_until IS NULL", "WHERE EXISTS(SELECT 1 FROM privacy_test.protected_post_origins o WHERE o.post_id=p.id AND o.owner_id=p.user_id) AND (p.cleanup_lease_until IS NULL");
  const header = `-- GENERATED REVIEW ONLY. DO NOT EXECUTE OR ACTIVATE WITHOUT EXPLICIT APPROVAL.
-- Rebuild: node scripts/privacy-v2/prepare-protected-first.mjs --write-review
-- No legacy job, consent, deletion, observation or 31-day dependency.
-- Prerequisites: registry/global uniqueness, production expansion, approved
-- follows, audience RLS, visibility-preserving edits and RPC exposure fixes.
-- Source SHA256:\n${paths.map((p,i)=>'-- '+p+' '+createHash('sha256').update([publishing,readers,core,retry][i]).digest('hex')).join('\n')}
BEGIN;
DO $$ BEGIN
 IF current_setting('freeupper.privacy_v2_project_ref',true) IS DISTINCT FROM 'jmjtqidirpmnegzvmiaq'
 OR current_setting('freeupper.privacy_v2_reviewed_release',true) IS DISTINCT FROM 'approved-production-migration'
 THEN RAISE EXCEPTION 'Explicit production migration approval required'; END IF;
 IF to_regprocedure('privacy_v2_private.can_view_post_for(uuid,uuid)') IS NULL OR
    to_regprocedure('privacy_v2_private.approved_edge(uuid,uuid)') IS NULL OR
    NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='posts' AND policyname='privacy_v2_approved_audience')
 THEN RAISE EXCEPTION 'Reviewed production authorization prerequisites required'; END IF;
END $$;
ALTER TABLE privacy_v2_private.release_control
 ADD COLUMN new_protected_enabled boolean NOT NULL DEFAULT false CHECK(new_protected_enabled=false),
 ADD COLUMN protected_delivery_enabled boolean NOT NULL DEFAULT false CHECK(protected_delivery_enabled=false);
GRANT SELECT ON privacy_v2_private.release_control TO service_role;
GRANT EXECUTE ON FUNCTION privacy_v2_private.can_view_post_for(uuid,uuid),privacy_v2_private.approved_edge(uuid,uuid) TO service_role;
-- Existing restricted_enabled remains false: legacy conversion cannot activate.
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS cleanup_lease uuid,
 ADD COLUMN IF NOT EXISTS cleanup_lease_until timestamptz;
`;
  const transition = functionSQL(retry,'protected_publish_transition');
  const intentColumns = `ALTER TABLE public.post_upload_intents ADD COLUMN IF NOT EXISTS cleanup_attempts integer NOT NULL DEFAULT 0,
 ADD COLUMN IF NOT EXISTS cleanup_after timestamptz NOT NULL DEFAULT now();\n`;
  const extra = `
CREATE OR REPLACE FUNCTION public.privacy_v2_release_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN RAISE EXCEPTION 'Post owner cannot change'; END IF;
 IF TG_OP='INSERT' OR (TG_OP='UPDATE' AND NEW.visibility IS DISTINCT FROM OLD.visibility) THEN
  IF NEW.visibility IS NULL OR NEW.visibility NOT IN ('public','followers','friends','only_me')
  THEN RAISE EXCEPTION 'Invalid audience'; END IF;
 END IF;
 IF NEW.visibility<>'public' AND ((TG_OP='INSERT') OR
  (TG_OP='UPDATE' AND (NEW.visibility IS DISTINCT FROM OLD.visibility OR
   (NEW.publishing_state='published' AND OLD.publishing_state<>'published')))) THEN
  IF NOT EXISTS(SELECT 1 FROM privacy_v2_private.release_control WHERE new_protected_enabled AND protected_delivery_enabled)
   OR NOT EXISTS(SELECT 1 FROM privacy_v2_private.protected_post_origins WHERE post_id=NEW.id AND owner_id=NEW.user_id)
  THEN RAISE EXCEPTION 'New protected publishing is disabled; legacy conversion remains disabled'; END IF;
 END IF;
 RETURN NEW;
END $$;
-- Hydrate the existing feed/profile columns, so ordinary invoker readers and
-- engagement keep their established shapes. Never add public media aliases.
CREATE FUNCTION privacy_v2_private.hydrate_protected_payload() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM privacy_v2_private.protected_post_origins WHERE post_id=NEW.id AND owner_id=NEW.user_id) THEN
  NEW.title=coalesce(NEW.publish_payload->>'title','');
  NEW.content=coalesce(NEW.publish_payload->>'content','');
  NEW.source=NEW.publish_payload->>'source';
  NEW.tags=ARRAY(SELECT jsonb_array_elements_text(NEW.publish_payload->'tags'));
  NEW.comments_hidden=coalesce((NEW.publish_payload->>'comments_hidden')::boolean,false);
  NEW.media_type=NEW.media_plan->0->>'type';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION privacy_v2_private.hydrate_protected_payload() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER privacy_v2_00_protected_payload BEFORE INSERT OR UPDATE ON public.posts
 FOR EACH ROW EXECUTE FUNCTION privacy_v2_private.hydrate_protected_payload();
CREATE FUNCTION public.authorize_protected_asset(p_asset uuid,p_viewer uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT coalesce(EXISTS(SELECT 1 FROM public.post_media_assets a JOIN public.posts p ON p.id=a.post_id
  WHERE a.id=p_asset AND a.owner_id=p.user_id AND a.status='ready' AND a.delivery_type='authenticated'
   AND p.publishing_state='published' AND p_viewer IS NOT NULL
   AND privacy_v2_private.can_view_post_for(p.id,p_viewer)
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(p.media) m WHERE m->>'asset_id'=a.id::text OR m->>'thumbnail_asset_id'=a.id::text)),false)
$$;
CREATE FUNCTION public.protected_first_release_status() RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT jsonb_build_object('version',1,'publishing',new_protected_enabled,
  'delivery',protected_delivery_enabled,'legacy_conversion',restricted_enabled)
 FROM privacy_v2_private.release_control WHERE singleton
$$;
CREATE OR REPLACE FUNCTION public.protected_publishing_capabilities() RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT '{"version":2}'::jsonb $$;
REVOKE ALL ON FUNCTION public.protected_publish_transition(uuid,uuid,text,jsonb),
 public.claim_protected_cleanup(uuid,uuid,uuid,boolean),public.record_protected_cleanup(uuid,uuid,uuid,jsonb),
 public.protected_cleanup_candidates(integer),public.authorize_protected_asset(uuid,uuid),
 public.protected_first_release_status(),public.protected_publishing_capabilities() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.protected_publish_transition(uuid,uuid,text,jsonb),
 public.claim_protected_cleanup(uuid,uuid,uuid,boolean),public.record_protected_cleanup(uuid,uuid,uuid,jsonb),
 public.protected_cleanup_candidates(integer),public.authorize_protected_asset(uuid,uuid),
 public.protected_first_release_status(),public.protected_publishing_capabilities() TO service_role;
COMMIT;
`;
  return header + port(base) + intentColumns + '\n' + port(origins) + '\n' + port(transition) + '\n' + port(cleanup) + extra;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] !== '--write-review') throw Error('Use --write-review; this command never applies SQL');
  writeFileSync(new URL('docs/privacy-v2/protected-first-production-REVIEW.sql',root),prepareProtectedFirst());
  console.log('Prepared review-only protected-first SQL; no database connection made.');
}
