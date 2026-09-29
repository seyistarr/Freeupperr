const SUPABASE_URL = 'https://jmjtqidirpmnegzvmiaq.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const SITE_URL = 'https://freeupper.vercel.app';
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
    return res.redirect(302, '/profile.html');
  }

  let profile = null;

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

    if (response.ok) {
      const data = await response.json();
      profile = Array.isArray(data) ? data[0] : data;
    }
  } catch (error) {
    console.error('Profile preview lookup failed:', error);
  }

  if (!profile) {
    return res.redirect(
      302,
      `/profile.html?freeupper_id=${encodeURIComponent(freeupperId)}`
    );
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

  <meta
    http-equiv="refresh"
    content="0;url=${escapeHtml(profilePage)}"
  >
</head>

<body>
  <p>
    Opening
    <a href="${escapeHtml(profilePage)}">
      ${safeTitle}
    </a>
  </p>

  <script>
    window.location.replace(
      ${JSON.stringify(profilePage)}
    );
  </script>
</body>
</html>`;

  res.setHeader(
    'Cache-Control',
    'public, s-maxage=300, stale-while-revalidate=3600'
  );

  res.setHeader(
    'Content-Type',
    'text/html; charset=utf-8'
  );

  return res.status(200).send(html);
}
