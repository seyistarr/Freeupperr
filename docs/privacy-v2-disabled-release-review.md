# FreeUpper Privacy V2 — production-disabled release review

Status: **review only — no activation or deployment approval**.
Source: feature/post-privacy-v2-integration (PR #9). Target: main.

## Merge strategy
This branch starts at current main to preserve its recent changes in chat.html, chat.js, service-worker.js, manifest.webmanifest, api/post-preview.js and api/profile-preview.js. Do **not** merge PR #9 wholesale. Port only reviewed, fail-closed components with verified dependencies.

## Required release gates
- Public publishing continues working unchanged.
- Followers, Mutuals and Only Me remain unavailable in production until a separately approved activation.
- No production migration, Cloudinary mutation, cleanup worker or revocation workflow runs as a consequence of merging.
- Production protected-media API routes deny requests unless all independent production approval flags and database release status are present.
- No staging-only acceptance page, test endpoint, synthetic account capability or staging credentials become reachable in production.
- Verify RLS, privileged RPCs, historical follow consent, signed image/video/poster delivery, logout and session expiry, CDN direct URLs, old service-worker cache upgrade, and rollback.
- Test browser publishing and media playback, account switching, pending cleanup and monitoring before activation.

## Audience semantics
Public: existing public rules.
Followers: owner and approved followers only.
Mutuals: owner and reciprocally approved followers only.
Only Me: owner only.
Private-author restrictions, deleted/hidden content, search, preview and media bytes must follow the same rules.

## Legacy conversion
Seven days is a **requested proposal**, not the currently enforced threshold. Preserve the 31-day clock, independent immutable receipts and fail-closed CDN revocation checks until evidence and explicit approval support a shorter period. The separate Recently Deleted seven-day recovery design is not implemented.

## Current status
No production release, merge, migration or privacy activation has been authorized by this review document.
