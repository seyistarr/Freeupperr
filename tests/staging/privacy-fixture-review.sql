-- REVIEW ONLY: synthetic fixtures for isolated staging project tagkrhvgcbnybiuyvjxt.
-- DO NOT execute this until the staging schema has been reviewed.
-- No production data or real user identifiers.
BEGIN;
INSERT INTO privacy_test.profiles (id,is_private,suspended) VALUES
('10000000-0000-4000-8000-000000000001',false,false),
('10000000-0000-4000-8000-000000000002',false,false),
('10000000-0000-4000-8000-000000000003',false,false),
('10000000-0000-4000-8000-000000000004',false,false)
ON CONFLICT (id) DO NOTHING;
INSERT INTO privacy_test.posts (id,user_id,visibility,is_deleted,is_hidden) VALUES
('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','followers',false,false),
('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','public',false,false),
('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','only_me',false,false),
('20000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','followers',true,false)
ON CONFLICT (id) DO NOTHING;
INSERT INTO privacy_test.follows(follower_id,following_id,status) VALUES
('10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','active'),
('10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','pending')
ON CONFLICT (follower_id,following_id) DO NOTHING;
INSERT INTO privacy_test.post_media_assets(id,post_id,owner_id,status,delivery_type,cloudinary_public_id,resource_type,format) VALUES
('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','ready','authenticated','freeupper_privacy_staging_fixture','video','mp4')
ON CONFLICT (id) DO NOTHING;
COMMIT;
