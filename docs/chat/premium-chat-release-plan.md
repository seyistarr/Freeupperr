# FreeUpper premium chat — reviewed implementation and release gates

Status: **IN PROGRESS / NO PRODUCTION DEPLOY**. Review branch only. Base main: `23d4d84bca1a6f94b058c6b5d1c3eaf50449738a`.

## Confirmed product requirements
- Lavender-to-purple glass chat inbox; header search and avatar; New button above tabs.
- All, Unread, Groups, Requests use one ordered conversation list. Unread and Requests omit the search bar; Groups searches groups.
- Every chat panel has independent subtle 3D perspective **without overlap or ordering changes**; reduced-motion users get flat cards.
- New Message has persistent New Group and My Note actions alongside a dynamic people search.
- Preserve existing messaging, groups, presence, typing, reactions, search, archive, drafts, polls, notes, media, notifications, PWA navigation and accessibility.
- Authenticated private media with one-time authorization; private media is not a substitute for E2EE.

## What is implemented on this branch
- `chat.html`: premium colors, header, tabs, list skin, persistent New Group and My Note actions, view-once privacy-shield element.
- `chat.js`: tab filtering, counts, group count RPC integration with graceful fallback, 3D row transforms, avatar profile action.
- Message Requests **currently intentionally disabled for mutations** until the secure backend functions are available.
- Existing `public.claim_view_once(uuid,integer)` and `view_once_consumptions` remain the **single source of truth** for one-time delivery. The private Cloudinary registry is supplemental asset storage/authorization metadata, not a replacement consumption system.
- `chat.js` has a separate opt-in private-media path guarded by `window.FREEUPPER_PRIVATE_VIEWONCE_ENABLED === true`. It remains disabled by default; legacy view-once media still uses its original RPC and URL path.
- `view-once-open` buffers authenticated Cloudinary bytes, then invokes the **existing** `claim_view_once` with the recipient's JWT; it does not use a second claim RPC.
- `docs/chat/sql/proposed-private-view-once.sql` adds a viewer-only SELECT policy to the existing RLS-protected consumption table (the live table currently has no SELECT policy).
- Upload/cleanup/registry drafts are NOT deployed; their Deno type-check passed in isolated GitHub Actions run #28, but real authenticated end-to-end delivery is not tested.

## Blocking backend implementation tasks (do not paste the supplied SQL directly)
1. Build additive `conversations.request_status` + `initiated_by` columns with a check constraint and separate migration verification. Do not apply request trigger to `is_note` or `is_group` rows.
2. Use immutable initiator; restrict who can create/accept/ignore/reopen requests. Keep participants as the only authorized actors. Enforce state transitions in PostgreSQL (not just JavaScript), including reply-accept atomically. Consider abuse/rate controls and ignored-request policy.
3. Audit and narrow existing broad `conversations` UPDATE policies for privileged fields (group permissions, owner, membership metadata, request status). Prefer RPCs and minimal column grants without breaking legacy updates.
4. Add membership-scoped `get_group_member_counts(uuid[])` with bounded input and EXECUTE only for authenticated users.
5. Replace the `message_reads` and `message_reactions` SELECT policies with participant-scoped policies. Confirm underlying table grants and RLS using different synthetic accounts, not privileged admin queries.
6. Design signed authenticated Cloudinary upload: authorize the sender and conversation, bound size/type, bind `public_id` to immutable message and asset owner. Never put API secret in the browser.
7. Preserve the existing `claim_view_once` atomic consumption transaction and its unique consumption primary key. Harden its surrounding asset-access path only; do not introduce a second claim/unclaim system. Reject senders/nonmembers; handle expired, blocked and deleted messages.
8. Edge Function should authenticate JWT, return consistent binary-versus-JSON responses, use private no-store caching and conservative CORS. Confirm Cloudinary authenticated fetch signing against Cloudinary's currently deployed API settings.
9. Use a durable cleanup table/queue and scheduled job rather than 90-second `waitUntil` sleep; cover group media, retries, failed uploads, message deletion and account deletion. A Cloudinary inventory reconciliation is still required for unregistered orphans. The draft cleanup worker is not scheduled.
10. Do not strip historical media URLs or move existing messages without a separately reviewed legacy inventory and rollback plan.
11. Review the new atomic publish-after-upload path: the Edge Function uploads to Cloudinary, then one service-role RPC creates the message and registers the asset in a single database transaction. It prevents premature message visibility but still needs database-trigger compatibility tests, failure-injection tests, and orphan reconciliation. First canary supports DMs only; groups require separate authorization testing.
12. Audit deployed `send-push-notification` JWT-disabled webhook and signed triggering separately; keep message notification delivery functional.

## Browser acceptance and private-media release boundaries (2026-11-10)
- The separate `tests/chat-premium-browser.test.js` executes actual chat tab-switching handlers against extracted production markup in headless Chromium. It exercises iPhone-sized (390 × 844) and desktop (1280 × 800) layouts, Unread/Requests search suppression, Groups search, New Message actions surviving dynamic search results, reduced-motion navigation, and ordered 3D card geometry using the page's inline CSS. It does **not** assert full live authenticated page boot.
- CI job `chat-browser-acceptance` runs this test with Playwright and no connected Supabase or Cloudinary credentials, alongside existing offline contracts, synthetic PostgreSQL, and Deno type-check. Branch job result must be checked before any claim of pass.
- Real user/device acceptance remains mandatory: iPhone Safari/PWA keyboard resize, scroll/overscroll, group creation, notes, archived-chat recovery, push/badges, realtime messaging, message requests with authorized RPCs, media viewer, and accessibility.
- Keep `FREEUPPER_PRIVATE_VIEWONCE_ENABLED` disabled; the existing Supabase `claim_view_once` path remains active. Dedicated, authorized private-media test assets and two genuine test sessions are required for upload → access → atomic claim → replay denied → Cloudinary cleanup validation.
- No live identities, historical private chats or production Cloudinary objects are used for acceptance tests. No merge, SQL migration or Edge deployment without separate explicit approval.

## Authenticated integration preparation (2026-11-10)
- The real `view-once-open` HTTP handler is now importable with injected database/client and Cloudinary fetch dependencies. Deployment still starts `Deno.serve`; the listener is suppressed only when the isolated test variable `CHAT_PRIVATE_HTTP_TEST_MODE=true` is set.
- `tests/chat-private-http.test.ts` and the `edge-typecheck` GitHub Actions job exercise synthetic caller JWT, disallowed origin, nonparticipant/expired message, Cloudinary success/failure/oversize, first view, replay denial and fail-closed flag using **in-memory fakes only**. These tests are not a substitute for real authenticated integration; their new CI result must pass.
- Read-only staging inspection of project `tagkrhvgcbnybiuyvjxt` found none of `conversations`, `messages`, `conversation_members`, `view_once_consumptions`, `message_reads` or `message_reactions` under `public`. Do not assume existing staging is a valid integration replica.
- To authorize real two-account acceptance, build a separately approved isolated baseline schema/migrations with synthetic identities and test media; do not copy live private chats or service keys. Verify two JWT sessions: sender can upload and publish only in their DM; recipient opens exactly once, replay returns denial; stranger, sender, expired and blocked requests are denied; forged request status and RLS changes are rejected; orphan queue removes only marked test assets. Confirm upload/claim/cleanup fail-closed on injected Cloudinary and database failures.
- Keep `CHAT_PRIVATE_MEDIA_ENABLED=false` server-side and `FREEUPPER_PRIVATE_VIEWONCE_ENABLED` false client-side until those authentic live-network staging tests succeed. No staging schema writes, production migrations, real Cloudinary upload or Edge deployment have been performed as part of this phase.

## Isolated HTTP integration readiness (2026-11-10)
- Added `tests/chat-private-http.test.ts` using the actual exported `handleViewOnceOpen` handler and injected in-memory Supabase / Cloudinary I/O. It exercises missing JWT, invalid JWT, forbidden viewer, successful binary delivery, replay denial, Cloudinary failure without claim, expired media, oversized response, disallowed origin and the disabled feature flag. No live service-role keys, production assets or real accounts are required.
- GitHub Actions `edge-typecheck` now invokes the Deno HTTP test suite after type-checking. **Its CI result has not been independently verified yet.** A passing mock test is not evidence that Cloudinary asset-download signing, JWT validation or storage restrictions work with real services.
- Production listener startup remains normal; only `CHAT_PRIVATE_HTTP_TEST_MODE=true` suppresses `Deno.serve` during isolated tests. The runtime media flag `CHAT_PRIVATE_MEDIA_ENABLED` must remain disabled.
- Read-only staging inspection of project `tagkrhvgcbnybiuyvjxt` found none of the essential public chat tables (`conversations`, `messages`, `view_once_consumptions`, `conversation_members`, `message_reads`, `message_reactions`). Do not use this staging database for chat integration until a reviewed schema-only baseline and isolated test identities are provisioned. No staging mutations were made.
- Authenticated end-to-end canary requires two newly created, explicitly authorized test accounts, a clean chat schema/RLS setup, separately scoped Cloudinary test credentials and synthetic media, with upload → authorized open → replay denied → cleanup verification. Keep migrations/deployments behind separate approval.
- Physical iPhone Safari/PWA acceptance, real-time messaging, requests and groups remain outstanding. No production push or deployment.

## Verification gates
- Static JS parse and unique DOM ID checks on changed frontend files.
- Desktop + iPhone Safari/PWA keyboard, tab navigation, 3D scroll, reduced motion, New Message search, archived-chat interactions.
- Existing conversation, group-admin, typing, realtime and unread-count regression checks.
- SQL migration apply/rollback in an isolated local PostgreSQL environment; no staging account or paid staging required.
- RLS matrix for initiator, recipient, group member, nonmember, anonymous and service role.
- Cloudinary test with a synthetic media item: upload → authorized stream → denied replay → durable deletion.
- Firebase push webhook authorization and no plaintext private-media URLs in payloads.
- Inspect CI and Cloudflare Workers auto-build triggers before any push/merge to main.
- Production data mutation, Supabase Edge deployment, Cloudinary config or main merge require explicit separate approval.

## Observed current production schema
`conversations` had no `request_status`, `initiated_by` or `is_public` columns at inspection time.
`messages` stores `media_url`, `media_urls`, `metadata`, `expires_at`; `view_once_consumptions` stores viewer/media index.
The existing `get_unread_message_count(p_user_id)` SECURITY DEFINER function lacks caller-to-parameter restriction.
`message_reads` and `message_reactions` have permissive SELECT policies.
The deployed `send-push-notification` function is JWT-disabled and currently invoked by the `messages` insert trigger.

## Release decision
NO-GO until the blocking backend controls and regression tests are complete. Never run migration/Edge Function deployment automatically as part of a branch creation.

## Existing view-once confirmation (read-only 2026-11-10)
- Production `public.claim_view_once(p_message_id uuid, p_media_index integer)` is SECURITY DEFINER and callable by authenticated users only; no anon EXECUTE.
- It gets `auth.uid()`, checks sender exclusion, view-once message type and metadata, expiry, media-index bounds, DM blocking, group membership and note exclusion, then INSERTs into `view_once_consumptions` with conflict handling and returns `opened` or `already_viewed`.
- `view_once_consumptions` has RLS and a SELECT grant but **zero active SELECT policies**; a new owner-only SELECT policy is proposed in the review SQL, not applied.
- Historical messages can still contain media URLs. Improving one-time RPC behavior does **not** revoke a permanent public URL; private Cloudinary media and legacy asset inventory require a separate consented rollout.
- The earlier private upload placeholder/notification race was addressed in branch code with an upload-first and atomic publish RPC. **Feature flag must remain disabled** until actual SQL apply/rollback, trigger compatibility, integration tests and Cloudinary orphans are verified.
