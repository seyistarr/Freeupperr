# Temporary Privacy V2 staging test page

Open `/privacy-v2-staging-test.html` on the isolated staging preview.
This is a virtual HTML page served by `api/privacy-v2-staging-test.js`;
there is deliberately no static HTML file that can bypass the server gate.
The direct API URL has the same gate.

The route returns 404 unless all existing environment values match:
- `VERCEL_ENV=preview` (or `development` for local testing)
- `VERCEL_GIT_COMMIT_REF=feature/post-privacy-v2-integration`
- `SUPABASE_URL=https://tagkrhvgcbnybiuyvjxt.supabase.co`
- `FREEUPPER_MEDIA_TEST_ENV=isolated-freeupper-staging`

Do not set or enable `FREEUPPER_PROTECTED_MEDIA_DELIVERY` for this page.
Do not change production environment settings. Production always receives 404.
The page and response include noindex directives, no-store headers and a
restrictive CSP; there are no sitemap or app-navigation links.

Use a private browser window with no existing app service worker. Select Owner,
Approved follower or Stranger, enter that existing staging account's email and
password privately, then click Sign in and test. Account labels do not create
users, approve relationships or prove which role an account actually has.
Use the matching preconfigured staging fixture accounts.

The page calls only the fixed staging GoTrue password endpoint using its verified
modern publishable key, then sends the in-memory bearer token only to the
same-origin fixed asset request. No SDK, production client, analytics, browser
storage or service-role key is used. Password fields are cleared immediately.
Each authenticated run attempts to revoke its own session and discards the token.
The guest button omits cookies and Authorization and never signs in.
Redirects are rejected. Responses are not rendered; only numeric HTTP statuses
are displayed. A controlling service worker blocks tests to prevent app caching.

Asset request:
`/api/post-media?asset_id=30000000-0000-4000-8000-000000000003`

HTTP 503 is expected while delivery is disabled. It is not evidence of a passing
owner/follower/stranger/guest audience test. This page does not enable delivery,
modify fixtures, change policies, or merge PR #9.

## Verification

Run existing suites and page safety tests before any preview deployment:

```sh
node --test tests/*.test.js
```

If a sandbox blocks child-process creation, use Node 24's
`--test-isolation=none` and run files serially. The original dependency manifests
on the branch are inconsistent: npm ci reports missing Cloudinary and a Vercel
version mismatch. Do not silently regenerate the production lockfile as part of
this temporary page. Record the installation limitation separately from test
assertion results.

Remove the API handler, its rewrite, this document and the page test file when
staging verification is complete. Do not merge this temporary tool to main.
