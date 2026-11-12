> Historical preparation evidence. Current execution instructions and classifications are in [TWO-STAGE-RELEASE.md](TWO-STAGE-RELEASE.md); any former alias migration proposal is superseded.

# Default identity release review

Status: local implementation; no push, merge, deploy, schema change, or production user write authorized by this review. Baseline main: `23d4d84bca1a6f94b058c6b5d1c3eaf50449738a` (cloned 2026-11-09 UTC). Branch: `codex/default-identity`.

## Production evidence (read only, 2026-11-09)

Project `jmjtqidirpmnegzvmiaq`. Public health endpoint reports `freeupper-web`, `ok:true`, `releaseVerified:true`, restricted audiences enabled. This endpoint does not expose a Git SHA; deployed source equivalence cannot be established from it. Production migration history currently ends at `20261031073211_prevent_self_relationships`; the new migration has not been applied. Main was rechecked with `git ls-remote` and remained at the baseline SHA.

| Check | Count |
| --- | ---: |
| Profiles / populated IDs / distinct IDs | 70 / 70 / 70 |
| Username contains @ | 43 |
| Display name contains @ | 43 |
| Accounts with @ in either field | 44 |
| Username equals current Auth email; corresponding metadata absent | 43 |
| Display name equals current Auth email; corresponding metadata absent | 42 |
| Confirmed automatic username fields eligible now | **0** |
| Confirmed automatic display-name fields eligible now | **0** |
| Ambiguous accounts containing @ excluded from automatic migration | **44** |
| Invalid existing ID formats / destination collisions | 0 / 0 |
| Profile audit rows / Auth audit rows | 0 / 0 |

The 43/42 matches are strong candidates, not verified assignment history. Metadata is user-editable and current values cannot establish provenance. Seven of the 44 accounts also have non-null display_username. No field is automatically approved from an `@` or email equality test. The data script also refuses a username change when a different nonempty display_username could represent customization; exclude that username field for separate review. Values derived from an old email, a prefix, or prefix plus digits likewise cannot be confirmed from this snapshot. Other profiles remain untouched; counts above are not a comprehensive provenance classification of all 70 accounts. Review candidates in the protected database console, never export emails into issues or source control. A local review list at `/workspace/identity-review-candidates.json` contains public FreeUpper IDs and independent candidate flags; it is deliberately outside the Git repository.

## Existing architecture and findings

- `profiles.freeupper_id` default: `'FU' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))`. Existing unique `profiles_freeupper_id_key`; existing UUID `profiles.id` references `auth.users.id`. No ID generator is replaced or added.
- `auth.users` AFTER INSERT trigger `on_auth_user_created` invokes `public.handle_new_user()`. It previously chose metadata username/display_name, falling back independently to `NEW.email`. Both Google OAuth and email registration pass through it.
- `auth.js`: `handleAuthSubmit` previously generated email/name-derived username plus four random digits and metadata display name. `getAuthenticatedUser` and `syncSessionToLocal` each had a missing-profile insert using metadata or the email prefix, with nonexistent `account_type`/`account_icon_url` columns. One path also attempted to reassign a `const` profile.
- Google uses Supabase `signInWithOAuth`, returning to the current page. Email uses Supabase `signUp` and `signInWithPassword`. Session synchronization reads profiles; no update is needed on login or refresh.
- `onboarding.js` / `index-feed.js` implement interests onboarding. That is separate from deliberate profile completion. `profile.html` edits names and sets `profile_setup_completed_at`; settings displays username read-only and links to the existing profile editor. `settings.js` and settings inline updates are profile updates, not creation or automatic email assignment.
- `display_username` is a presentation variant written by the profile editor. New defaults initialize it to the canonical handle; changing either username field synchronizes it to avoid retaining an old email presentation value. Unchanged legacy values survive unrelated edits.
- Existing case-insensitive username index `profiles_username_lower_idx`, case-sensitive unique constraint `profiles_username_key`, and client 3–30 character username / 2–40 display-name rules. No backend reserved-name list or username length CHECK exists in production. New backend validation enforces edited usernames and reserves `fu` + 12 hex characters for the matching existing ID. The 14-character default satisfies these rules.
- Existing `protect_profile_identity_fields` trigger protects immutable FreeUpper IDs and privileged columns; it is retained. All current profiles RLS policies and column grants are retained. Existing public SELECT policy is permissive; this change does not broaden it or claim to repair unrelated policy issues.
- `get_public_profile_by_username` is already a restricted-column SECURITY DEFINER RPC; compatibility retains its signature and suspension filter. `get_profile_by_freeupper_id`, UUID identity resolution, SEO eligibility, and profile/post sitemaps remain unchanged.
- Mentions save UUID `userId` plus display text, and clicks use UUID. Relationships, posts, notifications, conversations, and media are UUID-owned. No content text or existing mention payload is rewritten. Historical visible text can remain historical; canonical links and UUID references continue to resolve.
- Supabase Edge Function list inspected. `otd-auth` source is a disabled endpoint scaffold, not a signup implementation. Repository Edge Functions serve publishing, media, verification, and release auditing; no additional profile creation path was found. No Edge Function deployment is required.

## Changes

| File/component | Purpose |
| --- | --- |
| `auth.js` | Remove email/name-derived signup metadata and both email-derived recovery writes; preserve OAuth/password calls; insert-only conflict-safe recovery reads the winning profile |
| `service-worker.js` | Advance precache version so installed PWAs refresh changed shells and auth code |
| `index.html` | Link from existing interests onboarding to the existing profile editor |
| `profile.html` | Existing editor prompt; encoded former-handle URL parsing |
| `api/profile-preview.js` | Exact RPC handle/alias lookup instead of wildcard REST lookup; existing privacy/SEO checks still apply |
| `supabase/migrations/20261109051236_default_profile_identity.sql` | Insert defaults, update validation, safe Auth trigger, private alias/backup tables, compatible username RPC |
| `docs/identity/preview.sql` | Repeatable aggregate read-only candidate preview |
| `docs/identity/migrate-reviewed.sql` | Empty per-field evidence manifest; transactional backup, alias, update; ends with ROLLBACK |
| `docs/identity/rollback-reviewed.sql` | Compare-before-restore rollback; refuses to overwrite subsequent customization; ends with ROLLBACK |
| `tests/default-identity*.test.js` | Isolated database and mocked authentication browser coverage |

The default trigger runs only on INSERT, ignores client public-name metadata, and reads the existing column-generated FreeUpper ID. It never marks setup or interests onboarding complete. Existing rows and subsequent logins are untouched. Database unique indexes decide races atomically. For a new Auth profile, a duplicate generated FreeUpper ID or default username retries the existing column default at most five times, then aborts atomically. No existing ID is changed and no suffix or frontend ID is generated. Actual multi-connection PostgreSQL collision/retry testing is still required before release; PGlite queues concurrent requests on one database instance.

## Compatibility and privacy

Canonical `/u/<freeupper_id>` and UUID relationships remain stable. For approved username corrections, the data script privately retains SHA-256 keys of former handles and resolves them through the existing public-profile RPC. Neither aliases nor plaintext rollback values have public grants; both private tables have RLS with no public policies. Former usernames are not included in RPC results. API previews accept encoded legacy email handles and still apply existing private/incomplete-profile metadata protections. Aliases are reserved against reassignment by another profile. This is compatibility for explicitly supplied old handles, not public search indexing of old email addresses.

Search and new mention suggestions use current profiles and therefore show corrected values after normal reload. Existing UUID mention links remain stable; legacy invalid email-like textual mentions are not retrospectively rewritten. Cached screens can display an old name until refreshed; no permanent identity is cached in relationship keys.

## Proposed release sequence (approval required)

1. Review this report, final regression results, ambiguous candidates, schema SQL, and hosting implications. Obtain required provenance for any desired existing-user correction. Current approved data manifest is empty.
2. Capture a protected database backup plus exact live function definitions, ACLs, trigger definitions, and policy/grant snapshots. Re-run `preview.sql`; check case-insensitive username conflicts, malformed IDs, alias ambiguity, and field expectations. Confirm current main has not moved.
3. Validate the migration against an isolated production-schema restore without exporting user data. Complete real PostgreSQL concurrent signup and Supabase Auth integration tests with dedicated test identities in an isolated project; no production signup tests are performed here.
4. Apply only the reviewed additive schema migration through the normal Supabase migration process. This immediately makes old clients' signup metadata harmless and fixes all insert paths. Do not blindly run all historical repository migrations against production; reconcile its existing migration history first.
5. After explicit merge/deploy approval, release web changes. `.github/workflows/cloudflare-tests.yml` deploys `freeupper-web` automatically on a passing push to main, retaining variables. It does not apply Supabase migrations. No gateway binding, OAuth redirect, Auth identity, secret, or Edge deployment changes are needed. Existing `vercel.json` is retained; confirm any separately connected Vercel Git deployment before merge.
6. If provenance is supplied and the concrete field manifest is approved, run `migrate-reviewed.sql` first with its final ROLLBACK and inspect counts inside the transaction. Review link compatibility and collisions, then run the exact approved manifest with COMMIT. Do not populate it from the candidate query alone. Current migration count remains zero.
7. Verify deliberate onboarding save, custom editing, existing logins, UUID relationships, canonical and old-handle links, private/uncompleted SEO behavior, and RLS in the released environment. Monitor signup errors.

## Rollback

- Prefer rolling back frontend Worker code while keeping the privacy-safe database defaults; old clients remain compatible. Cloudflare rollback does not roll back Supabase data.
- Data rollback uses `rollback-reviewed.sql`, initially ROLLBACK. It locks profiles, compares all changed identity fields with the migration output, and refuses rollback if subsequent customization exists. It restores only backed-up identity fields, temporarily disables only the new validation trigger for legacy values, removes migration aliases, and preserves IDs, creation timestamps, media, and relationships. A username now in use aborts atomically. Review such conflicts per field.
- Schema removal, if absolutely required, must first restore the captured username resolver and Auth trigger definitions/ACLs, then remove the two new profile triggers and private functions/tables after preserving the backup. Restoring the original Auth trigger reintroduces email exposure, so this is not the default rollback. Do not drop private backups until the rollback window closes.

## Validation and blockers

See final validation results below. Production user records have not been mutated. Live OAuth, email delivery, GoTrue callbacks, real concurrent PostgreSQL sessions, production RLS advisers against the proposed schema, WebKit, and field provenance cannot be inferred from local fixture tests. These remain release gates; local browser tests mock the external Auth service rather than claiming real OAuth verification.

### Final results

| Check | Result |
| --- | --- |
| Complete regression suite, final Worker bundle and local runtime | **501 passed, 0 failed, 1 skipped** (502 tests; 352.5 seconds) |
| Final focused database identity/migration suite | **8 passed, 0 failed** |
| Final focused authentication browser, legacy URL/API, preview, SEO and sitemap suite | **12 passed, 0 failed** |
| Final schema application after adding alias FK index | **1 passed, 0 failed** |
| Web and API Worker build/packaging dry runs | Passed; no upload or deployment |
| JavaScript syntax and `git diff --check` | Passed |
| Optional WebKit theme test | Skipped in full run; browser downloaded subsequently, but Linux runtime libraries are missing |

Full regression command:

```sh
FREEUPPER_TEST_ORIGIN=http://127.0.0.1:8787 FREEUPPER_TEST_BUNDLE=.wrangler/test-build FREEUPPER_CHROMIUM=/usr/bin/chromium node --test --test-isolation=none tests/*.test.js tests/*.test.cjs
```

The focused runs additionally cover final review safeguards and API compatibility assertions added while the complete suite was executing. Counts are separate runs and must not be added as unique tests. Logs are retained outside source control in `/workspace/freeupper-validation/`.

| Requested area | Evidence and limit |
| --- | --- |
| Google / email registration | Real SQL Auth-insert trigger under both provider fixtures; browser verifies Supabase signup/OAuth calls with mocked service responses |
| Existing Google / email login | Auth updates preserve saved identity; browser tests login and profile synchronization without insertion |
| Defaults and UUID preservation | Database-generated existing ID, lowercase handle, display name, unchanged UUID/creation timestamp assertions |
| Uniqueness / concurrency | Concurrent queued fixture requests, existing unique indexes, bounded collision retries, atomic failure assertions; separate PostgreSQL sessions still a release gate |
| Custom names | Independent field migration assertions, custom presentation guard, existing-login preservation |
| Email-derived classification | Exact email/metadata evidence is treated as unverified candidates; independent fields and non-email @ names tested |
| Migration / rollback | Transactional apply/restore, stale value and custom presentation rejection, later-customization rollback refusal |
| URLs / mentions / search / relationships | Alias resolver, encoded URL reader, preview API, UUID mention targets and follows fixture; full regression includes posts, relationships, navigation and rendering |
| Incomplete profiles | Insert cannot mark completion; existing SEO eligibility, noindex, anonymized previews and sitemap tests pass |
| RLS / Auth boundaries | Own-profile recovery, foreign-owner insertion/update rejection, private alias/backup denial, direct trigger-function denial; live platform integration remains untested |

WebKit's missing libraries are `libgtk-4.so.1`, `libgraphene-1.0.so.0`, `libwoff2dec.so.1.0.2`, `libharfbuzz-icu.so.0`, `libhyphen.so.0`, `libmanette-0.2.so.0`, and `libGLESv2.so.2`. Neither the supported system-package helper nor sudo is available in this environment; no system packages or permissions were changed. No WebKit pass is claimed.

Outstanding approval/release gates: verified provenance for any existing-user fields; isolated real GoTrue/Google/email integration and multi-session PostgreSQL concurrency tests; optional WebKit runtime provisioning; production-schema restore/adviser checks; confirmation of hosting connections and reviewed migration ordering. No production schema or profile records were changed during this task.
