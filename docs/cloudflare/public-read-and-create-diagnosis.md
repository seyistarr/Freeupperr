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

## Proposed production change — NOT APPLIED

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
Apply only after the user has reviewed and approved this exact SQL. No production
schema/policy changes have been applied by this PR.

Local PGlite/PostgreSQL regression tests execute the actual review SQL against a
synthetic copy of the observed production boundary. They reproduce the original
42501 permission error, verify only eligible public rows become anonymously
readable, compare authenticated owner/follower/mutual/stranger/no-session results
before and after, deny anonymous helper/private-schema access, and verify rollback
and schema-drift rejection. No production rows are copied into these fixtures.

After approval, re-inspect the catalog fingerprint, apply the transaction, then
verify anonymous public reads, direct restricted/draft/hidden/deleted reads,
unchanged authenticated boundaries and the existing helper ACL. Run advisors and
retest both the Cloudflare public feed and video page. Roll back if verification
fails. Do not enable restricted publishing or modify auth, DNS or Cloudinary.

## Reversible application fix

`ImageEmbedding.preloadModel()` started loading but returned `undefined`, so the
create page's `.then()` threw before drop zones and later initialization ran. Return
the cached model Promise so the page's existing success/error handlers work.
A second bug referenced an undeclared `embeddingTensor`; restore
`model.infer(imageElement, true)` and dispose the resulting tensor in `finally`,
including readback and dimension failures. Preserve the existing public embedding
API, 1024-value format, ranking behavior and all integration hooks. No OTD/OCIDE
files or integration configurations are modified.

## Live checks before database approval

Worker URL: https://freeupper-web.oluwaseyistarr.workers.dev.
Existing public fixtures selected only after confirming published/public status,
non-hidden/non-deleted state and non-private/non-suspended authors:

- `/p/hE6BH0xKig` (image), `/p/eOXIoEoizQ` (text), `/v/a-oobrjf1Q` (video).
- Twitterbot, WhatsApp and Facebook crawler requests receive valid OG HTML.
- Referenced preview images return HTTP 200 with image/png or image/jpeg.
- Human links open the matching Worker app page with the post identifier.
- `/v/` reaches video.html but renders no video because the pending RLS fix blocks
  anonymous post retrieval. Full in-app video playback is currently BLOCKED.
- External crawler request emulation is verified; actual social-platform cache
  refresh/unfurl is not claimed without posting the link on that platform.
- Connected test-account browser is unavailable: Opera connector reports
  "Browser not connected". User reconnection and interactive login are required
  for OAuth completion, chat send/receive and actual public upload tests.

Restricted audiences remain disabled. DNS and both live-domain Vercel routes,
Supabase authentication configuration and Cloudinary settings are unchanged.
