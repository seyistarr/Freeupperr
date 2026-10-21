# Privacy V2 integration status

## Current merge decision (2026-10-21)

**NO-GO for merging PR #9 wholesale or enabling protected audiences.** The branch currently differs from `main` by 112 ahead / 6 behind commits and 139 changed files. This includes executable API routes, workflows, client publishing code and staging-only acceptance tools. A successful Vercel build does not prove a safe code-only deployment.

## Required production-disabled merge gate

1. Reconcile the six commits on `main` without overwriting unrelated production changes.
2. Review every executable diff, especially API routes, rewrites, worker triggers, SQL and Create/Studio client code. Remove or isolate staging-only acceptance surfaces from production builds.
3. Confirm **Public-only** is the sole production publishing option; Followers, Mutuals and Only Me must remain disabled in all clients, APIs and database release flags. Production must fail closed if configuration is absent or inconsistent.
4. Confirm the merge itself cannot apply production migrations, activate Cloudinary changes, run cleanup/revocation jobs or switch protected media delivery.
5. Run tests for anonymous/public compatibility, protected-route denial, ownership, stale JWT/logout, deep links, share previews, feed/profile/search visibility, cache behavior and deployment rollback.
6. Review GitHub Actions and Vercel deployment behavior, then obtain explicit approval for a production-disabled merge.

## Subsequent protected-first release

New protected posts (Followers, Mutuals, Only Me) are independent of legacy conversion clocks. Enable only after actual-browser playback, account switching, old service-worker upgrade, pending cleanup verification, production RLS/RPC/follow-consent review, recovery and monitoring acceptance. Public remains available throughout.

## Legacy conversion waiting policy

The owner requested evaluating **7 days instead of 31**. This is **a proposal only**: the existing 31-day enforced floor, immutable independent receipts, synthetic November deadline and fail-closed revocation checks remain unchanged until CDN/provider evidence and explicit approval justify a different policy. The Recently Deleted seven-day restore design is separate and not implemented.

## Preserved behavior

Keep existing public-only publishing guard, server-side media authorization, Deep Linking V2 and current production users/data. No production SQL changes, media deletion, activation, deployment or merge are authorized by this document.
