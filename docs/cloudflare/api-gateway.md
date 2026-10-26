# FreeUpper API gateway

`api.freeupper.com` runs the separate `freeupper-api` Cloudflare Worker.
It proxies the app's Supabase-compatible REST/RPC, Auth, Storage, named Edge
Functions and Realtime WebSocket routes. Supabase remains the backend.

The gateway forwards the user's bearer token unchanged. Supabase verifies tokens
and Postgres RLS authorizes rows. Anonymous calls use only the existing public anon
key. Never configure `SUPABASE_SERVICE_ROLE_KEY` on this gateway. Browser CORS is
limited to the production FreeUpper origins; CORS is not authentication.
Auth admin routes, private schemas, unlisted Edge Functions and arbitrary upstream
hosts are denied. Responses are streamed and marked private/no-store. No request
logs are enabled because URL queries and authorization can contain tokens.

## Configuration and deployment

Encrypted Worker bindings: `SUPABASE_URL` and `SUPABASE_ANON_KEY`, both production.
Staging secrets must remain in their separate store. No privileged credentials
are needed. The browser keeps its public anon key for SDK and Realtime compatibility;
this is not a secret. The original auth storage key is explicit, preserving existing
sessions and refresh-token state when changing API hosts.

Run `npm run test:api` and `npx wrangler deploy --config cloudflare/api/wrangler.jsonc --dry-run`.
Deploy the gateway before updating frontend assets. `GET /health` identifies the
gateway without disclosing backend configuration. The API and frontend have separate
Cloudflare Builds triggers, each pinned to its own Worker and deployment command.
Never deploy the API from the frontend's Build: Cloudflare CI overrides Worker names
to the Build's connected Worker. Both configs explicitly own only their own domains.
The PWA cache version is incremented for this migration.

Google's registered Supabase callback remains unchanged; the gateway's authorize
route redirects to the provider while the callback still goes to Supabase and then
back to the existing application redirect URL. No provider configuration changes.
Full signed-in OAuth completion, uploads and two-user chat require acceptance tests.

## Boundaries

This compatibility gateway does not disable the original Supabase public endpoint,
replace Supabase Auth with OTD, or replace PostgREST with domain-specific business
endpoints. RLS must remain correct even for callers bypassing the gateway. Existing
stored Supabase media URLs and Google's provider callback may still use Supabase's
hostname. Cloudinary uploads/delivery are unchanged. Protected audience release gates
remain disabled. Tightening database access to backend-only credentials requires a
separate reviewed migration and explicit business API authorization.

Rollback: restore the previous `auth.js`, password reset client, composer endpoint
and PWA version, then redeploy the frontend. Existing sessions use the same storage
key on both versions. Keep the API hostname while cached clients update; removing
it immediately would break those clients. No database or auth configuration changed.
