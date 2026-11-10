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
- Current send/view-once uploads remain unchanged. No claim of private Cloudinary behavior yet.

## Blocking backend implementation tasks (do not paste the supplied SQL directly)
1. Build additive `conversations.request_status` + `initiated_by` columns with a check constraint and separate migration verification. Do not apply request trigger to `is_note` or `is_group` rows.
2. Use immutable initiator; restrict who can create/accept/ignore/reopen requests. Keep participants as the only authorized actors. Enforce state transitions in PostgreSQL (not just JavaScript), including reply-accept atomically. Consider abuse/rate controls and ignored-request policy.
3. Audit and narrow existing broad `conversations` UPDATE policies for privileged fields (group permissions, owner, membership metadata, request status). Prefer RPCs and minimal column grants without breaking legacy updates.
4. Add membership-scoped `get_group_member_counts(uuid[])` with bounded input and EXECUTE only for authenticated users.
5. Replace the `message_reads` and `message_reactions` SELECT policies with participant-scoped policies. Confirm underlying table grants and RLS using different synthetic accounts, not privileged admin queries.
6. Design signed authenticated Cloudinary upload: authorize the sender and conversation, bound size/type, bind `public_id` to immutable message and asset owner. Never put API secret in the browser.
7. View-once claim should be an idempotent, atomic delivery state machine; prevent unrestricted unclaim after successful delivery. Reject senders and nonmembers; handle expired, blocked and deleted messages.
8. Edge Function should authenticate JWT, return consistent binary-versus-JSON responses, use private no-store caching and conservative CORS. Confirm Cloudinary authenticated fetch signing against Cloudinary's currently deployed API settings.
9. Use a durable cleanup table/queue and scheduled job rather than 90-second `waitUntil` sleep; cover group media, retries, failed uploads, message deletion and account deletion.
10. Do not strip historical media URLs or move existing messages without a separately reviewed legacy inventory and rollback plan.
11. Audit deployed `send-push-notification` JWT-disabled webhook and signed triggering separately; keep message notification delivery functional.

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
