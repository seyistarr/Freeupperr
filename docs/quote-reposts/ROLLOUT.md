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

Compatible application and matching migration-history file pushed to `origin/main` in commit **`7f0d2fdd0c421cdb92c3212491acc7c848217901`** (including prepared implementation `d40faed`). GitHub Actions [run 40880487427](https://github.com/seyistarr/Freeupperr/actions/runs/40880487427) completed successfully, including the full test suite, both dry-run bundles, local workerd checks and production deployment.

Cloudflare deployment: **`80daeab0-1f45-4651-9cd2-0ad7c3715d35`**, Worker version **`c6b66d71-e8bd-44e6-bd37-c1a2e238df2d`**, 100% traffic. Eight live assets match committed SHA-256 content: index, create, profile, For You, PostsAPI, video, Explore and video renderer. Site health, API gateway health, anonymous feed/profile join, capability RPC, empty quote-reference batch and unavailable-original RPC probes passed.

Client flag: **false**. Server publication gate: **false**. No production quote has been published by this rollout and no existing user data has been deleted.

The user reported production manual tests with @archangelstr (original owner) and @aliyaanae (repost/undo): ordinary repost, undo, opening the quote composer, loading the original preview, and preserving the original all passed. These results are accepted for those specific behaviors. They do not establish normal post creation, authenticated quote publication, independent quote engagements, or complete Home/For You/Profile/video smoke coverage.

Recheck: production project ACTIVE_HEALTHY; latest migration remains 20261029131137_quote_reposts; quote columns, FK/shape constraints and INVOKER RPC permission contracts match expectations. Server read gate true, publishing gate false; zero quote rows and zero canonical counter discrepancies. Live gateway, anonymous feed/profile join and quote-read RPC probes passed. The focused quote suite was rerun: 25 passed, zero failed/skipped, including production-shaped anonymous/unrelated/follower/mutual/owner authorization, private-account revocation, normal creation, duplicate guards and video/Explore regression checks. These are automated fixture tests, not live authenticated production tests.

Normal Public post creation in production remains an unreported prerequisite. This session has no authenticated controllable test browser. Both publication gates remain off pending the missing production smoke evidence; no existing user data was changed.

Quote creation, independent engagements, privacy/deletion transitions and quote-counter end-to-end production tests remain pending until activation is safe. Synthetic database/browser/concurrency test results are in `RESULTS.md` and are not represented as production end-to-end results.

## Final activation preparation

The user confirmed all prerequisite production smoke tests on 7f0d2fd: normal Public creation, Home, For You, Profile, video playback and existing video reposts, ordinary repost/undo and quote preview. Accepted as manual evidence for precisely those behaviors. Final activation authorized.

Pre-activation checks: origin/main and eight live asset hashes match 7f0d2fd; migration remains current; publishing false/read true; zero counter drift; 27 relevant policies and all 38 triggers match the verified post-migration catalog; 65 audited function definitions/ACLs and all 12 reviewed migration function bodies match.

Correction to the earlier Cloudflare record: the final successful deployment for GitHub run 40880487427 is a4a98434-17e8-4868-acec-03932003ac74, version 9245fe25-c9dd-4001-83ef-4af3c9fc401a, as confirmed by its deploy-production job log and Cloudflare API. The earlier recorded version was superseded by that same approved commit's completed deployment; no asset drift was found.

Client gate is being deployed true while server publishing stays false. Production authenticated quote/engagement/deletion UI tests remain pending: the browser connector reports not connected. No privileged impersonation or fabricated authenticated tests will be used.
