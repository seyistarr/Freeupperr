# Production schema reconciliation — 2026-10-21

Read-only catalog inspection against Supabase production `jmjtqidirpmnegzvmiaq`.

## Confirmed
- All draft lifecycle columns exist: `media_plan`, `publish_payload`, `draft_expires_at`, `cleanup_lease`, `cleanup_lease_until`.
- `posts.media` is nullable JSONB and existing media data must remain intact.
- `posts.title` is **NOT NULL with no default**. The draft creator extracted from PR #9 inserts `posts(id,user_id,visibility,is_hidden,is_deleted,publishing_state,media,media_plan,publish_payload,draft_expires_at)` without `title`. **It will fail on production unless the creator supplies title or a correctly ordered BEFORE INSERT trigger hydrates it.**
- `posts.source` is NOT NULL with default `composer`; `posts.visibility` is nullable with default `public`; `publishing_state` is NOT NULL with default `published`.
- Current `protected_publish_transition` in production is a fail-closed placeholder; extracted SQL in this PR is review-only.

## Required before deploying transaction
1. Correct the draft creation insert to satisfy NOT NULL title without exposing private media URLs. Validate title/content/tags and source in the same transaction.
2. Ensure origin ownership is tied to the actual draft and is atomically created; review the foreign key from `protected_post_origins.post_id` to `posts.id` (origin must be inserted after post, or defer constraint safely).
3. Install and verify the write guard, reference guard, draft creator and transition in a single reviewed migration with service-only grants.
4. Enforce owner-approved follows and revocation before activating audience access.
5. Keep DB `protected_first_release_status()` returning delivery=false and Vercel protected publishing disabled until end-to-end production prerequisites are met.

Do not run the extracted PR #9 review SQL unchanged against production.
