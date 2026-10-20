# Protected media frontend integration

Implemented on `feature/post-privacy-v2-integration`. Backend delivery remains disabled by default and restricted to isolated staging. No deployment or database migration is part of this change.

## Browser contract

Protected post media uses `media` JSON entries with a registry UUID, for example:

```json
{
  "type": "video",
  "asset_id": "30000000-0000-4000-8000-000000000003",
  "thumbnail_asset_id": "30000000-0000-4000-8000-000000000004"
}
```

`assetId` / `thumbnailAssetId` are also accepted. Single-media rows may use `media_asset_id` / `mediaAssetId` (or `asset_id` / `assetId`); row thumbnail references use `thumbnail_asset_id` / `thumbnailAssetId`. These are **post_media_assets registry IDs**, never Cloudinary asset IDs, public IDs, or delivery URLs. Thumbnail references must identify separately registered image assets. Video assets without a registered thumbnail have no poster; image assets can use their authorized image bytes as their thumbnail.

PostsAPI resolves these references before returning posts to the existing feed, carousel, lightbox, video, similar-post and preview consumers. Restricted visibility, a private author profile, explicit protected delivery metadata, registry references, authenticated/private media URLs, or a proxy URL trigger protected delivery. All media in such a post requires registry references; legacy media and thumbnail URL fields are discarded. A missing reference, guest session, denied request, invalid response, or failed download never causes a public URL fallback. Failed media shows an unavailable state in the feed and video viewer while retaining the post's engagement controls and counters. Public posts without protected metadata retain the existing direct URL path.

The browser sends the current session access token in the Authorization header to `/api/post-media?asset_id=<registry UUID>`. Server authorization remains authoritative; browser session data only supplies the token. Redirects are rejected, requests bypass browser caches, and the service worker excludes all same-origin API requests and all authenticated requests from CacheStorage. The cache version changes to remove old caches on activation.

Only successful image/video byte responses become temporary object URLs. Those URLs are kept for the page lifetime so existing card, gallery and poster consumers can share them. Sign-out, account change and page navigation abort requests, detach loaded protected elements and revoke object URLs. Restoring a page from the back/forward cache reloads it. No bearer token or protected byte response is persisted to storage.

## Limits and verification

This implementation downloads the complete protected asset before playback; seeking then uses the local object URL. It does not implement adaptive streaming or browser range streaming. The existing proxy's 50 MiB limit and all staging environment restrictions remain in effect. Protected assets require correctly populated registry references; the frontend does not query the private registry or enable restricted uploads/audience changes.

Run `npm run test:post-media`. Frontend tests exercise authenticated image/video/poster delivery, public media regression, guests, denied/failed delivery, response type validation, session changes, navigation cleanup, renderer integration, and service-worker cache bypass. Live multi-account playback still requires the isolated staging environment and its existing checklist; these tests do not modify any database or Cloudinary assets.
