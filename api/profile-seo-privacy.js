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
