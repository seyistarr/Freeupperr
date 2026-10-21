-- REVIEW ONLY. Run after production expansion and before audience/RPC fixes.
-- Confirmed catalog: follows_owner_write ALL permits followers to set themselves
-- active; no follows trigger verifies approval. Never execute in production yet.
BEGIN;
DO $$ BEGIN
 IF current_setting('freeupper.privacy_v2_project_ref',true) IS DISTINCT FROM 'jmjtqidirpmnegzvmiaq'
 OR current_setting('freeupper.privacy_v2_reviewed_release',true) IS DISTINCT FROM 'approved-production-migration'
 THEN RAISE EXCEPTION 'Explicit production migration approval required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='follows' AND policyname='follows_owner_write' AND cmd='ALL' AND qual='(auth.uid() = follower_id)')
 OR EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='follows' AND cmd<>'SELECT' AND policyname<>'follows_owner_write')
 THEN RAISE EXCEPTION 'Review follows policy drift'; END IF;
END $$;
CREATE TABLE privacy_v2_private.follow_approvals(
 follower_id uuid REFERENCES public.profiles ON DELETE CASCADE,following_id uuid REFERENCES public.profiles ON DELETE CASCADE,
 approval_kind text NOT NULL CHECK(approval_kind IN ('public_auto','owner')),approved_by uuid,approved_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(follower_id,following_id),CHECK((approval_kind='public_auto' AND approved_by IS NULL) OR (approval_kind='owner' AND approved_by=following_id)));
ALTER TABLE privacy_v2_private.follow_approvals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON privacy_v2_private.follow_approvals FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,DELETE ON privacy_v2_private.follow_approvals TO service_role;
-- Public accounts auto-accept follows; preserve these existing relationships.
-- Existing active PRIVATE-account follows have no trustworthy approval evidence:
-- preserve their rows/counts but require owner confirmation before restricted reads.
INSERT INTO privacy_v2_private.follow_approvals(follower_id,following_id,approval_kind)
 SELECT DISTINCT f.follower_id,f.following_id,'public_auto' FROM public.follows f JOIN public.profiles a ON a.id=f.following_id
 WHERE f.status='active' AND a.is_private=false ON CONFLICT DO NOTHING;
CREATE FUNCTION privacy_v2_private.approved_edge(p_follower uuid,p_following uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.follows f JOIN public.profiles a ON a.id=f.following_id
 WHERE f.follower_id=p_follower AND f.following_id=p_following AND f.status='active' AND a.suspended=false
 AND (a.is_private=false OR EXISTS(SELECT 1 FROM privacy_v2_private.follow_approvals v WHERE v.follower_id=p_follower AND v.following_id=p_following)))
$$;
REVOKE ALL ON FUNCTION privacy_v2_private.approved_edge(uuid,uuid) FROM PUBLIC,anon,authenticated;
-- Minimal definer wrapper: viewers can inspect only their own relationships.
CREATE FUNCTION public.privacy_v2_approved_edge(p_follower uuid,p_following uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND auth.uid() IN (p_follower,p_following) AND privacy_v2_private.approved_edge(p_follower,p_following)
$$;
REVOKE ALL ON FUNCTION public.privacy_v2_approved_edge(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.privacy_v2_approved_edge(uuid,uuid) TO anon,authenticated;
-- A private trigger must read the target's privacy flag independently of caller
-- profile RLS. All authorization still uses the real auth.uid(), never row input.
CREATE FUNCTION privacy_v2_private.guard_follow_approval() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE target_private boolean; actor uuid=auth.uid(); BEGIN
 IF TG_OP='DELETE' THEN DELETE FROM privacy_v2_private.follow_approvals WHERE follower_id=OLD.follower_id AND following_id=OLD.following_id;RETURN OLD;END IF;
 IF TG_OP='UPDATE' AND (NEW.follower_id IS DISTINCT FROM OLD.follower_id OR NEW.following_id IS DISTINCT FROM OLD.following_id)
 THEN RAISE EXCEPTION 'Follow identity is immutable'; END IF;
 SELECT is_private INTO target_private FROM public.profiles WHERE id=NEW.following_id AND suspended=false FOR SHARE;
 IF NOT FOUND OR target_private IS NULL OR NEW.follower_id=NEW.following_id OR NEW.status IS NULL OR NEW.status NOT IN ('pending','active') THEN RAISE EXCEPTION 'Invalid follow'; END IF;
 IF actor IS NOT NULL THEN
  IF TG_OP='INSERT' AND (actor<>NEW.follower_id OR (target_private AND NEW.status<>'pending') OR (NOT target_private AND NEW.status<>'active'))
  THEN RAISE EXCEPTION 'Target owner approval required'; END IF;
  IF TG_OP='UPDATE' AND (actor<>NEW.following_id OR OLD.status<>'pending' OR NEW.status<>'active')
  THEN RAISE EXCEPTION 'Only target owner can approve a pending follow'; END IF;
 END IF;
 IF NEW.status<>'active' THEN DELETE FROM privacy_v2_private.follow_approvals WHERE follower_id=NEW.follower_id AND following_id=NEW.following_id;
 ELSIF NOT target_private OR actor=NEW.following_id THEN
  INSERT INTO privacy_v2_private.follow_approvals(follower_id,following_id,approval_kind,approved_by)
   VALUES(NEW.follower_id,NEW.following_id,CASE WHEN target_private THEN 'owner' ELSE 'public_auto' END,CASE WHEN target_private THEN actor END) ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION privacy_v2_private.guard_follow_approval() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER privacy_v2_follow_approval BEFORE INSERT OR UPDATE OR DELETE ON public.follows FOR EACH ROW EXECUTE FUNCTION privacy_v2_private.guard_follow_approval();
DROP POLICY follows_owner_write ON public.follows;
CREATE POLICY privacy_v2_follow_request ON public.follows FOR INSERT TO authenticated WITH CHECK(follower_id=auth.uid());
CREATE POLICY privacy_v2_follow_approve ON public.follows FOR UPDATE TO authenticated USING(following_id=auth.uid() AND status='pending') WITH CHECK(following_id=auth.uid() AND status='active');
CREATE POLICY privacy_v2_follow_remove ON public.follows FOR DELETE TO authenticated USING(follower_id=auth.uid() OR following_id=auth.uid());
CREATE FUNCTION public.privacy_v2_confirm_follower(p_follower uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.follows WHERE follower_id=p_follower AND following_id=auth.uid() AND status='active' FOR UPDATE)
 THEN RAISE EXCEPTION 'Owned active follower required'; END IF;
 INSERT INTO privacy_v2_private.follow_approvals(follower_id,following_id,approval_kind,approved_by)
 VALUES(p_follower,auth.uid(),'owner',auth.uid()) ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.privacy_v2_confirm_follower(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.privacy_v2_confirm_follower(uuid) TO authenticated;
-- Independent restrictive policy closes permissive/owner ALL bypasses, including
-- legacy active edges which cannot establish historical private-owner consent.
CREATE POLICY privacy_v2_approved_audience ON public.posts AS RESTRICTIVE FOR SELECT TO anon,authenticated USING(
 publishing_state='published' AND is_hidden=false AND is_deleted=false AND EXISTS(SELECT 1 FROM public.profiles a WHERE a.id=posts.user_id AND a.suspended=false AND
 (auth.uid()=posts.user_id OR (visibility='public' AND a.is_private=false) OR
 (visibility IN ('public','followers','friends') AND public.privacy_v2_approved_edge(auth.uid(),posts.user_id)
 AND (visibility<>'friends' OR public.privacy_v2_approved_edge(posts.user_id,auth.uid()))))));
COMMIT;
