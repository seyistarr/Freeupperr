# Privacy V2 controlled production acceptance gate

Status: **design / not activated**. Never set production delivery or publishing flags until server-side enforcement and tests are reviewed.

## Participants
- @archangelstr — publisher and owner
- @freeupper — mutual follower and optional publisher
- @firstuser — independent non-follower; **not** a publishing allowlist member

Resolve account IDs from authenticated Supabase profiles; do not trust usernames supplied in requests. Verify the current follow edges before each test.

## Required design
1. Add a private database allowlist keyed by immutable auth user UUID. Limit to the two publisher accounts. Expose no client-side writable allowlist.
2. Add a separately versioned controlled-release capability that distinguishes `off`, `test`, and `general`. The current production flags and CHECK(false) gates are intentionally fail-closed; replace only in a reviewed migration with an immediate rollback path.
3. Enforce allowlist in **every** server-side draft creation, reservation, upload signing, asset registration, and publishing transition. A UI-only allowlist is insufficient. Keep Cloudinary assets authenticated and require per-request viewer authorization for media delivery.
4. Expose a read-only capability endpoint that returns whether the **authenticated user** can publish protected posts. Enable the three select options in create.html only when this capability is true. Keep Public enabled for everyone.
5. Deny unauthenticated and non-follower reads even with direct post IDs or media asset IDs. A mutual follower can read Followers and Mutuals, but never Only Me.
6. Preserve existing Public posts and existing production behavior. Test rollback before general release.

## Acceptance matrix
| Viewer | Public | Followers | Mutuals | Only Me |
| --- | --- | --- | --- | --- |
| @archangelstr (owner) | yes | yes | yes | yes |
| @freeupper (mutual) | yes | yes | yes | no |
| @firstuser (no relationship) | yes | no | no | no |
| anonymous | yes | no | no | no |

Also test text, image, video, video thumbnail, profile feed, homepage, short links, direct asset URL, logout/cache cleanup, and attempts to bypass the allowlist via API calls.

## Release gates
- Stage 1: branch implementation, SQL migration, automated negative tests.
- Stage 2: review production Supabase function signatures/triggers and runtime contracts.
- Stage 3: controlled production activation for two publishers only; manual authenticated tests.
- Stage 4: global release only after all negative tests pass.

Do not merge or deploy an incomplete gate.