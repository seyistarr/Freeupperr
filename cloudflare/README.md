# FreeUpper Workers deployment

Worker: `freeupper-web` serves freeupper.com, www.freeupper.com and
https://freeupper-web.oluwaseyistarr.workers.dev. GitHub Actions deploys `main`
only after the Worker test job succeeds.

`GET /api/post-media?asset_id=<uuid>` forwards the caller's Bearer token and
optional Range header to the fixed
`https://api.freeupper.com/functions/v1/protected-media` endpoint. The gateway
supplies its own anon key; Supabase verifies the JWT and checks the asset's owner,
approved follower or mutual relationship on every request. Media streams through
the proxy with private/no-store headers. Cookies, caller API keys, arbitrary query
parameters, signed URLs and upstream redirects are never forwarded to clients.
Missing credentials return 401; unsupported methods return 405.

This route does not enable delivery or publishing release flags. The deployed
Edge Function's independent delivery gate remains authoritative. At inspection
on 2026-10-27, `protected_first_release_status()` reported both `delivery: false`
and `publishing: false`. Fixture playback tests do not establish live privacy
acceptance; approved authenticated end-to-end verification is still required
before enabling global restricted publishing.

## Build and deploy

Use Node 24 and the committed lockfile (`npm ci`). In the existing Cloudflare
Workers Builds trigger, use repository root `/`, build command
`npm run build:cloudflare`, and deploy command `npm run deploy:cloudflare`.
The deploy script keeps dashboard variables. The existing PR Preview job uses
`npm run build:cloudflare` followed by `npx wrangler preview`; its empty
`previews` configuration has no privileged bindings. Wrangler is pinned in devDependencies.

`npm run build:cloudflare` prepares an allowlist of tracked browser assets, copies
public handlers from current main, and adapts the edge OG renderer for Workers'
static WASM imports and bundled font. Generated files are ignored. No API source,
SQL, env files, server libraries, Git metadata or dependencies are static assets.
The build checks the upstream renderer shape and fails if its adapters become stale.

Public handlers use the existing browser-public Supabase anon key with the current
public RPCs and privacy checks. An optional Worker `SUPABASE_ANON_KEY` binding can
override it. No service-role, Cloudinary signing or auth-provider secrets are needed
or copied. Do not set VERCEL deployment approval variables on this Worker.

Dynamic metadata always uses private/no-store responses. The Worker PWA excludes
API and share/profile routes from its cache and respects private/no-store headers.
Human profile links redirect locally; crawler metadata retains production canonical
URLs. Post links open the app on the Worker origin. Restricted audience controls
and protected publishing are locked in Worker-generated assets, regardless of
backend release readiness. The Vercel sources and release gates are unchanged.

## Verification

```
npm ci
npm run build:cloudflare
npx wrangler deploy --dry-run --outdir .wrangler/test-build
FREEUPPER_TEST_BUNDLE=.wrangler/test-build node --test tests/*.test.js
npx wrangler dev --local --port 8787
# In a second terminal:
FREEUPPER_TEST_ORIGIN=http://localhost:8787 npm run test:cloudflare
```

CI checks the bundle, synthetic public/private profile previews, redirects, email
redaction, post previews, PNG generation, static assets, source isolation and
protected-route denials. Synthetic upstreams run inside workerd without production
writes. Existing authorization and SEO tests remain enabled. Two stale test fixtures
were corrected for main's crawler split and canonical hostname.

Signed-in acceptance still needs an approved user: Google OAuth completion, chat
send/receive, public uploads and post creation, private account access boundaries,
and video playback on target devices. OAuth returns to the current page and may be
blocked if the Worker origin is absent from Supabase's existing redirect allowlist;
do not modify that configuration as part of this migration. Restricted publishing
is intentionally unavailable. Fetching video/chat/create HTML alone does not prove
these authenticated flows work.

The original migration branch contained only a placeholder static page and disabled
handler scaffold. This implementation starts from newer main and retains both later
Privacy V2 changes. The previous lockfile disagreed with package.json (Vercel 60
versus 32 and missing Cloudinary); dependencies were reconciled with the locked
Vercel major while adding pinned Wrangler/Miniflare for reproducible Workers checks.
