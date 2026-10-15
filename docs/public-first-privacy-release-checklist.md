# FreeUpper public-first privacy release checklist

Status: **NOT APPROVED FOR MAIN**. Review branch: `post-visibility-privacy-review`.

## Scope
- Preserve existing post rows, existing public media URLs, users and production settings.
- Keep new legacy posts public by default.
- Do not promise Followers, Friends/Mutuals or Only Me privacy until protected uploads, delivery and database enforcement are deployed together.
- Preserve existing private-account visibility and any existing access restrictions. Do not bulk-reset legacy rows to public.

## Confirmed in code review
- `create.html` and `studio.html`: restricted audience options disabled; Everyone remains default.
- `posts.js`: restricted visibility rejected before legacy post insert and before legacy visibility update.
- Protected-media endpoint is staging-gated and unavailable in production.
- Isolated Cloudinary CI run #75 passed four jobs; this does not validate production DB/RPC rules or end-to-end playback.

## Release blockers
1. **Database authorization:** inventory all `posts` RLS SELECT/INSERT/UPDATE policies and SECURITY DEFINER RPCs. Confirm legacy writes cannot create restricted posts or bypass restrictions. Do not apply unreviewed SQL.
2. **Regression:** confirm public image, video and text publishing from Create and Studio, and Home/Video/Profile/Search/share playback using nonproduction accounts and media.
3. **UI:** confirm disabled audience options cannot be selected, and existing private-account rules remain in effect.
4. **Security:** verify no alternative client/RPC route claims a public Cloudinary upload is restricted; verify legacy visibility edits cannot falsely make public media private.
5. **Deployment:** use a minimal reviewed PR/cherry-pick rather than merging the 106-commit review branch. Do not include staging-only Cloudinary config, experimental API, draft SQL, or staging DB workflows in a public-first release.
6. **Rollback:** record base `main` commit and prepare a revert of the focused release; verify public posting and feed after deployment.

## Deferred to protected-media phase
- Dedicated FreeUpper staging database (never use OTD/OCIDE staging).
- Protected upload/asset registration, thumbnail and cache behavior, server authorization and signed delivery.
- Owner, follower, mutual, stranger, revoked follower, suspended/deleted and expiry tests.
- Migration or restriction of legacy public Cloudinary URLs, only if an owner explicitly changes an existing post to a restricted audience.

## Approval gate
Do not merge to `main`, deploy, change production database, or enable protected delivery until tests and a minimal PR are reviewed and the owner explicitly approves.
