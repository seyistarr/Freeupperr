-- SEPARATE EXCEPTIONAL DATA ROLLBACK, NOT A NORMAL WEB ROLLBACK.
-- Restoring these old values reintroduces email exposure. Prefer a roll-forward fix.
-- Requires explicit approval of that exposure as well as the precise affected batch.
BEGIN;
SET LOCAL lock_timeout='5s';
LOCK TABLE public.profiles IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.posts IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
 IF current_setting('identity.explicit_email_reexposure_approval',true) IS DISTINCT FROM 'approved' THEN
  RAISE EXCEPTION 'Email re-exposure rollback is not authorized'; END IF;
 IF EXISTS(SELECT 1 FROM identity_private.stage2_profile_backup b JOIN public.profiles p ON p.id=b.profile_id
 WHERE p.freeupper_id IS DISTINCT FROM b.freeupper_id OR
 (b.username_changed AND p.username IS DISTINCT FROM b.new_username) OR
 (b.display_name_changed AND p.display_name IS DISTINCT FROM b.new_display_name) OR
 (b.display_username_changed AND p.display_username IS DISTINCT FROM b.new_display_username)) THEN
 RAISE EXCEPTION 'Subsequent identity customization requires per-field rollback review'; END IF;
 IF EXISTS(SELECT 1 FROM identity_private.stage2_post_backup b JOIN public.posts p ON p.id=b.post_id
 WHERE p.title IS DISTINCT FROM b.new_title OR p.description IS DISTINCT FROM b.new_description
 OR p.content IS DISTINCT FROM b.new_content OR p.mentions IS DISTINCT FROM b.new_mentions) THEN
 RAISE EXCEPTION 'Subsequent post edit requires manual rollback review'; END IF;
END $$;
ALTER TABLE public.profiles DISABLE TRIGGER validate_profile_identity;
UPDATE public.profiles p SET username=CASE WHEN b.username_changed THEN b.old_username ELSE p.username END,
 display_name=CASE WHEN b.display_name_changed THEN b.old_display_name ELSE p.display_name END,
 display_username=CASE WHEN b.display_username_changed THEN b.old_display_username ELSE p.display_username END
FROM identity_private.stage2_profile_backup b WHERE p.id=b.profile_id;
ALTER TABLE public.profiles ENABLE TRIGGER validate_profile_identity;
UPDATE public.posts p SET title=b.old_title,description=b.old_description,content=b.old_content,mentions=b.old_mentions
FROM identity_private.stage2_post_backup b WHERE p.id=b.post_id;
-- Retain private backups until the reviewed retention window closes. No aliases.
ROLLBACK;
