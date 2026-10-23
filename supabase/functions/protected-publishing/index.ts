import { createClient } from "npm:@supabase/supabase-js@2.57.0";
const headers = { "Content-Type": "application/json", "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow", "Vary": "Authorization" };
const reply = (status: number, value: unknown) =>
  new Response(JSON.stringify(value), { status, headers });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return reply(405, { error: "Method not allowed" });
  const endpoint = Deno.env.get("SUPABASE_URL");
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (endpoint !== "https://jmjtqidirpmnegzvmiaq.supabase.co" || !secret || !anon || anon === secret)
    return reply(503, { error: "Protected publishing unavailable" });
  try {
    const db = createClient(endpoint, secret, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: release, error: releaseError } = await db.rpc("protected_first_release_status");
    if (releaseError || release?.version !== 1 || release?.delivery !== true ||
        release?.publishing !== true || release?.legacy_conversion !== false)
      return reply(503, { error: "Protected publishing unavailable" });
    const bearer = request.headers.get("Authorization") || "";
    const match = /^Bearer ([^ ]+)$/.exec(bearer);
    if (!match) return reply(401, { error: "Authentication required" });
    const auth = createClient(endpoint, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: identity, error: identityError } = await auth.auth.getUser(match[1]);
    if (identityError || !identity?.user?.id) return reply(401, { error: "Authentication required" });
    const owner = identity.user.id;
    const raw = await request.text();
    if (raw.length > 16384) return reply(413, { error: "Request too large" });
    const body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) return reply(400, { error: "Invalid request" });
    if (body.action === "status") {
      if (typeof body.post_id !== "string" || !uuid.test(body.post_id))
        return reply(400, { error: "Invalid draft" });
      const { data, error } = await db.from("posts")
        .select("id,publishing_state,visibility,media").eq("id", body.post_id)
        .eq("user_id", owner).maybeSingle();
      if (error || !data) return reply(404, { error: "Draft unavailable" });
      return reply(200, { id: data.id, status: data.publishing_state,
        ...(data.publishing_state === "published" ? { media: data.media, visibility: data.visibility } : {}) });
    }
    return reply(503, { error: "Publishing action not migrated" });
  } catch {
    return reply(503, { error: "Protected publishing unavailable" });
  }
});
