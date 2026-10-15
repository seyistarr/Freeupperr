# Protected media delivery design — review only

Status: **not deployed**. Applies to FreeUpper post images, videos, thumbnails and derived formats. Do not turn on the new audience UI until this is implemented and tested.

## Verified existing behavior
- Create and Studio use unsigned browser-to-Cloudinary upload presets and persist `secure_url`.
- Sampled Cloudinary images in `freeupper/posts/images` are `type=upload` with anonymous access.
- Therefore neither HTTPS nor Supabase RLS prevents access to copied public URLs.
- Video delivery type and legacy media inventory remain unverified.

## Data model
Create a `post_media_assets` registry with: `id`, `post_id`, `owner_id`, `cloudinary_public_id`, `cloudinary_asset_id`, `resource_type`, `delivery_type`, `status`, `created_at`. Never accept a Cloudinary public ID from the viewer as the sole authorization reference.

## Upload contract
1. Browser authenticates with a Supabase access token.
2. Server validates token, account status, intended post and quota, then issues a tightly scoped short-lived signed upload authorization (or proxies the upload).
3. Restricted uploads use authenticated delivery from the start; never expose a public `secure_url` or publicly accessible thumbnails.
4. Server verifies Cloudinary upload response, associates immutable asset ID with the authenticated owner and post, and commits the media record. Treat abandoned uploads and retries safely.
5. Public posts may continue using public delivery until migrated, but a private author must not be allowed to create a publicly accessible media asset.

## Playback contract
`GET /api/post-media?asset_id=<uuid>` requires a valid user session for restricted media.
Server resolves asset -> post -> author and verifies deletion, hidden/suspended status, post audience, account privacy and approved follow relationship. Never trust client-supplied visibility or owner ID.
For authorized requests, issue a short-lived Cloudinary authenticated delivery URL or proxy stream. Responses for private media: `Cache-Control: private, no-store`, `Vary: Authorization`, `X-Robots-Tag: noindex, nofollow`.
Reject unauthorized access with a generic 404; rate-limit and log decisions without logging signed URLs.

## Public-to-private transitions
Changing post audience or making an account private must **first** revoke public asset delivery, including transformed thumbnails, posters, HLS segments, derivatives and CDN caches. Old copied URLs and cached files are a migration risk; do not promise retroactive revocation until tested.
If asset conversion cannot be completed safely, block the privacy change with an explicit user-facing error instead of silently leaving media public.
Do not delete or rename existing Cloudinary assets without backups and a tested mapping/rewrite.

## Integration gates
- Implement server-side asset registry and authenticated upload/delivery.
- Replace direct public URL rendering in Home, Video, Profile, Search, shares, OG previews and sounds where applicable.
- Test logged-out, owner, approved/pending follower, friend, stranger, suspended and deleted scenarios.
- Test raw Cloudinary URLs and all derivatives after privacy transitions, including cache behavior.
- Ensure public SEO previews never include restricted media.
- Review Cloudinary plan and capabilities for authenticated delivery and signed URLs.
- Deploy media protection, RPC fixes, RLS and audience UI in a coordinated rollout; do not merge a partial implementation.
