# FreeUpper Cloudflare migration staging

This branch is **not production-ready**. It deploys static assets to a workers.dev preview only.
Vercel remains the production origin for freeupper.com.

## Prerequisites
1. Connect Cloudflare to GitHub or authenticate Wrangler using your Cloudflare account.
2. Install dependencies: `npm install` and `npm install --save-dev wrangler` (or run with `npx wrangler`).
3. Run `npx wrangler deploy --config wrangler.jsonc` from a local checkout.
4. Check `/__migration/health` returns `dynamicRoutesReady: false`.

## Migration blockers
- Port /api endpoints to Workers (Vercel Node request/response APIs are not directly compatible).
- Port short-link /v and /p metadata rendering and /u profile previews before switching DNS.
- Port sitemap-profiles.xml generation and @username routing.
- Verify service-worker scope, push notifications, auth redirects, cache headers, CSP and deep links.
- Configure production Supabase/Cloudinary credentials as Cloudflare secrets; never commit them.
- Test protected-media authorization and negative access cases with approved test accounts.
- Keep freeupper.com on Vercel until full end-to-end parity is verified.

The staging Worker deliberately returns HTTP 503 for dynamic routes rather than serving
incorrect public metadata or bypassing protected-media authorization.
