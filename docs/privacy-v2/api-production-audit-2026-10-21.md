# Privacy V2 API production audit (2026-10-21)

Review of the current PR #13 integration branch. No production activation authorized.

## Confirmed issue

`api/privacy-v2-publish.js` imports `readStagingPosts` and calls it for GET requests with `reader=posts`, regardless of `runtime.mode`. The reader is staging-specific. Before merge, return 404 for that GET route when `runtime.mode !== 'staging'`, or implement a separately audited production reader. The attempted code update was blocked, so this is **not fixed yet**.

## Other production blockers

- The database `create_protected_draft` and `protected_publish_transition` RPCs are deliberately fail-closed placeholders.
- The current production post write guard rejects restricted inserts; never remove it without a complete transaction-scoped authorization design.
- The draft creator from PR #9 must explicitly supply the required title and insert the post before the protected-origin record.
- `requirePublishingSchema` currently calls staging-named capability RPCs; verify their production equivalents and enforce independent release flags.
- The imported API still includes staging acceptance, cleanup, and legacy-conversion branches. Audit every branch for production isolation before merge.
- Validate the production authorization RPC only serves assets referenced by published post media.

## Release policy

Keep PR #13 draft. Do not merge or enable restricted audience publishing until the above items are fixed and verified.
