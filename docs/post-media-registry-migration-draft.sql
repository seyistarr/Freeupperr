-- REVIEW ONLY: deploy only after media authorization, RLS, and migration tests.
-- Registry contains identifiers, never long-lived signed delivery URLs.
BEGIN;
CREATE TABLE IF NOT EXISTS public.post_media_assets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
 owner_id uuid NOT NULL REFERENCES auth.users(id),
 cloudinary_asset_id text NOT NULL UNIQUE,
 cloudinary_public_id text NOT NULL,
 resource_type text NOT NULL CHECK(resource_type IN ('image','video','raw')),
 format text NOT NULL CHECK(format ~ '^[a-z0-9]{2,8}
 delivery_type text NOT NULL CHECK(delivery_type IN ('upload','private','authenticated')),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','ready','revoked','failed')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS post_media_assets_post_id_idx ON public.post_media_assets(post_id);
CREATE INDEX IF NOT EXISTS post_media_assets_owner_id_idx ON public.post_media_assets(owner_id);
ALTER TABLE public.post_media_assets ENABLE ROW LEVEL SECURITY;
-- Only service-role/server-side code may manage the registry until upload
-- authorization and ownership validation are implemented.
REVOKE ALL ON public.post_media_assets FROM anon, authenticated;
-- Do not add permissive policies; service_role bypasses RLS.
COMMIT;
),
 delivery_type text NOT NULL CHECK(delivery_type IN ('upload','private','authenticated')),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','ready','revoked','failed')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS post_media_assets_post_id_idx ON public.post_media_assets(post_id);
CREATE INDEX IF NOT EXISTS post_media_assets_owner_id_idx ON public.post_media_assets(owner_id);
ALTER TABLE public.post_media_assets ENABLE ROW LEVEL SECURITY;
-- Only service-role/server-side code may manage the registry until upload
-- authorization and ownership validation are implemented.
REVOKE ALL ON public.post_media_assets FROM anon, authenticated;
-- Do not add permissive policies; service_role bypasses RLS.
COMMIT;
