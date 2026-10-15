-- REVIEW ONLY. Isolated staging project tagkrhvgcbnybiuyvjxt.
-- Do not run on production. This draft is NOT a production migration.
BEGIN;
CREATE SCHEMA IF NOT EXISTS privacy_test;
CREATE TABLE IF NOT EXISTS privacy_test.profiles (
 id uuid PRIMARY KEY, is_private boolean NOT NULL DEFAULT false,
 suspended boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS privacy_test.posts (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES privacy_test.profiles(id),
 visibility text NOT NULL CHECK (visibility IN ('public','followers','friends','only_me')),
 is_deleted boolean NOT NULL DEFAULT false, is_hidden boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS privacy_test.follows (
 follower_id uuid NOT NULL REFERENCES privacy_test.profiles(id),
 following_id uuid NOT NULL REFERENCES privacy_test.profiles(id),
 status text NOT NULL CHECK (status IN ('active','pending','blocked')),
 PRIMARY KEY (follower_id,following_id),
 CHECK (follower_id <> following_id)
);
CREATE TABLE IF NOT EXISTS privacy_test.post_media_assets (
 id uuid PRIMARY KEY, post_id uuid NOT NULL REFERENCES privacy_test.posts(id),
 owner_id uuid NOT NULL REFERENCES privacy_test.profiles(id),
 status text NOT NULL CHECK (status IN ('pending','ready','failed')),
 delivery_type text NOT NULL CHECK (delivery_type IN ('authenticated','upload')),
 cloudinary_public_id text NOT NULL,
 resource_type text NOT NULL CHECK (resource_type IN ('image','video','raw')),
 format text NOT NULL
);
ALTER TABLE privacy_test.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_test.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_test.follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_test.post_media_assets ENABLE ROW LEVEL SECURITY;
-- No policies or client grants. Test harness must use privileged server-side access.
COMMIT;
