import { publicName, publicHandle, redactEmails } from './profile-seo-privacy.js';
const SUPABASE_URL = 'https://jmjtqidirpmnegzvmiaq.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const SITE_URL = 'https://www.freeupper.com';
const FALLBACK_IMAGE = `${SITE_URL}/freeupper.png`;

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function cleanText(value = '', max = 180) {
  return String(value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function normalizeId(value = '') {
  return String(value)
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '');
}

export default async function handler(req, res) {
  let freeupperId = normalizeId(req.query?.freeupper_id || '');
  const usernameQuery = String(req.query?.username || '').trim().replace(/^@/, '');
  if (usernameQuery) {
    if (!/^[A-Za-z0-9_.]{1,80}$/.test(usernameQuery)) return res.status(404).send('Profile not found');
    if (!SUPABASE_ANON_KEY) return res.status(503).send('Temporarily unavailable');
    try {
      const params = new URLSearchParams({
        select: 'freeupper_id,username',
        username: 'ilike.' + usernameQuery,
        is_private: 'eq.false',
        limit: '2'
      });
      const response = await fetch(SUPABASE_URL + '/rest/v1/profiles?' + params, {
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY }
      });
      if (!response.ok) throw new Error('Username lookup failed: ' + response.status);
      const rows = await response.json();
      const match = rows.find(row => String(row.username).toLowerCase() === usernameQuery.toLowerCase());
      if (!match) return res.status(404).send('Profile not found');
      freeupperId = normalizeId(match.freeupper_id);
    } catch (error) {
      console.error('Profile username lookup failed', error);
      return res.status(503).send('Temporarily unavailable');
    }
  }

  if (!freeupperId) {
    res.setHeader('X-Robots-Tag', 'noindex');
    return res.status(404).send('Profile not found');
  }
  if (!SUPABASE_ANON_KEY) return res.status(503).send('Temporarily unavailable');

  let profile = null;
  let lookupFailed = false;

  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/get_profile_by_freeupper_id`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({
          p_freeupper_id: freeupperId
        })
      }
    );

    if (!response.ok) throw new Error('Profile lookup failed: ' + response.status);
    const data = await response.json();
    profile = Array.isArray(data) ? data[0] : data;
  } catch (error) {
    console.error('Profile preview lookup failed:', error);
    lookupFailed = true;
  }

  if (lookupFailed) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).send('Temporarily unavailable');
  }

  if (!profile || profile.is_private !== false || profile.freeupper_id !== freeupperId) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    return res.status(404).send('Profile unavailable');
  }

  let isSetupComplete = false;
  try {
    const eligibilityResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/get_public_profile_seo_status`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({ p_freeupper_id: freeupperId })
      }
    );
    if (eligibilityResponse.ok) {
      isSetupComplete = (await eligibilityResponse.json()) === true;
    }
  } catch (error) {
    console.error('Profile SEO eligibility lookup failed:', error);
  }
  const isUnverified = !isSetupComplete;
  const displayName = isUnverified ? 'FreeUpper Member' : cleanText(publicName(profile.display_name || profile.username), 80);

  const username = isUnverified ? '' : cleanText(publicHandle(profile.username || profile.display_username || ''), 80);

  const bio = isUnverified ? 'View this profile on FreeUpper.' : cleanText(redactEmails(profile.bio || `Connect with ${displayName} on FreeUpper.`), 180);

  const title = username
    ? `${displayName} (@${username}) • FreeUpper`
    : `${displayName} • FreeUpper`;

  if (!isSetupComplete) res.setHeader('X-Robots-Tag', 'noindex, follow');

  const profileUrl = username && /^[A-Za-z0-9_.]+$/.test(username)
    ? `${SITE_URL}/@${encodeURIComponent(username)}`
    : `${SITE_URL}/u/${encodeURIComponent(profile.freeupper_id)}`;

  const imageUrl = isUnverified ? FALLBACK_IMAGE :
  `${SITE_URL}/api/profile-og?freeupper_id=${encodeURIComponent(
    profile.freeupper_id
  )}&v=2`;

  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(bio);
  const safeUrl = escapeHtml(profileUrl);
  const safeImage = escapeHtml(imageUrl);

  const profilePage =
    `/profile.html?freeupper_id=${encodeURIComponent(
      profile.freeupper_id
    )}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  ${isSetupComplete ? '' : '<meta name="robots" content="noindex, follow">'}

  <title>${safeTitle}</title>\n  <link rel="manifest" href="/manifest.webmanifest">\n  <meta name="theme-color" content="#2e1065">

  <link
    rel="canonical"
    href="${safeUrl}"
  >

  <meta
    name="description"
    content="${safeDescription}"
  >

  <meta
    property="og:type"
    content="profile"
  >
  
  <meta
    property="og:site_name"
    content="FreeUpper"
  >

  <meta
    property="og:title"
    content="${safeTitle}"
  >

  <meta
    property="og:description"
    content="${safeDescription}"
  >

  <meta
    property="og:url"
    content="${safeUrl}"
  >

  <meta
    property="og:image"
    content="${safeImage}"
  >
  <meta
  property="og:image:width"
  content="1200"
>

<meta
  property="og:image:height"
  content="630"
>

<meta
  property="og:image:type"
  content="image/png"
>

  <meta
    property="og:image:alt"
    content="${safeTitle}"
  >

  <meta
    name="twitter:card"
    content="summary_large_image"
  >

  <meta
    name="twitter:title"
    content="${safeTitle}"
  >

  <meta
    name="twitter:description"
    content="${safeDescription}"
  >

  <meta
    name="twitter:image"
    content="${safeImage}"
  >

  <link
    rel="icon"
    type="image/png"
    href="${FALLBACK_IMAGE}"
  >

</head>
<body style="font-family:system-ui,sans-serif;background:#000;color:#fff;margin:0;min-height:100vh;display:grid;place-items:center">
  <main style="text-align:center;padding:24px">
    <p>Opening profile on FreeUpper…</p>
    <p><a style="color:#a78bfa" href="${escapeHtml(profilePage)}">Continue to profile</a></p>
  </main>
  <script>
    // The metadata above stays available to social crawlers.
    // Human visitors should never need to click through an intermediate page.
    window.location.replace(${JSON.stringify(profilePage)});
  </script>
</body>
</html>`;

  res.setHeader(
    'Cache-Control',
    'public, s-maxage=60'
  );

  res.setHeader(
    'Content-Type',
    'text/html; charset=utf-8'
  );

  return res.status(200).send(html);
}
