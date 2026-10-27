-- Maintain approval records only for new/changed follows of public accounts.
-- Private accounts still require an explicit owner approval. No backfill occurs.
CREATE OR REPLACE FUNCTION privacy_v2_private.sync_follow_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  DELETE FROM privacy_v2_private.follow_approvals
   WHERE follower_id=OLD.follower_id AND following_id=OLD.following_id;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND (NEW.follower_id IS DISTINCT FROM OLD.follower_id
   OR NEW.following_id IS DISTINCT FROM OLD.following_id OR NEW.status IS DISTINCT FROM 'active') THEN
  DELETE FROM privacy_v2_private.follow_approvals
   WHERE follower_id=OLD.follower_id AND following_id=OLD.following_id;
 END IF;
 IF NEW.follower_id IS NOT NULL AND NEW.following_id IS NOT NULL
   AND NEW.follower_id<>NEW.following_id AND NEW.status='active'
   AND EXISTS (SELECT 1 FROM public.profiles WHERE id=NEW.following_id
     AND is_private IS FALSE AND suspended IS FALSE) THEN
  INSERT INTO privacy_v2_private.follow_approvals(follower_id,following_id,approval_kind,approved_by)
   VALUES(NEW.follower_id,NEW.following_id,'public_auto',NULL)
   ON CONFLICT(follower_id,following_id) DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION privacy_v2_private.sync_follow_approval() FROM PUBLIC;
CREATE TRIGGER privacy_v2_sync_follow_approval
 AFTER INSERT OR DELETE OR UPDATE OF follower_id,following_id,status ON public.follows
 FOR EACH ROW EXECUTE FUNCTION privacy_v2_private.sync_follow_approval();
