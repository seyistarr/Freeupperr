# Controlled production beta — 2026-10-27

Status: implementation deployed with release activation **blocked**, not verified.
Base: GitHub main `39be8c9288deecf5b8da990a426b978e634484c1`.

## Production inspection and changes

- `freeupper-web` proxies `/api/post-media` through
  `api.freeupper.com/functions/v1/protected-media`. User JWTs are passed intact;
  the API gateway supplies only its own anon key. The Edge Function verifies the
  user and calls `authorize_protected_asset` for each asset.
- Protected publishing Edge Function version 7 and protected-media version 3
  remain deployed with JWT verification enabled. Their code and secrets were not
  changed in this work. Cloudinary signing and actual authenticated download
  configuration still require live signed-in verification.
- Both existing publisher checks now approve exactly `archangelstr`, `freeupper`
  and `MasterCraft`. `firstuser` fails both. MasterCraft was missing from the
  second `test_publishers` list; the guarded, eligibility-only repair is recorded
  in `controlled-beta-allowlist.sql`. Viewer access is still determined by post
  audience and relationships, not by publisher beta membership.
- Migration `20261027121316_sync_public_follow_approvals` installs a private
  trigger that adds `public_auto` approval only for new/changed active follows of
  unsuspended public accounts, and removes approvals on unfollow/deactivation.
  It never automatically approves private accounts or backfills historical rows.
  Production verification found the trigger enabled, no client EXECUTE privilege,
  and the existing approval count unchanged at 68.
- Registry and upload-intent tables have RLS enabled and no SELECT grants to anon
  or authenticated clients. Draft creation, publishing transitions and media
  authorization RPCs remain service-role only. The authenticated beta-status RPC
  uses `auth.uid()`; browser code no longer calls internal release RPCs.
- Public search and share RPCs inspected retain public-only filters; the repost
  view uses `security_invoker=true`. Existing public post/media delivery paths
  were preserved. No production protected fixture posts or assets were created.

## Implementation

Studio and composer share beta checks, bounded authenticated uploads, signature
validation, registration confirmation, idempotent publish recovery and a separate
JPEG poster in slot 20. Unsupported Studio effects are rejected before uploading,
rather than silently publishing the original file. Unknown publish commit state
is not cancelled.

The build preserves server-gated publishing instead of inserting an unconditional
frontend disable. Homepage/profile media use a shared ephemeral loader. Profile
video grids request only the authenticated poster. The video page loads every
protected carousel image plus its registered video poster. Media is never derived
from a public Cloudinary URL. Legacy public URL fields are ignored for protected
post rendering. Blob URLs are revoked on auth changes, hidden tabs and page exit;
fetches are limited to three concurrent requests and 50 MB per response. The PWA
cache version was bumped so installed clients receive the updated scripts.

## Verification performed

- Automated authorization fixtures cover Public, Followers, Mutuals and Only Me,
  including owner/follower/mutual/stranger decisions and anonymous denials.
- Browser fixtures use real Chromium decoding and canvas poster generation with
  synthetic auth/API responses. They verify video/poster upload, private DOM
  delivery, synchronous sign-out removal, stranger denial and owner re-sign-in.
- Worker bundle/static runtime tests cover public pages, share/profile previews,
  PNG generation, source-file isolation, JWT forwarding, range playback fixtures,
  unauthorized media requests and disabled publishing API aliases.
- Database lifecycle tests exercise public/private follow approvals, removal,
  deactivation, target changes and client permission denial in isolated PGlite.
- Build and Wrangler dry run passed. The complete local suite passes with browser,
  bundle and static-origin tests enabled. CI must pass before the deployment job.

These tests are **not** authenticated production Supabase/Cloudinary acceptance.
No live login, signed Cloudinary upload, registration, protected publish, restricted
playback, private-account owner approval, or public-URL denial matrix is marked
passed. Security advisors were inspected; existing unrelated warnings were not
changed or presented as a clean full-project security audit.

## Release blocker and required next verification

Production `privacy_v2_private.release_control` remains:

```json
{"restricted_enabled":false,"delivery_verified":false,"publishing_verified":false}
```

`protected_first_release_status()` therefore returns `delivery:false`,
`publishing:false`, `legacy_conversion:false`. There are no protected origins,
registry assets or upload intents in production at inspection.

No secure normal-user credentials/session files or browser automation connection
were available for the approved publisher plus follower, mutual and stranger
viewers. Acknowledging the access request did not provide a session setup.
Do not mint substitute JWTs, impersonate users, or set verified flags to get past
this blocker. There is also no independent production verification lane: the
existing Edge handlers gate signing/registration/publishing and media delivery on
these same release flags. An isolated staging verification flow or a separately
reviewed, account-scoped verification lane is needed before those flags can
truthfully be marked verified.

Before activation, use real normal-user sessions and authenticated Cloudinary
fixtures to verify image, video and poster creation/registration/playback across
all three audiences; anonymous, expired/invalid JWT and stranger denials; exclusion
of firstuser from every publishing action; direct public/unsigned Cloudinary URL
denial; follow revocation and private-account approval; missing-poster publish
rejection; no restricted bytes in preview/search/cache responses; and preservation
of an existing Public post. Record actual results and cleanup of test assets.
Legacy media conversion must remain disabled throughout.
