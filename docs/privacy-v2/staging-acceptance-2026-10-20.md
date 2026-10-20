# Privacy V2 live staging acceptance — 2026-10-20

Decision: **NO-GO for production approval/merge.** Staging-only code is reviewable. Production was not queried, migrated, deployed, enabled, or revoked. Only Supabase `tagkrhvgcbnybiuyvjxt`, Cloudinary `sxdcqs5x`, and the feature preview were used. PR #9 remains draft.

## Observed results

| Check | Live result |
| --- | --- |
| Environment | Staging project ACTIVE_HEALTHY; publishing schema version 2 and legacy migrations present; preview READY; readiness HTTP 200, database/cloud/configuration true. |
| Protected publishing | Followers image, Mutuals video plus separate poster, and Only Me image published through authenticated owner HTTP APIs. References became registered IDs only after every required asset was ready. |
| Ownership | Another synthetic user received 409 for an owner's upload signature and 404 for registration. Non-owner legacy migration and browser access to the private RPC were denied. Missing provenance blocked preparation. |
| Drafts | Metadata and registered media were unavailable before publication; missing video poster prevented publication. |
| Audience/RLS | Owner saw all three restricted audiences; approved follower only Followers; mutual saw Followers and Mutuals; pending user and guest saw none. Detail, profile/search filters, direct viewer-JWT table reads, image/video/poster delivery matched. Authenticated denied metadata responses were empty arrays; guest metadata was 401; denied media was 404; allowed media was 200. |
| Cache/SEO | Media responses were private/no-store and varied by Authorization. Staged post/profile previews, OG, short-link and sitemap routes returned private/no-store 404 without production lookups. Live browser/service-worker upgrade acceptance was NOT performed. |
| Legacy copies/recovery | Real synthetic Public images/video were copied to authenticated assets, with a separately registered video poster. Registration was interrupted after real uploads and recovered without duplicate copies or changing Public references. Copy upload aliases returned 404. |
| Quarantine | All four authenticated roles and guest were denied pending legacy metadata/media. Ordinary cancellation, early observation and finalization were blocked. Requested restricted visibility stayed pending. |
| Rollback | A third synthetic source was copied and abandoned before quarantine. Its protected copy was removed; its Public post/references were unchanged and its original URL remained HTTP 200. Post-quarantine rollback to Public is intentionally forbidden; forward recovery is required. |
| Unsupported content | Authenticated restricted text-only, music and overlay creation requests returned 400. Staging repost/quote/engagement flows remain disabled; no positive acceptance of these features is claimed. |
| Retirement | The temporary runner was closed through the Auth admin API; fixture markers now prevent prior runner deployments from reseeding. An attempted seed then failed at fixture identity validation. Branch-only `FREEUPPER_STAGING_ACCEPTANCE` is disabled. Fixtures and pending clocks are retained. |

No passwords, JWTs, service-role keys, Cloudinary keys/secrets or authenticated delivery URLs are recorded here. Synthetic sign-ins used actual Auth sessions without sending email. Existing staging accounts were not reset or impersonated.

## Actual fixtures

Run label: `privacy-v2-live-20261020`. Four new synthetic accounts represented owner, approved follower, reciprocal approved mutual and pending/unapproved user; guest had no session. Fixtures are a solid-color 1px PNG and a 96×96, 0.3-second H.264 clip, not user media.

| Fixture | Staging post ID | Verified assets/outcome |
| --- | --- | --- |
| Followers | `dd1b74e0-bacd-4722-b90e-21a4c8b3d857` | Registered protected PNG; published. |
| Mutuals | `ce567c9d-f3e7-4b2e-8e2f-956d5150e8db` | Registered protected MP4 and PNG poster; published. |
| Only Me | `03829f4b-9820-4c73-9561-cd517da10067` | Registered protected PNG; published. |
| Legacy image | `f352427f-29e3-4088-8dd3-c825ee29c04d` | Source asset `4abec034c4405ea34335086c8c7a33ef`; one authenticated copy registered; source deleted; hidden and revoking. |
| Legacy video | `5dddda69-b3a7-4d78-8baa-e88571b6274b` | Source asset `3c71496eda31d2f53a13d040ca8ebd0b`; authenticated video and generated JPG poster registered; source deleted; hidden and revoking. |
| Rollback | `8411b7ae-f7e3-4514-875a-bb799f2dd726` | Source asset `b82cab9fcdaaa6606ac218f6cab4d97a`; authenticated copy removed; Public original preserved; job abandoned. |

## Revocation is NOT complete

Both original legacy URLs were HTTP 200 before deletion. A normal post-deletion GET of the persisted probe inventory, without redirects or cache-busting, found:

- Image: versioned URL **404**, unversioned URL **200**. Cached Public delivery remains accessible.
- Video/poster: all four inventoried URLs **404 at the tested network path**. This does not prove worldwide invalidation or completion.

Private audit events record deletion times, retry invalidation requests, origin absence and the actual normalized provider acknowledgement `already_absent` for empty deletion maps. This is request/absence evidence, **not a purge-completion receipt**. Current URL checks were separately recorded as `acceptance_url_check`, explicitly with `counts_for_verification=false`.

| Job | Last source deletion / waiting start UTC | Earliest first verification UTC | Qualifying observations |
| --- | --- | --- | --- |
| Image `99270662-125a-48fe-828e-469da012b29a` | 2026-10-20 21:03:50.215514 | 2026-11-20 21:03:50.215514 | 0 |
| Video `f3181572-90ce-4226-9e07-370d0417ee5c` | 2026-10-20 21:04:07.075603 | 2026-11-20 21:04:07.075603 | 0 |

`verified_at` remains NULL for both jobs. Safe retries preserved these clocks. No timestamp was backdated and the 31-day gate was not shortened. Atomic **legacy** cutover remains untested live because it must wait. The corresponding transaction/guards were checked in ephemeral PostgreSQL; simulated time is not live evidence.

At or after 2026-11-20 21:04:08 UTC, run the first normal checks for both fixtures from an independently operated runner, then a second distinct runner at least one hour later. Finalization cannot legitimately happen before roughly 22:04:08 UTC that day, and only if all required checks pass with fresh evidence. Any remaining HTTP 200/206, redirect, error, restored source or failed copy check keeps the post hidden. Previously saved/browser-cached copies cannot be recalled.

## Confirmed defects fixed

- `f37182a`: isolated preview SEO could contact hardcoded production RPC URLs; added an early private/no-store staging deny before lookup.
- `8f4a055`: authenticated Cloudinary assets were rejected for obsolete `access_mode: public` metadata. Actual unsigned upload/authenticated paths returned 404/401. Verification still requires authenticated type, identity/owner/post agreement and no anonymous access grants.
- `0e4a374`, `2a6d559`, `87a25d7`: corrected resource-detail page bounds to 100, SDK filtering of generic cursors, and unrelated generic cursors on explicit terminal derivative pages. Documented derivative cursors are exhausted; full-page loops and identity changes fail closed. Large historical inventories have focused unit coverage, not live acceptance claims.
- `90f6b65`, `169f1fe`: added structured deletion/invalidation request evidence and conservative already-absent retry handling, without resetting wait clocks or claiming purge completion.

Only focused new/modified tests were run, including local SQL checks for the audit transitions. No full existing suite or old fixture matrix was repeated. Diagnostic support commit `bd2fba5` returns bounded metadata/checks only; the worker requires its operator secret, exact staging environment and temporary flag.

## Remaining blockers and release decision

| Blocker | Classification | Legitimate next action |
| --- | --- | --- |
| Cached image URL still 200; 31-day period and independent observations incomplete; final legacy cutover unverified | **Elapsed time** | Keep both posts hidden; prepare two real network runners now, observe no earlier than the dates above, investigate CDN coverage if any URL still succeeds. |
| Historical ownership evidence | **Explicit production approval** | Obtain approval for a separately scoped historical provenance audit. Independent upload/audit evidence is still required; approval alone does not establish ownership. Synthetic creation receipts prove only these new fixtures. |
| Browser UI/session changes, stale service-worker upgrades and browser HTTP caches | **Staging configuration** | Use an isolated connected test browser and authorized synthetic sessions. API/header acceptance does not establish this result. |
| Production schema/RPC/view policy review, owner-consent/quarantine UI and supported content-specific rollout gates | **Code changes** | Review/prepare production-specific changes while flags remain off; do not mechanically repoint the staging runner or apply review SQL alone. |
| Private-backup restore exercise, monitoring/alert wiring and independent runner provisioning | **Staging configuration** | Exercise forward recovery with synthetic assets; pre-quarantine abandonment has passed live, production restore has not. |
| Production database/Cloudinary migration, source revocation, deployment/activation | **Explicit production approval** | Separate review and approval only after the evidence and code gates pass. Do not merge PR #9 now. |

Staging migrations are applied, including the two new revocation-evidence corrections. Preview deployment is ready. Production database migration/deployment/rollback readiness is **not approved**. The full order and rollback constraints remain in [legacy-media-rollout.md](legacy-media-rollout.md). Restricted text/music/overlays remain unsupported and gated.
