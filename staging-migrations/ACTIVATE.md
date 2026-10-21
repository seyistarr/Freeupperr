Privacy V2 isolated staging activation

Target only Supabase `tagkrhvgcbnybiuyvjxt` (Freeupperr Staging), schema `privacy_test`, and Cloudinary `sxdcqs5x`. Never run these commands against production. The feature branch remains `feature/post-privacy-v2-integration`; PR #9 stays draft.

October 21 live protected-first acceptance applied these files to the approved staging project after project/schema checks: `privacy-v2-protected-first.sql` (11:01:11 UTC), `privacy-v2-session-boundary.sql` (12:16:38), `privacy-v2-upload-reservation-retry.sql` (12:16:53), and `privacy-v2-anonymous-public-read.sql` (12:19:42). Do not rerun them; inspect migration history first. The reservation migration checks the prerequisite function body hash and stops on drift. The core and fixes do not enable legacy deletion. See [actual results and remaining browser/recovery checks](../docs/privacy-v2/readiness-2026-10-21.md#protected-first-live-staging-acceptance-update).

The separate `privacy-v2-replacement-deletion-consent.sql` legacy follow-up remains **unexecuted** and is not a new-publishing prerequisite. Do not apply it or enable a legacy runner as part of protected-first acceptance. All production review migrations remain unexecuted. `FREEUPPER_STAGING_ACCEPTANCE` was disabled after the isolated API checks; the final branch preview must pick up that setting.

Database migrations, in order (already applied through the staging Supabase connector in this change):

```sh
# STAGING_DATABASE_URL must come from your staging-only secret store.
# The session setting is an explicit target acknowledgement, not a replacement for checking the connection URL.
PGOPTIONS='-c freeupper.privacy_v2_project_ref=tagkrhvgcbnybiuyvjxt' psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f staging-migrations/privacy-v2-protected-publishing.sql
PGOPTIONS='-c freeupper.privacy_v2_project_ref=tagkrhvgcbnybiuyvjxt' psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f staging-migrations/privacy-v2-readers-cleanup.sql
PGOPTIONS='-c freeupper.privacy_v2_project_ref=tagkrhvgcbnybiuyvjxt' psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f staging-migrations/privacy-v2-legacy-media.sql
PGOPTIONS='-c freeupper.privacy_v2_project_ref=tagkrhvgcbnybiuyvjxt' psql "$STAGING_DATABASE_URL" -v ON_ERROR_STOP=1 -f staging-migrations/privacy-v2-legacy-dependency-scope.sql
```

Vercel project: `prj_ZdmEklbr8BOkJeOzBqSFPSXwLJoB` / `freeupper`; team: `team_V6feGIkHBGzO4k0xBbcjnvMj`. **Every setting below must target Preview and this Git branch only.** Do not replace project-wide or production variables.

| Variable | Required value |
| --- | --- |
| `SUPABASE_URL` | `https://tagkrhvgcbnybiuyvjxt.supabase.co` |
| `SUPABASE_ANON_KEY` | Staging publishable/anon key from the staging secret store |
| `SUPABASE_SERVICE_ROLE_KEY` | Real staging-only service-role key; never a placeholder |
| `CLOUDINARY_CLOUD_NAME` | `sxdcqs5x` |
| `CLOUDINARY_API_KEY` | Key for `sxdcqs5x` only |
| `CLOUDINARY_API_SECRET` | Secret for `sxdcqs5x` only |
| `FREEUPPER_MEDIA_TEST_ENV` | `isolated-freeupper-staging` |
| `FREEUPPER_PROTECTED_MEDIA_DELIVERY` | `enabled-in-isolated-staging` |
| `FREEUPPER_PROTECTED_PUBLISHING` | `enabled-in-isolated-staging` |
| `FREEUPPER_CLEANUP_TOKEN` | Independent random secret of at least 32 characters, shared only with the staging cleanup job |

Vercel supplies `VERCEL_ENV=preview` and `VERCEL_GIT_COMMIT_REF` from the Git source; do not manually override them. Keep Node 24 and the existing static-site/API deployment. No production aliases, promotion, or Vercel Cron entry is needed. The server-only profile SEO utility now lives in `lib/` so the preview stays within its existing 12-function limit.

Example branch-scoped setting command (read secrets from protected files; do not put values in arguments or output):

```sh
vercel env add SUPABASE_SERVICE_ROLE_KEY preview --git-branch=feature/post-privacy-v2-integration --type secret --scope seyistarrs-projects < /secure/staging-supabase-service-role-key
```

Use the Vercel dashboard/API to replace an existing branch-scoped variable instead of creating duplicates. Check `vercel env add --help` for the installed CLI before running it. The project must already be linked to the exact project/team above.

After a preview build containing this change is READY, check the actual credentials without returning their values:

```sh
node scripts/privacy-v2-staging.mjs readiness
```

Do not enable the two feature flags until this returns `ready: true`. Redeploy the feature-branch Git SHA with target Preview after changing environment variables; never use `--prod`, promote, or attach production aliases.

Reader entry points: `index.html?privacy_staging=1`, `video.html?privacy_staging=1`, `profile.html?privacy_staging=1&user=<staging-owner-UUID>`. They require a separate in-memory staging sign-in. Shared post links retain `privacy_staging=1` and return no crawler-visible restricted metadata. Create/Studio expose their staging sign-in only when the capability gate succeeds.

Staging cleanup is scheduled every five minutes by `pg_cron` with synchronous `http` in the isolated Supabase project. `privacy-v2-cleanup-schedule.sql` provisions the named job after a random token has been stored in Supabase Vault (`freeupper_privacy_v2_cleanup_token`) and the branch-scoped Vercel `FREEUPPER_CLEANUP_TOKEN`. The token is never committed or placed in cron command text; browser roles cannot read Vault or execute the private scheduler function. Synchronous HTTP avoids storing authorization headers in the shared `pg_net` request queue. Apply that third migration only with the same staging target acknowledgement and secret already provisioned.

For an additional manual cleanup call, inject the same secret into the job environment:

```sh
node scripts/privacy-v2-staging.mjs cleanup
```

Do not configure Vercel Cron for this: it would run on production rather than the feature preview. The database job targets only the pinned feature-branch preview alias. Each call processes at most three expired/failed drafts; repeat calls drain a backlog safely. Failures back off and successful deletes remain pending until upload signatures can no longer be replayed (65 minutes). Active drafts and published posts are never reclaimed. For immediate user cancellation, POST `{ "action": "cancel", "post_id": "<UUID>" }` to `/api/privacy-v2-publish` with that owner's staging session JWT, never a supplied Cloudinary public ID.

Legacy migration remains an operator-only staging workflow, dry-run by default. Its private provenance, source claims, audit ledger, reference guards and dependency inventory are applied in staging; synthetic staging sources have entered revocation waiting, and no revocation is marked verified. See the [live acceptance report](../docs/privacy-v2/staging-acceptance-2026-10-20.md). See [legacy-media-rollout.md](../docs/privacy-v2/legacy-media-rollout.md) for commands, revocation waiting/verification, production order and rollback. Keep `FREEUPPER_LEGACY_MIGRATION` out of browser configuration; the runner rejects production even in dry-run mode.
