const corsFor = (req: Request) => {
  const origin = req.headers.get("Origin") || "";
  if (!["https://freeupper.com", "https://www.freeupper.com"].includes(origin)) return {};
  return { "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, range",
    "Access-Control-Expose-Headers": "content-range, content-length, accept-ranges",
    "Vary": "Origin, Authorization" };
};
import { createClient } from "npm:@supabase/supabase-js@2.57.0";
const headers = { "Content-Type": "application/json", "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow", "Vary": "Authorization" };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
Deno.serve(async (request: Request) => {
  const cors = corsFor(request);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const reply = (status: number, value: unknown) => new Response(JSON.stringify(value), { status, headers: { ...headers, ...cors } });
  if (request.method !== "POST") return reply(405, { error: "Method not allowed" });
  const endpoint = Deno.env.get("SUPABASE_URL");
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (endpoint !== "https://jmjtqidirpmnegzvmiaq.supabase.co" || !secret || !anon || anon === secret)
    return reply(503, { error: "Protected publishing unavailable" });
  try {
    const db = createClient(endpoint, secret, { auth: { persistSession: false, autoRefreshToken: false } });
    // Internal cleanup: requires both a valid service-role JWT and a separate
    // server-only worker secret. Runs independently of publishing release flags.
    const workerAction = request.headers.get("X-FreeUpper-Action");
    if (["cleanup", "security-audit"].includes(workerAction || "")) {
      const bearer = request.headers.get("Authorization") || "";
      const workerSecret = Deno.env.get("FREEUPPER_CLEANUP_WORKER_SECRET");
      const supplied = request.headers.get("X-FreeUpper-Worker-Secret") || "";
      const legacyWorker = bearer === `Bearer ${secret}` && !!workerSecret && workerSecret.length >= 32 && supplied === workerSecret;
      let scheduledWorker = false;
      // The platform verifies this JWT (verify_jwt=true). Accept valid rotated
      // project anon keys rather than pinning to one environment-key string.
      let anonIdentity = bearer === `Bearer ${anon}`;
      try {
        const claims = JSON.parse(atob(bearer.slice(7).split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));
        anonIdentity ||= claims.role === 'anon' && claims.ref === 'jmjtqidirpmnegzvmiaq';
      } catch (_) { /* Non-JWT fixture or invalid credentials remain denied. */ }
      if (anonIdentity && /^[a-f0-9]{64}$/.test(supplied)) {
        const { data, error } = await db.rpc("protected_cleanup_worker_authorized", { p_token: supplied });
        scheduledWorker = !error && data === true;
      }
      if (!legacyWorker && !scheduledWorker) return reply(403, { error: "Worker forbidden" });
      const cloud = Deno.env.get("CLOUDINARY_CLOUD_NAME");
      const apiKey = Deno.env.get("CLOUDINARY_API_KEY");
      const apiSecret = Deno.env.get("CLOUDINARY_API_SECRET");
      if (cloud !== "duzyf1kda" || !apiKey || !apiSecret)
        return reply(503, { error: "Cleanup configuration unavailable" });
      const { v2: cloudinary } = await import("npm:cloudinary@2.5.1");
      cloudinary.config({ cloud_name: cloud, api_key: apiKey,
        api_secret: apiSecret, secure: true });
      if (workerAction === "security-audit") {
        // Storage checks use real configured Cloudinary signatures, but return
        // statuses only. This never substitutes for normal-user JWT acceptance.
        const { data: assets, error } = await db.from("post_media_assets")
          .select("id,cloudinary_public_id,resource_type,format,status").limit(30);
        if (error || !Array.isArray(assets)) return reply(503, { error: "Audit unavailable" });
        const results = [];
        for (const asset of assets) {
          if (!/^freeupper-protected-v2\/[a-f0-9-]{36}\/asset_[a-f0-9]{32}$/.test(asset.cloudinary_public_id) ||
              !["image","video"].includes(asset.resource_type) || !/^[a-z0-9]{2,8}$/.test(asset.format)) continue;
          const probe = async (expires_at: number) => {
            const signed = cloudinary.utils.private_download_url(asset.cloudinary_public_id, asset.format,
              { resource_type: asset.resource_type, type: "authenticated", expires_at, attachment: false });
            const response = await fetch(signed, { redirect: "manual", signal: AbortSignal.timeout(15000) });
            const status = response.status; await response.body?.cancel(); return status;
          };
          results.push({ asset_id: asset.id, registry_status: asset.status,
            valid_download_status: await probe(Math.floor(Date.now()/1000)+60),
            expired_download_status: await probe(Math.floor(Date.now()/1000)-3600) });
        }
        const passed = results.length > 0 && results.every(result =>
          [400,401,403,404].includes(result.expired_download_status) &&
          (result.registry_status !== "ready" || result.valid_download_status === 200));
        const report = { expired_urls_denied: passed, assets: results };
        const { error: saveError } = await db.rpc("record_protected_security_audit", { p_results: report });
        return saveError ? reply(503, { error: "Audit recording failed" }) : reply(passed ? 200 : 503, report);
      }
      const { error: expireError } = await db.rpc("expire_protected_drafts");
      if (expireError) return reply(503, { error: "Draft cleanup unavailable" });
      const { data: batch, error: claimError } = await db.rpc(
        "claim_protected_cleanup_batch", { p_limit: 3 });
      if (claimError || !Array.isArray(batch))
        return reply(503, { error: "Cleanup queue unavailable" });
      let cleaned = 0, pending = 0;
      for (const item of batch) {
        let success = false;
        const prefix = `freeupper-protected-v2/${item.owner_id}/asset_`;
        if (typeof item.public_id === "string" &&
            item.public_id.startsWith(prefix) &&
            /^[a-f0-9]{32}$/.test(item.public_id.slice(prefix.length))) {
          try {
            const results = await Promise.all(["image", "video"].map(resource_type =>
              cloudinary.uploader.destroy(item.public_id, {
                resource_type, type: "authenticated", invalidate: true, timeout: 15000
              })));
            success = results.every(result =>
              result?.result === "ok" || result?.result === "not found");
          } catch (error) {
            console.error("Cleanup deletion error", error instanceof Error ? error.name : "Error");
          }
        }
        const { data: recorded, error: recordError } = await db.rpc(
          "complete_protected_cleanup", {
            p_intent: item.id, p_lease: item.lease, p_success: success
          });
        if (recordError || recorded !== true || !success) pending++;
        else cleaned++;
      }
      return reply(200, { processed: batch.length, cleaned, pending });
    }
    const bearer = request.headers.get("Authorization") || "";
    const match = /^Bearer ([^ ]+)$/.exec(bearer);
    if (!match) return reply(401, { error: "Authentication required" });
    const auth = createClient(endpoint, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: identity, error: identityError } = await auth.auth.getUser(match[1]);
    if (identityError || !identity?.user?.id || identity.user.is_anonymous === true) return reply(401, { error: "Authentication required" });
    const owner = identity.user.id;
    const raw = await request.text();
    if (raw.length > 16384) return reply(413, { error: "Request too large" });
    const body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) return reply(400, { error: "Invalid request" });
    // Cleanup remains available to the authenticated owner after mode expiry or revocation.
    if (body.action === "verification-list") {
      const { data, error } = await db.rpc("list_verification_posts", { p_owner: owner });
      return error ? reply(503, { error: "Verification list unavailable" }) : reply(200, { posts: data });
    }
    if (body.action === "verification-cleanup") {
      if (typeof body.post_id !== "string" || !uuid.test(body.post_id)) return reply(400, { error: "Invalid verification post" });
      const { error: retireError } = await db.rpc("retire_verification_post", { p_owner: owner, p_post: body.post_id });
      if (retireError) return reply(404, { error: "Verification post unavailable" });
      // Retirement revokes delivery immediately. Remote deletion is recorded only after Cloudinary confirms it.
      const cloud = Deno.env.get("CLOUDINARY_CLOUD_NAME"), apiKey = Deno.env.get("CLOUDINARY_API_KEY"), apiSecret = Deno.env.get("CLOUDINARY_API_SECRET");
      let pending = true;
      if (cloud === "duzyf1kda" && apiKey && apiSecret) {
        const { data: batch, error } = await db.rpc("claim_verification_cleanup", { p_owner: owner, p_post: body.post_id });
        if (!error && Array.isArray(batch)) {
          const { v2: cloudinary } = await import("npm:cloudinary@2.5.1");
          cloudinary.config({ cloud_name: cloud, api_key: apiKey, api_secret: apiSecret, secure: true });
          // Small batches avoid unbounded remote work; retries use the persisted cleanup leases.
          for (let start = 0; start < batch.length; start += 3) {
            await Promise.all(batch.slice(start, start + 3).map(async item => {
              let success = false;
              const prefix = `freeupper-protected-v2/${owner}/asset_`;
              if (typeof item.public_id === "string" && item.public_id.startsWith(prefix) && /^[a-f0-9]{32}$/.test(item.public_id.slice(prefix.length))) {
                try {
                  const results = await Promise.all(["image", "video"].map(resource_type => cloudinary.uploader.destroy(item.public_id,
                    { resource_type, type: "authenticated", invalidate: true, timeout: 15000 })));
                  success = results.every(r => r?.result === "ok" || r?.result === "not found");
                } catch (_) { /* Keep deletion pending for a retry. */ }
              }
              await db.rpc("complete_protected_cleanup", { p_intent: item.id, p_lease: item.lease, p_success: success });
            }));
          }
          const { data: posts, error: listError } = await db.rpc("list_verification_posts", { p_owner: owner });
          pending = !!listError || !Array.isArray(posts) || posts.find(p => p.id === body.post_id)?.cleanupPending !== false;
        }
      }
      return reply(200, { id: body.post_id, retired: true, cleanupPending: pending });
    }
    // Every publishing action requires an existing, eligible production Auth user.
    const { data: betaApproved, error: betaError } = await db.rpc("protected_publisher_beta_allowed", { p_user: owner });
    if (betaError || betaApproved !== true) return reply(403, { error: "Protected publishing access denied" });
    if (!["create","text"].includes(body.action) && (typeof body.post_id !== "string" || !uuid.test(body.post_id))) return reply(400, { error: "Invalid draft" });
    const { data: access, error: accessError } = await db.rpc("protected_publishing_access", {
      p_owner: owner, p_post: ["create","text"].includes(body.action) ? null : body.post_id
    });
    if (accessError || access?.mode !== "production") return reply(503, { error: "Protected publishing unavailable" });
    const verification = false;
    if (body.verification === true) return reply(400, { error: "Temporary verification publishing has ended" });
    if (body.action === "text") {
      const fields=body.fields;
      if (!["followers","friends","only_me"].includes(body.visibility) || !fields || typeof fields!=="object" || Array.isArray(fields) ||
        Object.keys(fields).some(k=>!["title","content","tags","source","commentsHidden","textTemplateId"].includes(k)) ||
        !["composer","studio"].includes(fields.source)) return reply(400,{error:"Invalid restricted text"});
      const {data,error}=await db.rpc("publish_restricted_text",{p_owner:owner,p_post:crypto.randomUUID(),p_visibility:body.visibility,
        p_fields:{title:fields.title??"",content:fields.content??"",tags:fields.tags??[],source:fields.source,comments_hidden:!!fields.commentsHidden},p_template:fields.textTemplateId??null});
      return error?reply(409,{error:"Restricted text publication unavailable"}):reply(201,data);
    }
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
      return error ? reply(409, { error: "Draft creation unavailable" }) : reply(201, { id, status: "draft", verification, expires_at: access.expires_at });
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
    if (body.action === "register") {
      if (!Number.isInteger(body.slot) || body.slot < 0 || body.slot > 20 ||
          typeof body.public_id !== "string" || typeof body.asset_id !== "string" ||
          !/^[a-f0-9]{32}$/i.test(body.asset_id) ||
          !["image","video"].includes(body.resource_type))
        return reply(400, { error: "Invalid asset" });
      const prefix = "freeupper-protected-v2/" + owner + "/asset_";
      if (!body.public_id.startsWith(prefix) ||
          !/^[a-f0-9]{32}$/.test(body.public_id.slice(prefix.length)))
        return reply(404, { error: "Asset unavailable" });
      const { data: post, error: postError } = await db.from("posts")
        .select("id,user_id,visibility,is_deleted,is_hidden,publishing_state")
        .eq("id", body.post_id).eq("user_id", owner).maybeSingle();
      if (postError || !post || post.publishing_state !== "draft" ||
          post.is_deleted !== false || post.is_hidden !== true ||
          !["followers","friends","only_me"].includes(post.visibility))
        return reply(404, { error: "Asset unavailable" });
      const cloud = Deno.env.get("CLOUDINARY_CLOUD_NAME");
      const apiKey = Deno.env.get("CLOUDINARY_API_KEY");
      const apiSecret = Deno.env.get("CLOUDINARY_API_SECRET");
      if (cloud !== "duzyf1kda" || !apiKey || !apiSecret)
        return reply(503, { error: "Registration unavailable" });
      const { v2: cloudinary } = await import("npm:cloudinary@2.5.1");
      cloudinary.config({ cloud_name: cloud, api_key: apiKey, api_secret: apiSecret, secure: true });
      const asset = await cloudinary.api.resource(body.public_id, {
        resource_type: body.resource_type, type: "authenticated"
      });
      const formats = body.resource_type === "image"
        ? ["jpg","jpeg","png","webp","avif","gif"] : ["mp4","webm","mov","m4v"];
      if (!asset || asset.asset_id !== body.asset_id || asset.public_id !== body.public_id ||
          asset.resource_type !== body.resource_type || asset.type !== "authenticated" ||
          asset.placeholder || asset.deleted ||
          (Array.isArray(asset.access_control) &&
            asset.access_control.some(rule => rule?.access_type === "anonymous")) ||
          !Number.isSafeInteger(asset.bytes) || asset.bytes <= 0 || asset.bytes > 50 * 1024 * 1024 ||
          typeof asset.format !== "string" || !formats.includes(asset.format))
        return reply(404, { error: "Asset unavailable" });
      const { data, error } = await db.rpc("protected_publish_transition", {
        p_owner: owner, p_post: body.post_id, p_action: "register",
        p_data: { slot: body.slot, public_id: body.public_id,
          cloudinary_asset_id: body.asset_id, resource_type: body.resource_type, format: asset.format }
      });
      return error ? reply(409, { error: "Registration unavailable" }) : reply(201, data);
    }
    if (body.action === "visibility") {
      if (verification) return reply(400, { error: "Create a separate verification post for each audience" });
      if (!["followers", "friends", "only_me"].includes(body.visibility))
        return reply(400, { error: "Restricted audience required" });
      const { data, error } = await db.rpc("set_new_protected_visibility", {
        p_owner: owner, p_post: body.post_id, p_visibility: body.visibility
      });
      return error ? reply(409, { error: "Visibility transition unavailable" }) : reply(200, data);
    }
    if (body.action === "cancel") {
      // The existing database transition atomically marks the owned draft
      // failed and queues its upload intents for later Cloudinary cleanup.
      // Do not report that remote assets were deleted.
      const { data, error } = await db.rpc("protected_publish_transition", {
        p_owner: owner, p_post: body.post_id, p_action: "cancel", p_data: {}
      });
      return error ? reply(409, { error: "Draft cancellation unavailable" }) :
        reply(200, { ...data, cleanupPending: true });
    }
    return reply(503, { error: "Publishing action not migrated" });
  } catch {
    return reply(503, { error: "Protected publishing unavailable" });
  }
});

