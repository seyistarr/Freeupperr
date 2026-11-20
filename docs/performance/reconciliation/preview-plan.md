# Isolated HTTPS acceptance preview — proposal only

No preview was deployed or published. Explicit approval is required before any
hosting action. The current implementation stays local on the integration branch.

Prepare a dedicated temporary Worker such as `freeupper-cache-acceptance-isolated`
on its own Workers.dev HTTPS origin, separate from web/API production Workers and
freeupper.com subdomains. A production Version URL is not sufficient isolation,
since it can retain production bindings. Default public visibility must be approved;
only synthetic fixture data belongs there. Stay within the existing Free allocation.

Proposed configuration (not applied to any actual Wrangler configuration):

- New Worker name, workers_dev enabled, `routes: []`, no custom domain or Git/build
  trigger. No scheduled handler/cron, queues, service/database/storage bindings,
  production secret, maintenance token or inherited production configuration.
- A separate acceptance-assets directory and a synthetic same-origin fixture API;
  no arbitrary proxy/upstream fetch. A local route mapper serves the same static
  shells for Home/Profile identity routes. Range fixtures are local/seekable.
- The existing real markup/CSS, auth/client/lifecycle/controller/player and verified
  cache policy are used. Auth actors A/B and posts are fake; no real Google login,
  user password, production token, upload or publication is allowed.
- Rewrite production API endpoints to fixture handlers and substitute the Firebase
  wrapper with a test wrapper importing only the cache policy. Perform acceptance-
  only substitutions BEFORE the existing final manifest/digest step; never mutate
  generated HTML/JS after hashing. Keep production source files unchanged.
- Use same-origin `connect-src`, local/fixture scripts/fonts, `img-src 'self' data:
  blob:`, `media-src 'self' blob:`, same-origin frames/forms/workers, and noindex
  response headers. All production API/Supabase/Firebase/media destinations must
  be denied in both client policy and fixture server behavior. Verify this locally
  with a network-destination allowlist before approval to publish concrete artifacts.
- Root manifest/worker identities resolve on the test origin, so iPhone PWA storage
  cannot overlap production origin storage. Prepare coherent release bundles A/B,
  failed-install and storage-fault modes, and a known-good rollback bundle.

The existing Gallery fixture already exercises actual Profile/Gallery/media with
Service Workers allowed, but a physical-browser artifact cannot rely on Playwright
request interception. Same-origin mock endpoints and enforcement must be packaged
explicitly before deployment. Publishing the branch as-is would reference production
services and is NOT this isolated preview.

After approval of the concrete artifact inventory, config, fixture dataset and
network policy, publishing is a separate authorized action. No production workflow,
route, cache rule, binding, secret or database may be changed. This preview can prove
physical UI/PWA/cache behavior; it cannot certify real Supabase RLS or Firebase
transport merely from mocks. Its eventual cleanup also needs explicit authorization.
