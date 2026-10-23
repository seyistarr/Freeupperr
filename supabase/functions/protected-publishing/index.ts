// FreeUpper Privacy V2 — isolated Edge migration entrypoint.
// The existing Node implementation is the source of truth until its ownership,
// reservation, registration, visibility, cleanup and Cloudinary validation paths
// have been ported and regression-tested. Fail closed; never issue signatures.
Deno.serve((_req: Request) => new Response(JSON.stringify({
  error: "Protected publishing Edge migration is not enabled"
}), {status: 503, headers: {
  "Content-Type": "application/json",
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Vary": "Authorization",
  "X-Content-Type-Options": "nosniff"
}}));
