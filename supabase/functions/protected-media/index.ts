// FreeUpper Privacy V2 — isolated Edge migration entrypoint.
// Fail closed until the existing Node media registry, production RPC authorization,
// Cloudinary expiring download and range-streaming controls are ported and tested.
// Do not turn on routing to this function until acceptance is complete.
Deno.serve((_req: Request) => new Response(JSON.stringify({
  error: "Protected media Edge migration is not enabled"
}), {status: 503, headers: {
  "Content-Type": "application/json",
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Vary": "Authorization",
  "X-Content-Type-Options": "nosniff"
}}));
