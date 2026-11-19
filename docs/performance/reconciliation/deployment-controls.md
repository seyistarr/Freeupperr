# Production trigger audit and recommended controls

Read-only audit: 2026-11-19. No workflow, branch rule, environment, Cloudflare
trigger/setting, secret, domain, route or production deployment was changed.

Main is `4a19c659a1928b4d1ad39938ed05c5e7931f2d0b`. GitHub reports `protected:false`.
The Production environment reports `protection_rules: []` and no branch policy.
Existing successful check names are `worker`, `deploy-production`,
`Workers Builds: freeupper-web`, and `Workers Builds: freeupper-api`.

| Path | Trigger and current behavior |
|---|---|
| GitHub cloudflare-tests.yml | PR runs validation. Push/merge to main runs `worker`, then `deploy-production` with production secrets and `wrangler deploy --keep-vars`. Environment name alone is no manual gate. |
| Cloudflare Builds / freeupper-web | main, paths `*`; builds assets; deploy command only prints that publishing is owned by Actions. It does not independently publish web. |
| Cloudflare Builds / freeupper-api | main, paths `*`, no exclusions; `npm run test:api`, then `npm run deploy:api`. This independently publishes API even for cache-only changes and can run while web checks fail. |
| Chat UI checks | Conditional paths and a dedicated release branch; no production deploy step. Do not require its check on every PR until a guaranteed reporting gate exists. |

Recommended separate, explicitly approved control changes:

1. Protect main: PR-only changes, required `worker` check, current base/merge-queue
   validation, at least one independent reviewer, stale-review dismissal, required
   conversation resolution, no force pushes/deletion or unreviewed administrator
   bypass. Use CODEOWNERS for SW/cache/auth/media/Cloudflare/workflow changes. These
   are proposals; no rules or CODEOWNERS file was created by this task.
2. Add production-environment approval, prevent self-review and restrict deployment
   to protected main. Keep narrow deployment credentials outside ordinary test jobs.
3. Gate API publishing as explicitly as web. Prefer one reviewed deployment owner
   rather than an independent all-path Cloudflare auto-publish command. At minimum
   narrow API paths and document dependency/config triggers; path filtering alone
   does not replace approval. Changing the current trigger/workflow needs authorization.
4. Keep new cache/Gallery-with-SW checks mandatory in `worker`, which already runs
   the full Node suite. Keep WebKit and local workerd checks. Chat shared-runtime
   acceptance must have an always-reported gate before becoming globally required;
   current path-filtered checks can otherwise leave unrelated PRs waiting forever.
   The current dedicated WebKit step runs retained-navigation/Profile tests, not
   the full Gallery-with-SW matrix. Add that coverage through a separately reviewed
   workflow change after its supported runner is verified; physical iPhone/PWA
   acceptance remains a release requirement even if desktop WebKit passes.
5. Build/test a reviewed commit and inventory, retain matching artifacts and record
   release digest/version IDs. After approval, publish those exact artifacts or
   verify a deterministic rebuild's inventory. Do not push/merge this integration
   branch as a way to test deployment: both production publishing paths can trigger.

Inspected cache settings remain `cache_level=aggressive`, browser TTL 14400,
no Page Rules and no cache-phase zone ruleset. Managed security rule versions can
advance independently. No blanket Cache Everything/immutable rule is proposed for
mutable JS/CSS names or personalized APIs. Header generation, API gateway, production
Wrangler configurations, auth cookies/JWT routing and media access controls are unchanged.

Recorded current rollback targets (refresh before any future approved release):
web `52a80774-c6aa-4cf5-9ec7-092ac51e207a`, API
`3bcc4400-f4ce-44ad-a13b-b0d4213f1c7a`. Preserve matching assets; a code rollback
cannot roll back database/external state or these separate trigger settings.
