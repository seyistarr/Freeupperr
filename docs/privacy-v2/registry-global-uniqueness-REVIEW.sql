-- REVIEW ONLY — Privacy V2 registry uniqueness, not an executable production release.
-- Never run against production until registry schema, existing data and deployment
-- ordering have been reviewed. Keep the public-only gate enabled.
--
-- The staging registry has a partial unique index for the staging namespace.
-- The production registry must reject duplicate Cloudinary asset identities
-- regardless of public_id prefix or post ownership.
--
-- Preflight (read only; execute separately):
-- SELECT cloudinary_asset_id, count(*) FROM public.post_media_assets
-- WHERE cloudinary_asset_id IS NOT NULL
-- GROUP BY cloudinary_asset_id HAVING count(*) > 1;
--
-- This statement assumes the production registry exists and is empty or clean.
-- NULL asset identities should be disallowed separately after confirming the
-- intended schema and backfill. Do not silently discard conflicting records.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
  post_media_assets_cloudinary_asset_id_unique
ON public.post_media_assets (cloudinary_asset_id);
--
-- CONCURRENTLY cannot run inside a transaction block. Before deploying,
-- confirm that any index with this name is VALID and UNIQUE; IF NOT EXISTS
-- alone does not verify its definition or validity.
-- Do not use this review script to enable private posting or delivery.
