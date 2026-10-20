# Legacy media: staging workflow and production gates

This change is **not production activation**. The runner rejects every cloud/project/branch except Cloudinary `sxdcqs5x`, Supabase `tagkrhvgcbnybiuyvjxt`, and the feature preview branch. No production asset migration, invalidation, deletion, database migration or deployment was executed. Existing Public posts stay Public unless their authenticated owner explicitly requests a migration. A failed request never becomes Public as a fallback.

## Reference inventory

| Location | References and treatment |
| --- | --- |
| `posts` | `media_url`, `thumbnail_url`, `media[].url`, string media entries, `thumbnailUrl`/`thumbnail_url`, `public_id`; inspect the complete row, not only these columns. Secondary aliases become migration entries too. Unknown URL/reference fields block the plan. |
| Create | Cloudinary image/video uploads; generated `/video/upload/so_auto,w_800,h_800,c_fill/...jpg` posters; external links and YouTube posters. External sources remain unsupported for restriction. |
| Studio | Transformed final URLs, raw video, JPEG posters, audio extraction, `sound_id`, `text_template_id`, uploaded PNG text layers, `l_audio`/overlay transformations. Composite dependencies and text-only posts remain blocked. |
| `sounds` | `audio_url`, `art_url`, `source_post_id`, `created_by`; original audio can expose the source video even if its post has no attached sound. Shared sounds prevent migration/revocation. |
| Feeds/search/profiles | Canonical post rows plus repost-feed views, similarity/search RPCs, quote/repost snapshots. Staging uses the audience-filtered invoker reader; engagement/repost operations stay disabled. Shared references or copied snapshots block legacy migration. |
| Link previews | Public short-link/text-OG RPCs and profile SEO must remain strictly Public-only. The production short-link review SQL explicitly filters visibility/private authors; production views/definer RPCs still need separate authorization before rollout. Staging links retain `privacy_staging=1` and expose no restricted crawler metadata. |
| Downloads/caches | Registered media must still belong to the post's current media references. API delivery remains authenticated and no-store. Worker v8 bypasses media, downloads, shared-link routes and staging navigations; old caches are removed at activation. Safe static shell/modules still work offline. |

The isolated staging schema has no production-shaped top-level URL columns or sounds/repost views today. Inventory is recursive over actual rows, with optional top-level URL columns scrubbed transactionally when present in a fuller staging clone. The migration adds no production columns. Staging shared-reference checks also inspect other application tables and materialized snapshots. The service role receives read-only inventory rights on the other three isolated fixture schemas; browser/mutation grants are unchanged. Inability to complete a dependency inventory blocks the operation. Production's actual schema/privileged RPC inventory must be captured again before approval; review files are not proof of its current deployed state.

## Run on staging only

`staging-migrations/privacy-v2-legacy-media.sql` follows protected-publishing and readers-cleanup. It and the follow-up `privacy-v2-legacy-dependency-scope.sql` correction have been applied only to `tagkrhvgcbnybiuyvjxt`. It creates service-only provenance, jobs, source claims and audit events; RLS is enabled, browser grants are revoked, and all functions use SECURITY INVOKER with an empty search path. The lack of browser policies on these private tables is intentional deny-all.

Load server credentials from the staging secret store, never browser storage or command arguments. Use the exact branch-scoped settings in `staging-migrations/ACTIVATE.md`, plus:

- `FREEUPPER_LEGACY_MIGRATION=enabled-in-isolated-staging` in the **operator process only**; no new browser feature flag.
- `FREEUPPER_LEGACY_OWNER_TOKEN`: the actual staging post owner's short-lived JWT. `getUser()` validates it before any command; an administrator credential alone does not impersonate an owner.
- `FREEUPPER_LEGACY_PROVENANCE_FILE`: a private reviewed JSON record with `asset_id`, `post_id`, `owner_id`, `public_id`, `resource_type`, `version`, `evidence_sha256`, `reviewed_by`. The evidence digest must refer to independent upload/audit records. URL possession, editable post data and unsigned-upload context do not establish ownership. Missing provenance blocks migration; never invent it to pass a gate.

Examples below contain no credentials. `$STAGING_POST_ID` identifies a staging post only. Commands are read-only unless `--apply` is present. `plan` always remains read-only; `revoke` without `--apply` only reports preparation/status.

```sh
node scripts/privacy-v2-legacy.mjs attest "$STAGING_POST_ID"
node scripts/privacy-v2-legacy.mjs attest "$STAGING_POST_ID" --apply
node scripts/privacy-v2-legacy.mjs plan "$STAGING_POST_ID"
node scripts/privacy-v2-legacy.mjs prepare "$STAGING_POST_ID" followers --apply
node scripts/privacy-v2-legacy.mjs copy "$STAGING_POST_ID" --apply
node scripts/privacy-v2-legacy.mjs quarantine "$STAGING_POST_ID" --apply
node scripts/privacy-v2-legacy.mjs revoke "$STAGING_POST_ID"       # dry-run
node scripts/privacy-v2-legacy.mjs revoke "$STAGING_POST_ID" --apply
node scripts/privacy-v2-legacy.mjs status "$STAGING_POST_ID"
```

`friends` means reciprocal approved following. `only_me` is owner-only. Do not change an existing job's requested audience implicitly.

Copies use deterministic owner-scoped authenticated IDs, `overwrite:false`, bounded image/video sizes, immutable source IDs and exact metadata checks. Each copy is registered with its owner/post. Lost upload/registration responses can be retried against the same ID/context. A lease serializes workers and every database transition rechecks the post snapshot and shared references. No reference switch occurs before all required copies, including video posters, are ready. Older videos without stored posters get a separately registered authenticated first-frame image during the copy phase; dry-run only constructs its planned URL.

Copying leaves the original Public post unchanged. **Quarantine hides the staging post while it still retains its Public visibility value.** It cannot be published or made restricted by the ordinary draft-publishing/visibility endpoint. This avoids claiming privacy while old URLs remain accessible. The owner must understand the wait before starting quarantine.

Revocation deletes the original and derivatives by immutable Cloudinary asset ID with `invalidate:true`, not an untrusted URL or mutable public ID. It rechecks absence by both immutable asset ID and upload public ID, refusing restored/replaced assets. Source IDs remain tombstoned in the private ledger; operators must prohibit restoration/reuse of these IDs, including from backups. No Cloudinary settings change is performed by this workflow.

Known derivative URLs, original URLs, top-level aliases, posters, versioned and unversioned variants are persisted before deletion. Additional derivatives detected before revocation block it until `refreshProbes "$STAGING_POST_ID" --apply` updates the inventory. After revocation begins, the probe inventory is immutable. Unknown signed/layered/ambiguous URL forms require separate provider/provenance review and remain blocked.

## Verification and recovery

Cloudinary documents that CDN copies can persist for [up to 30 days](https://cloudinary.com/documentation/invalidate_cached_media_assets_on_the_cdn), and signed URLs have separate invalidation behavior. Changing references or receiving a deletion acknowledgement **does not verify revocation**.

The gate waits 31 days after the last source deletion is confirmed (including any repeated deletion after restoration). Then execute `observe` from two independently operated network runners, setting `FREEUPPER_REVOCATION_VANTAGE` to their actual distinct runner/region IDs. Observations must be at least one hour apart. These labels are operator audit attestations, not network-location proofs; do not run twice locally with invented labels.

```sh
node scripts/privacy-v2-legacy.mjs observe "$STAGING_POST_ID" --apply
# A second real runner, a different vantage ID, at least one hour later:
node scripts/privacy-v2-legacy.mjs observe "$STAGING_POST_ID" --apply
node scripts/privacy-v2-legacy.mjs finalize "$STAGING_POST_ID" --apply
```

Every stored URL must return 404/410 using a normal GET with no cache-busting, range, bearer header or redirect following. Errors/403/redirects/200/206 are failures, not evidence of revocation. Origin absence is checked again. Finalization requires fresh two-run verification, checks every copy and old URL again, then atomically replaces references, clears legacy URL fields, and applies only the recorded owner-requested restricted audience. The database trigger independently rejects raw/external media references, unregistered/detached media, pending migrations, invalid posters and unsupported content types.

Jobs/events retain stage, identities, evidence digests, timestamps, deletions, observations and failures. Inspect private events and retry the failed phase; do not start another upload set. Before quarantine, `abandon "$STAGING_POST_ID" --apply` removes only provenance-checked authenticated copies, including unregistered orphans, and fails their registrations. It leaves the Public source/post untouched and records a terminal abandoned job. After quarantine/revocation, rollback to public URLs and copy deletion are forbidden: keep the post hidden and recover forward. An edited source snapshot requires independent recovery review; never overwrite the changed row or drop source tombstones to force completion.

Previously downloaded files, browser HTTP caches, screenshots and third-party caches cannot be retracted. This verification covers observed Cloudinary origin/CDN delivery, not possession of bytes already released publicly. The UI/rollout must disclose that limitation. Old service workers can retain data until they activate the new worker; production rollout needs a cache-upgrade acceptance gate before any restricted switch. No live legacy asset was copied/deleted or marked verified in this change.

## Production order — requires separate explicit approval

1. Keep production Public-only. Take database/asset inventories and backups, record owner consent/provenance, catalog all public URL hosts, aliases, audio/overlay dependencies, derived/backup versions, search/repost/materialized views, downloads and SECURITY DEFINER RPCs. Produce per-owner dry-run manifests with zero writes; block unsupported/shared/ambiguous entries. The current runner intentionally cannot target production.
2. Review and approve production-specific migrations in this order: private registry/global uniqueness and source claims; draft state plus immutable owner/reference guards; audience RLS and safe reader policies; invoker views and guarded search/similarity/repost/quote/short-link RPCs; private provenance/jobs/audit/cleanup permissions. Replace permissive owner ALL policies and test direct REST/RPC access. Do not run an isolated review file alone or mechanically substitute schema/cloud names in the staging SQL. A separately reviewed production implementation must enforce the same legacy gate.
3. Deploy authenticated delivery/readers with production flags **off**. Rotate/provision server-only credentials, configure trusted cleanup/monitoring, and ship the cache-bypass/upgrade first. Confirm every owner/follower/mutual/pending/stranger/anonymous path and stale-session behavior across feed/search/profile/previews/downloads; verify current-reference membership and no public fallback. Keep text/music/overlays/external embeds disabled for restriction.
4. Copy a small approved cohort to authenticated production assets without altering/deleting Public originals. Register all copies and verify ownership/content/playback/posters. Quarantine only with owner consent. Freeze mutation/shared references, then prepare a second dry-run deletion manifest by immutable ID with all dependencies and URLs. Stop here until **explicit production revocation approval**.
5. After approval, invalidate/delete the approved cohort, retain tombstones, perform the full wait and independent verification, then atomically finalize each post. Do not enable a general audience selector until both database and delivery paths enforce these gates. Activate eligible protected-content flags gradually; never expose private choices for unsupported types.
6. Monitor pending age, copy/register/deletion failure counts, lease expiry, missing provenance, dependency conflicts, unexpected URL successes, access denials and delivery failures. Alert on any previously revoked source/public ID reappearing. An unexpected readable URL stops finalization/expansion and keeps affected posts hidden; inspect private audit records without logging tokens or signed URLs.

Rollback disables new restricted transitions and pauses cohort operations. Before quarantine, abandon authenticated copies safely and preserve the existing Public source. After destructive revocation, keep posts hidden and restore **authenticated** copies from approved private backups if necessary; never restore a Public URL or silently reset visibility. Retain legacy controls and compatible readers even if the UI is rolled back.

Remaining gates: live owner-backed legacy fixture acceptance, real elapsed revocation/independent vantage evidence, production schema/RPC/cache acceptance, supported provenance for historical unsigned uploads, provider coverage for unusual signed URLs, and separately approved production implementation/credentials/migrations/revocation. Pre-existing staging advisor warnings for [public definer grants](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [pg_net placement](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public) and [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) are outside this private workflow; no new SECURITY DEFINER functions or browser grants were introduced.

Focused checks: `node tests/post-media-legacy.test.js`, `node tests/post-media-service-worker.test.js`, and `node --test-name-pattern='publishing mode' tests/post-media-access.test.js`. The committed `tests/privacy-v2-legacy-database.mjs` additionally runs the actual staging SQL against ephemeral PGlite (tested with 0.3.14); an optional `FREEUPPER_TEST_PGLITE_MODULE` points to an externally installed module. It simulates elapsed time and uses mock Cloudinary responses, so it is not live CDN verification. No full prior suite was repeated.
