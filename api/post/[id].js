// api/post/[id].js
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).send('Missing post ID');
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Supabase credentials missing');
    return res.status(500).send('Server configuration error');
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  const { data: post, error } = await supabase
    .from('posts')
    .select(`
      id,
      title,
      description,
      thumbnail_url,
      media_url,
      created_at,
      profiles:user_id (
        display_name,
        username,
        avatar_url,
        verified_status
      )
    `)
    .eq('id', id)
    .single();

  if (error || !post) {
    return res.status(404).send('Post not found');
  }

  const siteTitle = 'Freeupper';
  const title = post.title || 'Watch this video on Freeupper';
  const description = post.description || 'A video shared on Freeupper';
  const image = post.thumbnail_url || post.media_url || 'https://freeupper.vercel.app/freeupper.png';
  const url = `https://freeupper.vercel.app/post/${id}`;
  const authorName = post.profiles?.display_name || 'Anonymous';
  const authorUsername = post.profiles?.username || '';
  const verifiedStatus = post.profiles?.verified_status || 'none';

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)} · Freeupper</title>
  <meta property="og:type" content="video.other" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:image" content="${escapeHtml(image)}" />
  <meta property="og:url" content="${escapeHtml(url)}" />
  <meta property="og:site_name" content="Freeupper" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image" content="${escapeHtml(image)}" />
  <meta http-equiv="refresh" content="0; url=/video.html?post=${encodeURIComponent(id)}" />
  <link rel="canonical" href="${escapeHtml(url)}" />
</head>
<body style="margin:0;padding:0;background:#000;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:#fff;flex-direction:column;gap:12px;">
  <img src="${escapeHtml(image)}" alt="Video thumbnail" style="max-width:90%;max-height:60%;border-radius:12px;object-fit:cover;" />
  <div style="text-align:center;max-width:480px;">
    <h1 style="font-size:1.4rem;margin:0;">${escapeHtml(title)}</h1>
    <p style="color:#aaa;margin:6px 0 0;">by ${escapeHtml(authorName)} ${authorUsername ? `(@${escapeHtml(authorUsername)})` : ''}</p>
  </div>
  <p style="color:#888;font-size:0.8rem;margin-top:16px;">Redirecting to Freeupper...</p>
  <script>
    window.location.href = '/video.html?post=${encodeURIComponent(id)}';
  </script>
</body>
</html>
  `;

  res.setHeader('Content-Type', 'text/html');
  res.status(200).send(html);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}