-- STAGE 2 ONLY. No production authorization is conveyed by this file.
-- Generated concrete manifests must be reviewed separately. No aliases are created.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SET LOCAL timezone='UTC';
-- Match Auth -> profile lock order used by signup, and freeze verification evidence.
LOCK TABLE auth.users IN SHARE MODE;
LOCK TABLE public.profiles IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE approved_identity_fields (
 freeupper_id text NOT NULL,field text NOT NULL CHECK(field IN ('username','display_name','display_username')),
 guard_token text NOT NULL CHECK(guard_token ~ '^[0-9a-f]{64}$'),PRIMARY KEY(freeupper_id,field)
) ON COMMIT DROP;
CREATE TEMP TABLE approved_mention_posts(post_id uuid PRIMARY KEY,guard_token text NOT NULL,expected_references integer NOT NULL CHECK(expected_references>0)) ON COMMIT DROP;
-- APPROVED_FIELD_MANIFEST
-- APPROVED_POST_MANIFEST
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM approved_identity_fields) THEN RAISE EXCEPTION 'Empty approved manifest'; END IF;
 IF EXISTS(SELECT 1 FROM approved_identity_fields a
 LEFT JOIN public.profiles p USING(freeupper_id) LEFT JOIN auth.users u ON u.id=p.id
 WHERE p.id IS NULL OR u.email_confirmed_at IS NULL OR
 (CASE a.field WHEN 'username' THEN p.username WHEN 'display_name' THEN p.display_name ELSE p.display_username END) IS DISTINCT FROM u.email OR
 a.guard_token IS DISTINCT FROM encode(sha256(convert_to(jsonb_build_array(p.id,p.freeupper_id,a.field,p.username,p.display_name,p.display_username,u.email,
 to_char(u.email_confirmed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US'))::text,'UTF8')),'hex')) THEN
 RAISE EXCEPTION 'Field evidence changed; regenerate and review preview'; END IF;
 IF EXISTS(SELECT 1 FROM public.profiles p JOIN auth.users u ON u.id=p.id
 CROSS JOIN LATERAL(VALUES ('username',p.username),('display_name',p.display_name),('display_username',p.display_username)) f(field,value)
 WHERE u.email_confirmed_at IS NOT NULL AND f.value=u.email
 AND NOT EXISTS(SELECT 1 FROM approved_identity_fields a WHERE a.freeupper_id=p.freeupper_id AND a.field=f.field)) THEN
 RAISE EXCEPTION 'Confirmed exposure set changed; regenerate and review preview'; END IF;
 IF EXISTS(SELECT 1 FROM approved_identity_fields a JOIN public.profiles p USING(freeupper_id)
 WHERE a.field='username' AND (p.freeupper_id !~ '^FU[0-9A-F]{12}$' OR EXISTS(
 SELECT 1 FROM public.profiles q WHERE q.id<>p.id AND lower(q.username)=lower(p.freeupper_id)))) THEN
 RAISE EXCEPTION 'Default username incompatibility or conflict'; END IF;
 IF EXISTS(SELECT 1 FROM approved_identity_fields a JOIN public.profiles p USING(freeupper_id)
 WHERE a.field='display_username' AND NOT EXISTS(SELECT 1 FROM approved_identity_fields b WHERE b.freeupper_id=a.freeupper_id AND b.field='username')
 AND (p.username IS NULL OR p.username !~ '^[A-Za-z0-9_.]{1,30}$')) THEN
 RAISE EXCEPTION 'Presentation replacement requires a safe canonical username'; END IF;
END $$;
CREATE TABLE identity_private.stage2_profile_backup (
 profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,freeupper_id text NOT NULL,
 old_username text,old_display_name text,old_display_username text,
 new_username text,new_display_name text,new_display_username text,
 username_changed boolean NOT NULL,display_name_changed boolean NOT NULL,display_username_changed boolean NOT NULL
);
ALTER TABLE identity_private.stage2_profile_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON identity_private.stage2_profile_backup FROM PUBLIC,anon,authenticated;
CREATE TABLE identity_private.stage2_post_backup (
 post_id uuid PRIMARY KEY REFERENCES public.posts(id) ON DELETE CASCADE,
 old_title text,old_description text,old_content text,old_mentions jsonb,
 new_title text,new_description text,new_content text,new_mentions jsonb
);
ALTER TABLE identity_private.stage2_post_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON identity_private.stage2_post_backup FROM PUBLIC,anon,authenticated;
INSERT INTO identity_private.stage2_profile_backup
SELECT p.id,p.freeupper_id,p.username,p.display_name,p.display_username,
 CASE WHEN bool_or(a.field='username') THEN lower(p.freeupper_id) ELSE p.username END,
 CASE WHEN bool_or(a.field='display_name') THEN 'FreeUpper User' ELSE p.display_name END,
 CASE WHEN bool_or(a.field='display_username') THEN CASE WHEN bool_or(a.field='username') THEN lower(p.freeupper_id) ELSE p.username END ELSE p.display_username END,
 bool_or(a.field='username'),bool_or(a.field='display_name'),bool_or(a.field='display_username')
FROM public.profiles p JOIN approved_identity_fields a USING(freeupper_id) GROUP BY p.id;
-- REF_REWRITE_HELPERS
-- REF_REWRITE_AND_GUARDS
UPDATE public.profiles p SET username=b.new_username,display_name=b.new_display_name,display_username=b.new_display_username
FROM identity_private.stage2_profile_backup b WHERE p.id=b.profile_id;
-- Do not silently change onboarding, IDs, visibility, media, or relationship keys.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM identity_private.stage2_profile_backup b JOIN public.profiles p ON p.id=b.profile_id
 WHERE p.freeupper_id IS DISTINCT FROM b.freeupper_id OR p.username IS DISTINCT FROM b.new_username
 OR p.display_name IS DISTINCT FROM b.new_display_name OR p.display_username IS DISTINCT FROM b.new_display_username) THEN
 RAISE EXCEPTION 'Unexpected identity normalization; abort entire batch'; END IF;
END $$;
SELECT count(*) AS affected_profiles FROM identity_private.stage2_profile_backup;
SELECT count(*) AS affected_posts FROM identity_private.stage2_post_backup;
-- Dry run by default. Only a separately approved exact artifact may COMMIT.
ROLLBACK;
