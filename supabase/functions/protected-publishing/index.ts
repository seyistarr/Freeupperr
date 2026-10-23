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
    if (body.action === "create") {
      const types = body.media_types, fields = body.fields;
      if (!["followers","friends","only_me"].includes(body.visibility) ||
          !fields || typeof fields !== "object" || Array.isArray(fields) ||
          !["composer","studio"].includes(fields.source) ||
          Object.keys(fields).some(k => !["title","content","tags","source","commentsHidden","visibility","mediaUrl","thumbnailUrl","media","sound_id"].includes(k)) ||
          fields.mediaUrl || fields.thumbnailUrl || fields.sound_id ||
          (fields.media != null && (!Array.isArray(fields.media) || fields.media.length > 0)) ||
          (fields.visibility != null && fields.visibility !== body.visibility) ||
          typeof (fields.title ?? "") !== "string" || (fields.title ?? "").length > 200 ||
          typeof (fields.content ?? "") !== "string" || (fields.content ?? "").length > 20000 ||
          !Array.isArray(fields.tags ?? []) || (fields.tags ?? []).length > 30 ||
          !(fields.tags ?? []).every(t => typeof t === "string" && t.length <= 100) ||
          /https?:|blob:|data:|cloudinary/i.test(JSON.stringify(fields)) ||
          !Array.isArray(types) || types.length < 1 || types.length > 20 ||
          types.some(t => !["image","video"].includes(t)) ||
          (types.includes("video") && (types.length !== 1 || types[0] !== "video")))
        return reply(400, { error: "Invalid protected draft" });
      const { data: profile, error: profileError } = await db.from("profiles")
        .select("id").eq("id", owner).eq("suspended", false).maybeSingle();
      if (profileError || !profile) return reply(403, { error: "Owner unavailable" });
      const plan = types.map((type, slot) => ({ slot, type, role: "media" }));
      if (types[0] === "video") plan.push({ slot: 20, type: "image", role: "thumbnail" });
      const id = crypto.randomUUID();
      const { error } = await db.rpc("create_protected_draft", {
        p_owner: owner, p_post: id, p_visibility: body.visibility, p_plan: plan,
        p_fields: { title: fields.title ?? "", content: fields.content ?? "",
          tags: fields.tags ?? [], source: fields.source, comments_hidden: !!fields.commentsHidden }
      });
      return error ? reply(409, { error: "Draft creation unavailable" }) : reply(201, { id, status: "draft" });
    }
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
    if (typeof body.post_id !== "string" || !uuid.test(body.post_id))
      return reply(400, { error: "Invalid draft" });
    if (body.action === "publish") {
      const { data, error } = await db.rpc("protected_publish_transition", {
        p_owner: owner, p_post: body.post_id, p_action: "publish", p_data: {}
      });
      return error ? reply(409, { error: "Draft transition unavailable" }) : reply(200, data);
    }
    if (body.action === "sign") {
      if (!Number.isInteger(body.slot) || body.slot < 0 || body.slot > 20)
        return reply(400, { error: "Invalid slot" });
      const folder = "freeupper-protected-v2/" + owner;
      const proposed = folder + "/asset_" + crypto.randomUUID().replaceAll("-", "");
      const { data: intent, error } = await db.rpc("protected_publish_transition", {
        p_owner: owner, p_post: body.post_id, p_action: "reserve",
        p_data: { slot: body.slot, public_id: proposed }
      });
      const now = Math.floor(Date.now() / 1000);
      if (error || typeof intent?.public_id !== "string" ||
          !intent.public_id.startsWith(folder + "/asset_") ||
          !/^[a-f0-9]{32}$/.test(intent.public_id.slice((folder + "/asset_").length)) ||
          !Number.isSafeInteger(intent.timestamp) || intent.timestamp < now - 3600 ||
          intent.timestamp > now + 60)
        return reply(409, { error: "Reservation unavailable" });
      const cloud = Deno.env.get("CLOUDINARY_CLOUD_NAME");
      const apiKey = Deno.env.get("CLOUDINARY_API_KEY");
      const apiSecret = Deno.env.get("CLOUDINARY_API_SECRET");
      if (cloud !== "duzyf1kda" || !apiKey || !apiSecret)
        return reply(503, { error: "Upload signing unavailable" });
      const params = { timestamp: intent.timestamp, folder,
        public_id: intent.public_id.slice((folder + "/").length),
        type: "authenticated", overwrite: false };
      const { v2: cloudinary } = await import("npm:cloudinary@2.5.1");
      const signature = cloudinary.utils.api_sign_request(params, apiSecret);
      return reply(200, { cloud_name: cloud, api_key: apiKey, ...params, signature });
    }
    return reply(503, { error: "Publishing action not migrated" });
  } catch {
    return reply(503, { error: "Protected publishing unavailable" });
  }
});
