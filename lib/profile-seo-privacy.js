// Shared privacy rules for public profile SEO and previews.
// Never expose email addresses from profile fields in crawler-facing metadata.
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
export function redactEmails(value = '') {
  return String(value ?? '').replace(EMAIL, '[email removed]');
}
export function publicName(value = '') {
  const raw = String(value ?? '').trim();
  return !raw || /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(raw)
    ? 'FreeUpper Member'
    : raw;
}
export function publicHandle(value = '') {
  const raw = String(value ?? '').trim();
  return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(raw) ? '' : raw;
}


// The isolated reader has no crawler-visible posts. Do not send its requests to
// the legacy production-only SEO RPCs, even when staging keys are configured.
export function blockIsolatedStagingSeo(res, env = process.env) {
  if (env.VERCEL_ENV !== 'preview' || env.VERCEL_GIT_COMMIT_REF !== 'feature/post-privacy-v2-integration') return false;
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.status(404).end();
  return true;
}
