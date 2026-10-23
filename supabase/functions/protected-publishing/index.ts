import { createClient } from "npm:@supabase/supabase-js@2.57.0";

const headers = {
  "Content-Type": "application/json",
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Vary": "Authorization",
};
const reply = (status: number, value: unknown) =>
  new Response(JSON.stringify(value), { status, headers });

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return reply(405, { error: "Method not allowed" });
  const endpoint = Deno.env.get("SUPABASE_URL");
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (endpoint !== "https://jmjtqidirpmnegzvmiaq.supabase.co" || !secret) {
    return reply(503, { error: "Protected publishing unavailable" });
  }
  try {
    const db = createClient(endpoint, secret);
    const { data, error } = await db.rpc("protected_first_release_status");
    if (error || data?.version !== 1 || data?.delivery !== true ||
        data?.publishing !== true || data?.legacy_conversion !== false) {
      return reply(503, { error: "Protected publishing unavailable" });
    }
    return reply(503, { error: "Publishing actions are not migrated yet" });
  } catch {
    return reply(503, { error: "Protected publishing unavailable" });
  }
});
