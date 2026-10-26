# Cloudflare public reads and create-page follow-up

## Production diagnosis (26 October 2026)

Main inspected: `a9af01730a436ebcd2cad6ce503f0c9b6c5d15f1` (PR #19).
Production project: `jmjtqidirpmnegzvmiaq`. Read-only catalog inspection and
Postgres logs confirm `permission denied for function privacy_v2_approved_edge`.

`public.posts` has RLS enabled and a restrictive SELECT boundary named
`privacy_v2_restricted_post_read_boundary` for `anon` and `authenticated`.
It references `public.privacy_v2_approved_edge(uuid,uuid)`. That helper's EXECUTE
ACL intentionally permits only `postgres` and `authenticated`; its body also
requires a non-null `auth.uid()` participating in the relationship before using
`privacy_v2_private.approved_edge`. Anonymous public reads encounter the helper
permission check even though the SQL expression includes authentication guards.
Boolean expression order is not a safe permissions boundary.

Do not grant anonymous helper execution, expose the private relationship schema,
disable RLS, or replace the restrictive boundary with a permissive policy. Several
legacy permissive policies allow `true`, making a restrictive boundary essential.

## Approved production change — APPLIED

[anonymous-post-read-fix.REVIEW.sql](anonymous-post-read-fix.REVIEW.sql) is a
review-only transaction, never part of the build or an automatic migration:

1. Verify RLS, the existing policy roles/expression fingerprint and helper ACL.
   Abort if the production definitions drift from the inspected state.
2. Change the EXISTING restrictive policy's role list to `authenticated`, leaving
   its expression and all authenticated access decisions unchanged.
3. Add an `anon`-only restrictive policy allowing only published, explicitly public,
   non-deleted/non-hidden posts from explicitly non-private, non-suspended authors.
   Missing/null privacy states fail closed. No helper or table privileges are granted.

This additionally tightens anonymous reads for private/suspended authors; it never
adds access to restricted posts. The rollback file restores the previous policy
roles and removes the new policy, returning to the prior broken-but-closed state.
Both operations affect the shared database and therefore Vercel as well as Workers.
Apply only after the user has reviewed and approved this exact SQL. The user approved this exact SQL on 26 October 2026. It was applied through
Supabase as migration `20261026111825_fix_anonymous_post_read_boundary`.
The SQL remains review-only in the repository and is not run by application builds.

Local PGlite/PostgreSQL regression tests execute the actual review SQL against a
synthetic copy of the observed production boundary. They reproduce the original
42501 permission error, verify only eligible public rows become anonymously
readable, compare authenticated owner/follower/mutual/stranger/no-session results
before and after, deny anonymous helper/private-schema access, and verify rollback
and schema-drift rejection. No production rows are copied into these fixtures.

Post-apply verification passed: anonymous API reads return 93 eligible public
posts; restricted/unpublished/hidden/deleted filters return zero. A read-only
transaction under the actual `anon` role asserts every visible author is public
and non-suspended. RLS remains enabled; authenticated expression fingerprint and
helper definition fingerprint are unchanged, and anon still lacks helper EXECUTE.
Production currently contains no restricted/draft fixtures, so those adversarial
cases are covered by synthetic PostgreSQL tests rather than production writes.
Security advisors show no new advisory groups relative to the pre-apply snapshot.
Rollback was unnecessary. Auth, DNS, Cloudinary and restricted publishing stay unchanged.

## Reversible application fix

`ImageEmbedding.preloadModel()` started loading but returned `undefined`, so the
create page's `.then()` threw before drop zones and later initialization ran. Return
the cached model Promise so the page's existing success/error handlers work.
A second bug referenced an undeclared `embeddingTensor`; restore
`model.infer(imageElement, true)` and dispose the resulting tensor in `finally`,
including readback and dimension failures. Preserve the existing public embedding
API, 1024-value format, ranking behavior and all integration hooks. No OTD/OCIDE
files or integration configurations are modified.

## Live checks and remaining acceptance

Worker URL: https://freeupper-web.oluwaseyistarr.workers.dev.
Existing public fixtures selected only after confirming published/public status,
non-hidden/non-deleted state and non-private/non-suspended authors:

- `/p/hE6BH0xKig` (image), `/p/eOXIoEoizQ` (text), `/v/a-oobrjf1Q` (video).
- Twitterbot, WhatsApp and Facebook crawler requests receive valid OG HTML.
- Referenced preview images return HTTP 200 with image/png or image/jpeg.
- Human links open the matching Worker app page with the post identifier.
- After the approved RLS patch, `/v/a-oobrjf1Q` loads video elements and actual
  in-app playback passes: readyState 4, 320×426 frames, playback advancing from
  5.10 to 7.11 seconds, unpaused, no page errors.
- Restored feed reads exposed two existing renderer assumptions: an absent
  reaction-count object crashed text-post deep links, and video load callbacks
  dereferenced an absent wrapper. This PR adds optional null checks with focused
  tests while preserving real counts and the existing rendering behavior.
- External crawler request emulation is verified; actual social-platform cache
  refresh/unfurl is not claimed without posting the link on that platform.
- Connected test-account browser is unavailable: Opera connector reports
  "Browser not connected". User reconnection and interactive login are required
  for OAuth completion, chat send/receive and actual public upload tests.

Restricted audiences remain disabled. DNS and both live-domain Vercel routes,
Supabase authentication configuration and Cloudinary settings are unchanged.

## Application preview verification

PR: https://github.com/seyistarr/Freeupperr/pull/20
Cloudflare preview:
https://fix-cloudflare-public-read-create-freeupper-web.oluwaseyistarr.workers.dev

The create page completes initialization with no browser errors. Real MobileNet
inference on a test canvas returns 1024 finite values. All restricted options stay
disabled. The code PR remains unmerged pending review; database approval did not
implicitly authorize merging or deploying the application changes to main.
