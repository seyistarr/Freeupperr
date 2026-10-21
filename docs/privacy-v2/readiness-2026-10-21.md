# Privacy V2 release preparation — 2026-10-21

## Protected-first live staging acceptance update

**Production remains NO-GO; PR #9 stays draft.** On October 21, the approved staging project `tagkrhvgcbnybiuyvjxt` and Cloudinary `sxdcqs5x` passed the focused API/database checks below. Evidence: [phase results, failures and retests](evidence/protected-first-acceptance-2026-10-21.json) and [unsigned direct-URL checks](evidence/protected-first-direct-urls-2026-10-21.json). These supersede older statements below that the protected-first staging migration was unexecuted. No production resources were modified.

Applied after verifying the exact project, seven prerequisite function bodies, indexes, grants and RLS:

- `20261021110111 privacy_v2_protected_first`
- `20261021121638 privacy_v2_live_session_boundary`
- `20261021121653 privacy_v2_upload_reservation_retry`
- `20261021121942 privacy_v2_anonymous_public_read`

The latter three address confirmed live failures: a logged-out JWT could still query protected rows directly; repeating a signature request failed rather than returning its reservation; anonymous Public staging reads lacked schema usage. The session function returns only a current-user/current-session existence bit, has no caller-supplied identities, pins an empty search path, and is not executable by anon. The upload retry uses the original ID **and original timestamp**, preserving the 65-minute cleanup replay boundary. Public schema access was granted only after checking that anon could read only RLS-protected posts/profiles/follows and had no mutations or non-trigger RPC execution.

| Actual live check | Result |
|---|---|
| Synthetic Followers image, Mutuals video + protected poster, Only Me image | Passed authenticated signing/upload/registration/publication; owner mismatch denied; video blocked until poster ready; no public references stored |
| Owner, approved follower, reciprocal follower, pending follower, stranger, guest | All 18 audience cases passed; authorized media bodies matched synthetic bytes; denied media returned 404; guest metadata returned 401 |
| Feed/profile/search filters and viewer-JWT invoker reader RPC; direct PostgREST RLS | Passed audience restrictions after the fixes; anon direct SQL also returned zero restricted/hidden rows and one Public control |
| Follow approval, withdrawal and loss/restoration of reciprocity | Passed metadata/media/direct-RLS checks using unchanged JWTs |
| Ten unsigned Cloudinary image/video/poster paths | Authenticated paths 401; corresponding public paths 404 |
| API/Auth logout + direct database access with old JWT | Initially failed direct RLS; passed after fix: media 404, metadata 401, direct rows zero |
| Lost signature, upload and registration responses; incomplete publication; foreign cancellation; cancellation retry | Passed; one registry row retained across registration retry; failed draft media inaccessible; final cleanup still pending replay expiry |
| Active formats / unsupported combinations | Real authenticated SVG upload rejected by registration/publication, then cancelled; text-only/music/overlays rejected |
| Public compatibility control | Staging public Cloudinary upload, Public row insertion and anonymous read passed; conversion through new-post visibility endpoint denied. Public Create/Studio UI was not run |
| Browser Create/Studio/playback, account switching, object URL cleanup, SW v11 upgrade/cache behavior | **NOT RUN** |

The five fresh accounts used the fixed server marker `privacy-v2-protected-first-20261021` and synthetic roles only. All five were retired after acceptance and their Auth sessions revoked (remaining sessions: zero). No tokens/passwords/Cloudinary credentials were returned. Published synthetic fixtures and the synthetic Public control are retained. Two failed-draft cleanup intents remain pending until their original replay windows end at **13:20:07 UTC** and **13:27:51 UTC on October 21**; the first normal five-minute cleanup sweep eligible for both is **13:30 UTC**. Verify pending=false and Cloudinary absence afterward; that final sweep has not been observed. A lost *create* response was not simulated; known-draft status recovery is the check actually performed.

The temporary `FREEUPPER_STAGING_ACCEPTANCE=protected-first-synthetic-only` mode rejects every legacy phase. It was disabled after acceptance; the final feature preview must reflect that disabled setting. Existing legacy deletion clocks and zero-observation counts were confirmed unchanged. No legacy deletion/consent migration was applied, no legacy invalidation/deletion was requested, and no qualifying revocation check ran. November 20 21:04:08 UTC and the second-runner one-hour interval remain intact.

Browser setup: the Opera connector's `list_tabs` returned **Browser not connected**. Enable **Allow AI connection**, sign into the Opera connector, and expose an authorized controllable staging tab (the currently exposed Opera tools only navigate/read). Alternatively run `/privacy-v2-acceptance.html` manually on the feature preview using two fresh staging accounts with server-controlled `app_metadata.privacy_v2_browser_acceptance=true`, entering passwords directly in the page. Retired API fixtures are not browser accounts. For a real upgrade result, start with an actually active older worker; an old cache name or a fresh v11 installation is insufficient. Retain the harness output. Do not count any API results here as browser acceptance.

Focused validation only: six acceptance-harness checks and eleven upload-signature checks passed; `npm ci --ignore-scripts` now succeeds after reconciling the inconsistent existing lockfile. Production review SQL was regenerated with the retry transition; `live-session-production-REVIEW.sql` is an additional review-only prerequisite after the protected-first package and before any activation. None was executed.

Remaining new-post release blockers: actual browser acceptance, the deferred cleanup verification, review of production migrations/approved-follow consent and RPC consumers, isolated recovery/external monitoring exercises, and explicit production approval. Legacy ownership evidence, AWS independent runners and the full November revocation wait continue to block **legacy conversion separately**. Reposts/engagement were not newly accepted; the isolated reader excludes reposts. No production release readiness is claimed.

## Earlier preparation snapshot

Follow-up: [current blocker resolution and exact setup](blockers-2026-10-21.md). It records newer nine-URL diagnostics, harness/logout fixes, review-only production findings and runner/recovery configuration; the results below remain the earlier historical snapshot.

**Decision: NO-GO for production. PR #9 stays draft.** Production databases, Cloudinary assets, settings and live deployment were not modified. Review SQL was exercised only in a disposable local PostgreSQL model.

## Implemented and checked

- Owner conversion panel in Create/Studio, authenticated owner-only status/consent RPC, unchanged-source snapshot binding, explicit audience, second acknowledgement after every copy registers. Database trigger blocks preparation/quarantine without current consent. Quarantine cannot be cancelled or silently restored Public; the UI states the waiting period and downloaded-copy limitation.
- Session generations prevent cancelled/overlapping logins from restoring the previous identity; failed account replacement clears media immediately. Composer logout disables restricted choices. Focused session tests pass.
- Service worker v9 activates after successful static precache, claims clients, deletes old caches, and reads only its own cache. API/auth/media/shared/staging requests still bypass CacheStorage; safe static offline checks pass. **Actual browser upgrade remains unverified.**
- Review-only production expansion adds a default-published state without changing existing visibility; disabled production audience trigger, private consent ledger, invoker search/view, restrictive draft/child-post policies. Audience RLS review now composes with restrictive policies; edit RPC review has empty search path and authenticated-only execution. Local model verifies Public preservation, private/draft search and repost exclusion, and disabled private writes.

## Actual live staging results

Only project `tagkrhvgcbnybiuyvjxt` was changed. Applied migrations: `privacy_v2_owner_consent`, `privacy_v2_independent_revocation`, `privacy_v2_recovery_exercise`. New tables are private to server roles; events and accepted receipts are append-only.

Synthetic backup/restore exercise `4df727fe-4cac-412c-ab73-95c3fedfcee7` restored two synthetic post snapshots into **`privacy_test.recovery_exercises.restored`**, with exact equality. It did not overwrite posts, Auth, Cloudinary, or production. This tests snapshot recovery plumbing, **not** a full Supabase backup/PITR disaster recovery.

Live monitoring: pending legacy **2**; failed jobs **0**; cleanup retries **0**; expired drafts **0**; due unverified **0**; safety violations **0**. Browser consent-read and receipt-write privileges are false; service-role event UPDATE privilege is false. The monitoring CLI exits 2 for actionable counts; a local synthetic expired-draft alarm was exercised. External alert delivery is not configured/tested.

Live negative checks also rejected another synthetic user reading the owner status and rejected premature/incomplete receipt ingestion. Owner status reports the fixed November 20 deadline. Existing staging advisor warnings (public pg_net, public `rls_auto_enable` grants, disabled leaked-password protection) remain; private RLS tables intentionally have no browser policies. No clean-advisor claim is made.

Both earlier synthetic legacy jobs remain `revoking`, with **zero observations** and `verified_at = NULL`. Original deletion clocks are unchanged: image `2026-10-20 21:03:50.215514 UTC`, video `2026-10-20 21:04:07.075603 UTC`.

## Browser acceptance status

**NOT RUN: no connected Browser/js/CUA tools are available in this session.** No new browser accounts or assets were created. Earlier API acceptance is not counted as browser evidence.

`/privacy-v2-acceptance.html` implements an actual-browser exercise against Create, Studio, index/video/profile readers, authenticated image/video/poster loading and muted video playback, account replacement, object URL revocation, logout and service-worker caches. It publishes one synthetic Only Me image and one synthetic Only Me video. Its two synthetic account credentials remain in memory and are cleared from fields; only accounts ending `@privacy-staging.invalid` with **server-controlled** `app_metadata.privacy_v2_browser_acceptance = true` are accepted. Provision two fresh authorized synthetic accounts in staging before running. Existing retired API acceptance accounts are not reopened.

Open the page on the exact branch preview. An SW upgrade is recorded only when an older cache actually existed before activation; a fresh install is not reported as an upgrade. Retain the real browser output and verify a second pass with an older active worker before release. The harness and new UI are implemented, **not live browser-verified**.

## Independent revocation runners

Prepared `.github/workflows/privacy-v2-revocation.yml`: separate Ubuntu/Linux and Windows jobs, separate protected GitHub environments, distinct AWS accounts/roles and COMPLIANCE-locked, versioned S3 buckets. GitHub artifacts are supplemental; immutable evidence requires S3 success. Neither runner calls the migration API or submits qualifying observations.

Required setup (not provisioned in this session):

1. Create GitHub environments `privacy-v2-revocation-first` and `privacy-v2-revocation-second`, allow only the feature branch, and require approval of the reviewed workflow commit. AWS OIDC role subjects must be exactly `repo:seyistarr/Freeupperr:environment:privacy-v2-revocation-first` / `...-second`, with audience `sts.amazonaws.com`.
2. In separate AWS accounts, create private versioned buckets named `freeupper-staging-revocation-*`, Object Lock enabled and default **COMPLIANCE 90 days**; block public access. Writer roles may write only their own `privacy-v2/first.json` or `second.json` and failure prefix, with retention permissions, no delete/version-delete, retention shortening or bucket-policy changes. Second role may read first bucket's first receipt/version only. Operator verifier may read both buckets and retention metadata. Require AWS CLI with conditional `put-object --if-none-match` support on each runner.
3. Environment variables in both GitHub environments: `REVOCATION_FIRST_ACCOUNT`, `REVOCATION_SECOND_ACCOUNT` (different 12-digit IDs), own `REVOCATION_EVIDENCE_BUCKET`, own `REVOCATION_ROLE_ARN`, own `REVOCATION_REGION`; second additionally `REVOCATION_FIRST_BUCKET`. These are settings, not Cloudinary/Supabase keys. Do not provide production credentials or service-role keys to either runner.
4. After workflow registration, dispatch `gh workflow run privacy-v2-revocation.yml --ref feature/post-privacy-v2-integration -f runner=first`, then second after one hour. If branch-only `workflow_dispatch` is unavailable, an explicit feature-branch push changing `.github/revocation/request.json` starts both independent jobs; second fails closed until first immutable receipt is old enough. No main merge is needed. No request file is created by this change, so no evidence run is triggered now.
5. Operator verifier settings: the existing exact staging-only secret-manager environment, both `REVOCATION_FIRST_ACCOUNT`/`SECOND_ACCOUNT`, both `REVOCATION_FIRST_BUCKET`/`SECOND_BUCKET`, read-only AWS credentials, and `REVOCATION_APPROVED_SHA` identifying the reviewed workflow/code commit. Run `node scripts/privacy-v2/ingest-revocation.mjs` for dry-run verification. Only add `--apply` after reviewing the immutable receipts. The verifier checks account ownership, version IDs, COMPLIANCE retention, content hashes, reviewed code/context, matching URL manifest, complete failed-URL probes, actual Cloudinary origin absence, and fresh exact-URL checks before service-only database ingestion.

**No first qualifying check before November 20, 2026, 21:04:08 UTC.** Later actual source deletions extend this date. Second check must be at least one hour after first, also measured between immutable S3 storage timestamps. Earliest possible second is **22:04:08 UTC**, potentially later because the first evidence object is stored after its probes. Server time, source clocks and freshness are checked again at ingestion. Location-label-only observations are rejected. Accepted receipt content cannot be rewritten; exact ingestion retry is idempotent and does not refresh the verification time. Origin/CDN regressions block finalization. Runners/ingestion are implemented and locally checked; **cross-account infrastructure and live immutable receipts are not verified**.

## HTTP 200 investigation

Diagnostic exact GETs at **2026-10-20 21:57:55–58 UTC**, without cache busting, Range, authorization or redirect following:

- Image: both versioned and previously-200 unversioned URLs returned **404** from this executor.
- Video: versioned and both poster variants **404**; unversioned MP4 **200**, 1,677 bytes. SHA-256 `307ceff68e8e3f775665e4fbebf00c8bb91f986c046c9cd080bcd915e61c4bbd` matches the synthetic video. Headers advertised `public, no-transform, max-age=2592000` (30 days) and `cld-cloudflare ... desc=hit`, with `Last-Modified: Tue, 20 Oct 2026 21:02:35 GMT`.

Full sanitized response metadata is in `evidence/cdn-diagnostic-2026-10-20.json`. This demonstrates differing results for exact cache keys/paths after earlier origin deletion. The executor uses an intermediary; these observations cannot identify the responsible cache layer definitively or establish global CDN purge. No additional deletion, purge, recreation or setting change was performed. The image's newer 404 does not erase the earlier 200. The unversioned video's 200 remains unresolved; verify Cloudinary account invalidation coverage for slash-containing/versioned public IDs and all paths through independent runners after the full wait. These diagnostics **never count** as revocation observations.

## Remaining blockers

| Blocker | Class | Next action |
|---|---|---|
| Browser Create/Studio/media/logout/upgrade acceptance | Staging configuration + live verification | Connect a browser, provision two synthetic browser accounts, run the harness and actual old-worker upgrade |
| Independent AWS/GitHub environments and locked evidence | Staging configuration | Provision restricted roles/buckets/environments; validate object immutability and cross-account reads |
| Required waiting time and unresolved cached MP4 | Elapsed time + staging/provider investigation | Preserve clocks, run first/second no earlier than the dates above; any 200 blocks ingestion |
| Historical real-user source ownership | Evidence + explicit production approval | Review independent upload records; synthetic receipts do not prove historical ownership |
| Production RPC/view/SEO/quote/engagement coverage | Code/security review | Complete exact production catalog audit and replacements; generic RLS does not constrain SECURITY DEFINER/service-role readers or copied quote snapshots |
| Full backup/PITR, alert delivery and rollout/rollback drills | Staging configuration + live verification | Run isolated full staging recovery and external alert exercises; never restore over production |
| Production activation | Explicit production approval + code | Review expansion → audience RLS → invoker consumers → consent/revocation/publishing equivalents; complete protected registry/reference guards before replacing the disabled production trigger. Keep browser public-only guard until then |

Disabling flags is the rollback; quarantined/revoked posts stay hidden and recover forward. Never restore public Cloudinary originals or roll back to permissive read policies. Existing Public posts stay Public unless their authenticated owner explicitly requests and completes conversion. Text-only posts, music, overlays, unreviewed quote/repost dependencies and unsupported legacy sources remain excluded from restricted publishing.
