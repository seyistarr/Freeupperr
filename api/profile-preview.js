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
  const freeupperId = normalizeId(
    req.query?.freeupper_id || ''
  );

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

  const displayName =
    cleanText(profile.display_name, 80) ||
    cleanText(profile.username, 80) ||
    'FreeUpper User';

  const username = cleanText(
    profile.username || profile.display_username || '',
    80
  );

  const bio = cleanText(
    profile.bio ||
      `Connect with ${displayName} on FreeUpper.`,
    180
  );

  const title = username
    ? `${displayName} (@${username}) • FreeUpper`
    : `${displayName} • FreeUpper`;

  const profileUrl =
    `${SITE_URL}/u/${encodeURIComponent(profile.freeupper_id)}`;

  const imageUrl =
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

  <title>${safeTitle}</title>

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
<body style="font-family:system-ui,sans-serif;max-width:680px;margin:8vh auto;padding:24px;line-height:1.6">
  <main>
    <h1>${escapeHtml(displayName)}</h1>
    ${username ? `<p>@${escapeHtml(username)}</p>` : ''}
    <p>${safeDescription}</p>
    <p><a href="${escapeHtml(profilePage)}">Open in FreeUpper</a></p>
  </main>
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
