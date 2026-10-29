# Quote repost Phase 2 — review package

Status: the user approved rollout on 2026-10-29. Production migration `20261029131137_quote_reposts` is applied and verified. Final client/server activation is in progress. See [`ROLLOUT.md`](ROLLOUT.md) for the current deployment, verification and activation state. No staging project was used.

## Audited production architecture

Read-only audit on 2026-10-29 of **FreeUpper / `jmjtqidirpmnegzvmiaq`**, the project fixed in the Cloudflare API gateway. The staging project was listed for identification only; it was never queried or modified. The local repo contains only part of the production migration history, so the live catalog, rather than the earlier suggested SQL, is the baseline.

- `public.posts` has a generated UUID primary key and the existing author FK `posts_user_id_fkey`. It has separate `like_count`, `comment_count`, `repost_count`, `share_count`, `bookmark_count`, `views`, timestamps, visibility, hidden/deleted flags, `publishing_state`, `media_plan`, `publish_payload`, and draft/cleanup metadata. Legacy plural counter columns also exist; the current PostsAPI uses the singular counters. There is no quote column or relationship in production.
- `public.reposts` is separate, with UUID ID, non-null post/user IDs, optional comment, creation time, post FK `ON DELETE CASCADE`, author FK, and two existing unique constraints on the post/user pair. Authenticated callers have SELECT, not direct INSERT/DELETE grants. Existing plain repost mutations use SECURITY DEFINER RPCs.
- **Both** deployed `toggle_repost(uuid,text)` and `toggle_repost(uuid,uuid,text)` increment/decrement `posts.repost_count` themselves. The only repost row triggers are the note word-limit and notification triggers. There is no existing repost counter trigger. Audit: **120 posts, zero discrepancies** between `repost_count` and plain repost row counts.
- `delete_post` marks deleted/hidden; `restore_post` goes through the Privacy V2 retirement trigger and the seven-day deletion registry. `permanently_delete_post` deletes ordinary rows, while the existing retirement guard converts protected-origin deletion into retirement/cleanup. None of those functions or privacy triggers is replaced by this patch.
- Post SELECT has a permissive baseline plus restrictive anonymous/public, authenticated audience, verification lifetime, permanent retirement, and hide-all boundaries. Owners can read recoverable hidden/deleted rows. A Public post from a private account is readable only by its owner/approved followers, not automatically by everyone. Followers and Mutuals use the existing approved-edge helpers. Existing owner INSERT/UPDATE policies remain intact.
- Relevant existing private registries: `protected_post_origins`, `post_deletions`, `verification_posts`, and `follow_approvals`. Active block authorization uses `public.blocks`; both directions must be considered. Profile privacy, suspension and hide-all flags affect eligibility.
- The Cloudflare gateway forwards normal user JWTs to the fixed production project, rejects privileged credentials/private schema selection, already accepts the new public RPC paths, and sets `private, no-store` with Authorization variation. **No gateway change is necessary.** No service-role credential is added to a browser or the gateway.

Relevant audited function bodies, ACLs, policies, triggers and constraints are retained in `tests/fixtures/quote-production-catalog.json`. Synthetic test setup uses their relevant definitions verbatim; it contains no production users or posts.

## Proposed migration

[`20261029090320_quote_reposts.REVIEW.sql`](20261029090320_quote_reposts.REVIEW.sql) was generated with Supabase CLI 2.122.0 and is deliberately held **outside `supabase/migrations`** until approval.

The migration is transactional and repeatable. It checks the audited source hashes of both old repost RPCs and rejects unreviewed repost triggers. A five-second lock timeout and 60-second statement timeout abort rather than leave a partial handover. The counter handover briefly locks posts/reposts against concurrent writes; reads remain available.

It adds:

- `posts.quoted_post_id uuid`, FK **`posts_quoted_post_id_fkey`**, `ON DELETE SET NULL`, and a partial reference index.
- `posts.is_quote boolean NOT NULL DEFAULT false`. This is the only extra marker: after hard deletion sets the FK to null, a quote must still display an unavailable card rather than look like an ordinary post. There is **no duplicated original text, author, media, or snapshot**.
- A private rollout singleton with `publishing_enabled=false` and bounded versioned capability metadata. Reads may be enabled without enabling publication. Reapplying the migration does not reset an explicitly reviewed rollout state.
- A guarded, idempotent `create_quote_post(uuid,uuid,jsonb)` RPC. It inserts a real post using SECURITY INVOKER, preserving existing INSERT RLS and Privacy V2 triggers. A client-generated **post ID** is the retry key, so no extra idempotency column is needed. An existing different owner's ID, mismatched target, or deleted retry is rejected. The server controls author, reference, public visibility, published state, and initial counters.
- `get_quotable_post` and `load_quote_references` return only a safe, one-level projection. The batch wrapper is SECURITY INVOKER and first reads outer posts through existing RLS. The original projection is also SECURITY INVOKER, so current and future original-post SELECT policies still apply. A narrow boolean-only SECURITY DEFINER wrapper checks the private suspension/protected-origin registries; it returns no content. Public wrapper grants are explicit; private helper/trigger execution is revoked from PUBLIC/anon/authenticated. No profile contact fields, publish payload, nested references or protected registry content are returned.

No existing RLS policies are dropped, overwritten, or widened. One new restrictive INSERT policy applies only to quote rows and checks the original through the caller’s existing SELECT RLS, including direct REST writes. Quote write validation covers direct REST inserts as well as RPC creation. Quote marker, author and reference are immutable, except for the FK's legitimate hard-deletion nulling.

## Authorization and privacy

For this initial rollout an original must be *globally public*: Public audience, published, not hidden/deleted, with a public, unsuspended author whose hide-all flag is false. It must have no protected origin, verification-post registration, or deletion record. Both directions of a block between the viewer/publisher and original author are checked. **Even an approved follower or owner cannot quote a Public post belonging to a private account** in this initial rollout. Their normal private-account reading permissions remain unchanged.

Creation locks and rechecks the target at publishing time; a stale composer preview is not authority. The author must be authenticated, non-anonymous and unsuspended. Only public image/video URLs are accepted as quote media; registry-backed/protected references are rejected. The quote's own text/media and existing engagement rows remain associated with its own ID, not the original.

Every embedded read checks the current original state and viewer's block relationships again. Changing original visibility/account privacy, hiding, suspension, deletion or blocking therefore returns an unavailable original on subsequent requests. Existing quotes retain their own authored text and engagement. Already downloaded content cannot be retroactively erased from a viewer's device; the server stores no quote snapshot that can bypass a later authorization decision.

## Counter ownership and concurrency

The single stored count becomes:

`plain repost rows + distinct eligible live quote post rows referencing this post`

Plain rows keep the existing semantics. A quote contributes when both it and its original are globally public and its author is not blocked by the original author (in either direction). A plain repost and a separate quote by the same person are two distinct actions; the same quote/request ID is counted once.

One mechanism owns reconciliation: row triggers on plain reposts and the relevant quote lifecycle fields call the same locked aggregate helper. Profile privacy/moderation and block changes also refresh affected totals. The two plain RPCs retain their parameter/result contracts, note support and toggle behavior, acquire the target lock, and stop doing separate arithmetic. A canonical count trigger also prevents client-provided values or an in-flight cached legacy RPC body from double-adjusting the count during the handover.

Delete, restore, hard delete, hidden/published changes, public/private authors, repeated calls, direct privileged row operations, and concurrent operations are covered. Row updates unrelated to eligibility (likes, views, playback) do not fire the eligibility reconciliation trigger. Counter writes do not recursively fire it. Standard PostgreSQL deadlock/serialization failures roll back atomically; quote creation retries a bounded number of times with the same post ID.

## Client and page integration

- `posts.js`: normal selectors remain unchanged (`*` with the existing author join). **No query references a nonexistent quote column.** Extra quote reads are opt-in via `data-fu-quotes` and only hydrate actual quote rows. Batches are capped at 100 and do not recursively expand quotes. Missing RPCs or unavailable originals preserve the authored outer post with an unavailable embed. Normal insert payloads and plain repost/media/view methods retain their previous contracts.
- `create.html`: uses the server-approved preview; prepares quote-only/text/media submission with the stable request ID, duplicate-submit lock, error feedback and navigation to the **new post's URL**. Normal post submission and restricted publishing retain their existing paths. Removing a quote preserves typed text and unrelated URL parameters.
- `index.html` and `profile.html`: opt into hydration and recognize the hard-deleted-reference marker. Phase 1 menu and quote-card layouts remain in place. `foryou.js` already renders the Phase 1 quote card and its independent outer engagement row; it requires no additional edit.
- **`video.html` and `explore.js` are byte-for-byte unchanged.** Their file hashes and legacy repost/media/view contracts are regression-tested. The video page does not opt into quote hydration. Explore keeps its existing rendering and interaction handlers; shared Home data may contain additive quote properties that it ignores.
- The reviewed `QUOTE_PUBLISHING_REVIEWED` client constant and independent server gate must both permit publication. The proposed migration separately defaults server publication to false.

## Verification and tests

The local tests use synthetic data, not staging or production:

- `tests/quote-reposts-database.test.js`: migration/reapplication/rollback; exact relevant production policies/functions/ACLs; anonymous, unrelated, follower, mutual and owner authorization; private accounts; original/quote identity and independent counters; quote-only and image/text creation; malformed/protected/unauthorized requests; stable retry IDs; both plain repost contracts; direct table-write privileges; counter forgery; delete/restore; hidden/publication/profile/block transitions; outer-post RLS; hard-deletion tombstones; disabled rollback.
- `tests/quote-reposts-client.test.js`: pre-migration feed/normal-post compatibility; closed client release gate; bounded hydration; normalized media; unavailable/protected/deleted originals; outer engagement IDs/counters; retry IDs; video/Explore file hashes and unchanged plain repost/media/view functions.
- `tests/quote-reposts-browser.test.js`: real Chromium using the actual composer markup and submit functions with simulated local backend responses. Covers gated/unavailable targets, quote-only, comment/media, duplicate calls, errors/retry, Public-only selection, new-post navigation, and removing a quote before normal publishing. Its simulated enabled state does **not** alter either checked-in production gate.
- `tests/quote-reposts-gateway.test.js`: new RPC routing preserves JWT identity, fixed upstream and no-store response behavior without gateway edits.
- `scripts/test-quote-concurrency.mjs`: real **PostgreSQL 17** local cluster, parallel quote creation, simultaneous identical-ID retries, both plain repost RPCs, delete/restore, repeated concurrent toggles and original-deletion race. Passed. It accepts no remote DB URL and shuts down/removes its synthetic cluster.

Reproduce the optional concurrency test without modifying repo dependencies:

```sh
npm install --prefix /tmp/freeupper-quote-pg --no-audit --no-fund embedded-postgres@17.10.0-beta.17 pg@8.16.3
FREEUPPER_QUOTE_PG_MODULE_ROOT=/tmp/freeupper-quote-pg node scripts/test-quote-concurrency.mjs
```

The synthetic fixture models `image_embedding` as text and stubs unrelated profile-tab lookup; production pgvector operations and unrelated notifications are not emulated by this fixture. A separate read-only production probe verified that the typed JSON-record conversion accepts the existing `vector(1024)` embedding format. Existing repository tests cover the wider Privacy V2 and media paths. Production vector schema and all unrelated functions remain unchanged.

Final suite/build results are recorded in `RESULTS.md`.

## Rollback and approval sequence

1. Review this package and the exact migration. Repeat [`preflight.REVIEW.sql`](preflight.REVIEW.sql) immediately before applying; stop on schema/function/policy drift.
2. **User approval is required before executing any production DDL.** Apply only the approved migration to `jmjtqidirpmnegzvmiaq`, with publication still disabled. Do not run a bulk `db push` against the partial repository migration history.
3. Run [`verify.REVIEW.sql`](verify.REVIEW.sql): schema/FK/index, unchanged existing post policies plus the new quote-only INSERT restriction, zero counter drift, explicit ACLs and publishing still false. Capture the actual migration-history version and check in the matching applied migration only after verification.
4. Commit/push compatible code to `main`, let the existing GitHub Actions workflow deploy it, and verify production assets/health with publication still disabled. No API-gateway deployment is required.
5. Only after rollout approval and those checks, deploy the reviewed client release flag while the server gate is still closed, then enable the server publishing gate as the final release action. Run controlled authorized end-to-end smoke tests for A/B identity, all engagement rows, deletion/restore and privacy transitions. These production tests have **not** been run while the gate is closed.

Before any quote exists, [`rollback.REVIEW.sql`](rollback.REVIEW.sql) fully reverses the migration, restores both audited old RPC bodies, and recalculates the old plain-only counts. It refuses to run if authored quote rows exist. It never deletes posts or user data.

After quotes exist, use [`disable.REVIEW.sql`](disable.REVIEW.sql) to stop publication **and** embedded reads, deploy the disabled client, and retain references/markers/counter maintenance. Dropping the schema after quotes exist requires a separately reviewed archival plan; deleting authors' quotes is not an acceptable rollback.

## Outstanding risks and readiness

- **Migration applied and verified; prerequisite production smoke tests accepted.** Final activation and quote end-to-end verification are recorded separately. See `ROLLOUT.md`.
- The active live schema contains migrations absent from this repo. Re-audit drift before DDL; the migration checks both counter-RPC hashes and existing repost triggers, and no existing policies are overwritten.
- Profile privacy/block changes reconcile all referenced roots in this initial implementation. The current dataset is small; profile/block-heavy workloads should be measured before a large rollout. Post reference and plain-row lookups are indexed.
- Multi-row deletion/privacy changes can contend with quote creation; PostgreSQL rolls deadlocks/serialization errors back, and quote creation retries with the same ID. A surfaced retry exhaustion is an error, not a partially published quote.
- Existing plain repost RPCs keep their legacy target-authorization behavior to preserve the independent video experience. Quote publication and quote projections enforce the stricter new checks. Broad engagement-RPC authorization hardening would be a separate review.
- The read-only Supabase advisor reports pre-existing mutable search paths, broad executable legacy definers, public extensions, and disabled leaked-password protection. This change does not automatically modify those unrelated settings. Remediation references: [function search paths](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable), [definer grants](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
