# Final Notes | Gallery review — 2026-11-15

## Status and baseline

Branch: `integration/notes-gallery-current-main`.
Base: `98efce5592466153d0b7f5bf3bd5e458adccb8e5`.
Worktree: `/workspace/Freeupperr-integration`.
Changes remain local, with no push, merge, deployment or production writes.
No new paid dependency or resource was introduced (₦0).

Main advanced from the previous base only in the trusted Google full-name signup
migration, its tests and identity documentation. Those changes are retained
unchanged. The local branch base was advanced without merging or replacing main
files with old feature pages. Critical Auth/Google, identity, Chat, publishing,
Sounds, Settings, Search, backend and CI source is checked against this exact base.

## Final behavior

- Notes uses the **verbatim latest Home card function** extracted into
  `post-card.js`; For You and Profile Notes delegate to that one function. The
  latest typography, truncated name/inline handle, badge, captions, media,
  quote formatting, engagement controls/counts and existing host helpers remain.
- Gallery uses existing eligible profile video posts, including ordinary and
  Studio videos, and the existing profile grid-card builder. One visible preview
  plays muted; lifecycle and reduced-motion/offscreen cleanup are tested.
- Global Video and Gallery load the same current-main DOM, CSS and controller.
  Gallery alone removes For You/Following and global navigation, restricts its
  ordered content scope, opens the exact selected video and stops at both ends.
  The global feed remains operational with its original controls and behavior.
- Sounds remains the actual `sound.html` experience with existing attribution and
  sound disc. Its native Back button is now unobstructed: the parent Gallery
  close control is hidden **and inert** while Sounds is open. The extra overlaid
  return button was removed. Only same-origin messages from the active viewer
  can change that parent control.
- A real pointer-tap regression exercises Profile controller → Gallery → Sounds
  → native Back, keeping Gallery open at the same video and nonzero position.
  Audio stops, the parent close control returns, and profile navigation restores
  when Gallery closes.
- Linux WebKit's paused looping video can reset to zero on an iframe seek. The
  minimal native reproduction confirmed this outside FreeUpper. Gallery now
  disables loop only during the restoration seek, restores it on seek completion,
  and avoids a second metadata seek overwriting the saved state. Global Video's
  playback path is unchanged. Tests assert the position **and restored loop flag**.

## Scope and security

No Gallery database migration, new table/RPC, Series/episode/collection, feed
algorithm, separate engagement model, staging adapter or Windows/iPhone testing
kit is included. The abandoned kit and its synthetic server tests were removed
from the active worktree; earlier work is retained only in a local archive outside
this feature. No local test service is added to the product.

Main's existing Google signup SQL remains because it is already part of main;
it was neither introduced nor applied by this feature. All other schema/backend
files are unchanged. Canonical post IDs, author attribution, owner-only Saved
handling, profile/tab visibility checks, live post authorization and existing
protected-media delivery are preserved. Sound-use rights and protected publishing
remain governed by existing systems; no grant or bypass was added.

The service worker preserves main's cache entries and identity/author pins, adds
only shared static frontend assets and versioned changed-script URLs, and uses
`freeupper-pwa-v35-notes-gallery`. Existing private-data/media cache exclusions
and account-isolation behavior are unchanged.

## UI evidence

| Surface | Latest main | Final integration |
|---|---|---|
| Home-style card, 390px | [Home](../final-visual-review/notes-main-390.png) | [Notes](../final-visual-review/notes-feature-390.png) |
| Home-style card, 430px | [Home](../final-visual-review/notes-main-430.png) | [Notes](../final-visual-review/notes-feature-430.png) |
| Player, 390px | [Global Video](../final-visual-review/video-main-390.png) | [Gallery](../final-visual-review/video-feature-390.png) |
| Player, 430px | [Global Video](../final-visual-review/video-main-430.png) | [Gallery](../final-visual-review/video-feature-430.png) |

[Native Sounds Back without overlap](sounds-back.png) · [Profile](profile.png) ·
[Measured comparison](../final-visual-review/comparison.json)

Author typography, handles, counts, disc presence and Notes card geometry match
in the automated comparisons. The intentional Gallery differences are its close
control and absence of feed selectors/global navigation. A one-pixel image-crop
height difference comes from fractional Home-header coordinates, not different
card geometry. Animated disc angles/progress vary naturally between screenshots.
Actual components are rendered locally with synthetic API responses/media;
external web fonts are blocked, so both sides share the same fallback font.
No physical-device or authenticated-production verification is claimed.

## Tests, limitations and publication

See [TEST-RESULTS.md](TEST-RESULTS.md) and [CHANGED-FILES.txt](CHANGED-FILES.txt).
Physical iPhone/staging infrastructure is not a gate introduced by this review.
Live database/RLS, hosted Cloudinary expiry and real licensing were not retested;
this change adds no backend behavior. Optional runtime/browser cases remain
explicitly skipped where their required environment is not enabled. Prior WebKit
offline emulation/refresh instability occurred on main too; it is not represented
as a passing physical offline test or a newly resolved Gallery defect.

Rollback requires restoring the pre-feature frontend assets and bumping the shell
cache version. There is no feature database rollback because there is no feature
migration. Publication still requires the user's explicit approval.
