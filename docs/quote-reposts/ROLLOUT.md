# Production rollout record

Project: FreeUpper / `jmjtqidirpmnegzvmiaq`. Branch: `main`. User explicitly approved the migration and conditional subsequent activation on 2026-10-29. Prepared application commit: `d40faed57ef5ba5dc3cd4aae7c98787f5f5cd683`.

## Preflight

- Project identity, production database version and full migration history match the audit. Prior latest migration: `20261028153536_notification_sound_preference`.
- Exact matches: 91 audited columns; 28 policies; 32 triggers; 43 public and 22 private function definitions/ACLs; 18 constraints; 28 indexes.
- 120 existing posts and zero plain-repost counter discrepancies.
- `origin/main` was still `1e23f93a0f83d29d0725ab42448147d9960a82e0`.
- Reviewed SQL SHA-256: `d2c5ca1b28f89b2ab3ae5411be18f89f468d1eb3630ee80d14ca750ac86f0452`.
- No staging project was queried or modified.

## Applied migration and verification

Applied **only** `quote_reposts` using Supabase's single-migration tool. Production migration-history version: **`20261029131137`**. No bulk migration push was run. The matching checked-in migration file is a byte-for-byte copy of the approved SQL.

`verify.REVIEW.sql` and explicit catalog checks passed:

- `quoted_post_id uuid` nullable and `is_quote boolean NOT NULL DEFAULT false` exist.
- Self-reference FK uses `ON DELETE SET NULL`; shape constraint and partial reference index exist.
- All original policies and triggers are unchanged. Exactly one restrictive quote INSERT policy and six quote/counter triggers were added.
- Creation, projection and batch-reference RPCs run as INVOKER where intended; private helper execution is denied to anon/authenticated. All new function search paths are fixed.
- `create_quote_post` is denied to anon and granted to authenticated. The private rollout table is neither readable nor writable by authenticated users.
- Existing plain repost RPC parameter/result contracts and ACLs are preserved.
- Posts RLS remains enabled. All 120 existing posts remain; quote rows: 0; counter discrepancies: 0.
- Server state: `schemaVersion=1`, `readEnabled=true`, **`publishingEnabled=false`**.

## Deployment and activation

Compatible code deployment is pending. The checked-in client flag is **false**. The server gate is **false**. No production quote has been published and no existing user data has been deleted.

The next required checks are Cloudflare deployment/assets/feed health and authenticated production normal-post/instant-repost smoke tests. The current tool session does not expose an interactive authenticated browser; a test session or user-run smoke-test confirmation is needed for those authenticated checks. Activation remains blocked until the user's prescribed checks pass.
