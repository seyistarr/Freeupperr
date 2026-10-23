// FreeUpper production protected-media Edge handler.
// Production stays disabled until protected_first_release_status().delivery is true.
// Secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
// CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.
// Cloudinary SDK uses the same authenticated private_download_url API as Vercel.
import { createClient } from "npm:@supabase/supabase-js@2.57.0";
import { v2 as cloudinary } from "npm:cloudinary@2.5.1";

const json = (status: number, error: string) => new Response(JSON.stringify({ error }), {
  status, headers: { "Content-Type": "application/json", ...SECURE }
});
const SECURE = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff",
  "Vary": "Authorization",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMIT = 50 * 1024 * 1024;
Deno.serve(async (req: Request) => {
  if (req.method !== "GET") return json(405, "Method not allowed");
  const url = new URL(req.url);
  const assetId = url.searchParams.get("asset_id") || "";
  const token = /^Bearer ([^\s]+)$/i.exec(req.headers.get("Authorization") || "")?.[1];
  if (!UUID.test(assetId) || !token) return json(404, "Media unavailable");
  const env = Object.fromEntries([
    "SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY",
    "CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"
  ].map(k => [k, Deno.env.get(k) || ""]));
  if (Object.values(env).some(v => !v) || env.CLOUDINARY_CLOUD_NAME !== "duzyf1kda" ||
      env.SUPABASE_URL !== "https://jmjtqidirpmnegzvmiaq.supabase.co") {
    return json(503, "Protected media unavailable");
  }
  try {
    const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: release, error: releaseError } = await admin.rpc("protected_first_release_status");
    if (releaseError || release?.version !== 1 || release?.delivery !== true ||
        release?.legacy_conversion !== false) return json(503, "Protected media unavailable");
    const auth = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: identity, error: identityError } = await auth.auth.getUser(token);
    if (identityError || !identity?.user?.id) return json(404, "Media unavailable");
    const { data: asset, error: assetError } = await admin.from("post_media_assets")
      .select("id,post_id,owner_id,cloudinary_public_id,resource_type,format,delivery_type,status")
      .eq("id", assetId).eq("status", "ready").maybeSingle();
    if (assetError || !asset || !asset.post_id || !asset.owner_id ||
        asset.delivery_type !== "authenticated" ||
        !["image", "video"].includes(asset.resource_type) ||
        !/^[A-Za-z0-9_/-]{1,255}$/.test(asset.cloudinary_public_id || "") ||
        !/^[a-z0-9]{2,8}$/.test(asset.format || "") ||
        !(asset.resource_type === "image" ? ["jpg","jpeg","png","webp","avif","gif"] :
          ["mp4","webm","mov","m4v"]).includes(asset.format)) return json(404, "Media unavailable");
    const { data: allowed, error: accessError } = await admin.rpc("authorize_protected_asset", {
      p_asset: asset.id, p_viewer: identity.user.id
    });
    if (accessError || allowed !== true) return json(404, "Media unavailable");
    cloudinary.config({ cloud_name: env.CLOUDINARY_CLOUD_NAME,
      api_key: env.CLOUDINARY_API_KEY, api_secret: env.CLOUDINARY_API_SECRET, secure: true });
    const expiry = Math.floor(Date.now() / 1000) + 60;
    const signed = cloudinary.utils.private_download_url(asset.cloudinary_public_id, asset.format, {
      resource_type: asset.resource_type, type: "authenticated", expires_at: expiry, attachment: false
    });
    const upstreamUrl = new URL(signed);
    if (upstreamUrl.protocol !== "https:" || upstreamUrl.hostname !== "api.cloudinary.com" ||
        upstreamUrl.port || upstreamUrl.username || upstreamUrl.password ||
        upstreamUrl.pathname !== `/v1_1/${env.CLOUDINARY_CLOUD_NAME}/${asset.resource_type}/download` ||
        upstreamUrl.searchParams.get("expires_at") !== String(expiry) ||
        !upstreamUrl.searchParams.get("signature")) return json(503, "Protected media unavailable");
    const range = req.headers.get("Range");
    const match = range && /^bytes=(\d+)-(\d*)$/.exec(range);
    if (range && !match) return json(416, "Invalid range");
    if (match) {
      const start = Number(match[1]), end = match[2] ? Number(match[2]) : null;
      if (!Number.isSafeInteger(start) || (end !== null &&
          (!Number.isSafeInteger(end) || end < start || end - start + 1 > LIMIT)))
        return json(416, "Invalid range");
    }
    const upstream = await fetch(signed, {
      method: "GET", redirect: "manual",
      headers: range ? { Range: range } : {},
      signal: AbortSignal.timeout(15000)
    });
    if (![200,206].includes(upstream.status) || !upstream.body ||
        (range && upstream.status !== 206) || (!range && upstream.status !== 200)) {
      await upstream.body?.cancel(); return json(404, "Media unavailable");
    }
    const type = upstream.headers.get("content-type") || "";
    const length = upstream.headers.get("content-length");
    if (!/^(image\/(jpeg|png|webp|avif|gif)|video\/[a-z0-9.+-]+)(\s*;|$)/i.test(type) ||
        (length !== null && (!/^\d+$/.test(length) || Number(length) > LIMIT))) {
      await upstream.body.cancel(); return json(503, "Media unavailable");
    }
    if (range) {
      const parsed = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(upstream.headers.get("content-range") || "");
      const start = Number(match![1]), requestedEnd = match![2] ? Number(match![2]) : null;
      if (!parsed || Number(parsed[1]) !== start || Number(parsed[2]) < start ||
          Number(parsed[3]) <= Number(parsed[2]) ||
          (requestedEnd !== null && Number(parsed[2]) > requestedEnd) ||
          Number(parsed[2]) - start + 1 > LIMIT ||
          (length !== null && Number(length) !== Number(parsed[2]) - start + 1)) {
        await upstream.body.cancel(); return json(503, "Media unavailable");
      }
    }
    let transferred = 0;
    const limited = upstream.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        transferred += chunk.byteLength;
        if (transferred > LIMIT) throw new Error("Media size exceeded");
        controller.enqueue(chunk);
      }
    }));
    const headers = new Headers(SECURE);
    headers.set("Content-Type", type);
    headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
    headers.set("Accept-Ranges", "bytes");
    for (const h of ["content-range","content-length"]) {
      const v = upstream.headers.get(h); if (v) headers.set(h, v);
    }
    return new Response(limited, { status: upstream.status, headers });
  } catch (error) {
    console.error("Protected media Edge delivery failed", error instanceof Error ? error.name : "Error");
    return json(503, "Protected media unavailable");
  }
});
