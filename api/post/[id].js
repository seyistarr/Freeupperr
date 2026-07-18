// api/post/[id].js
// This serverless function serves a dynamic HTML page with Open Graph meta tags
// for social sharing (WhatsApp, Facebook, Twitter, etc.).
// It also redirects users to the actual video player page.

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  // 1. Extract post ID from the URL path
  const { id } = req.query;

  // 2. Validate the ID
  if (!id || typeof id !== 'string') {
    return res.status(400).send('Missing or invalid post ID');
  }

  // 3. Get Supabase credentials from environment variables
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('Supabase credentials are missing. Set SUPABASE_URL and SUPABASE_ANON_KEY.');
    return res.status(500).send('Server configuration error');
  }

  // 4. Create Supabase client
  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  // 5. Fetch the post and its author profile
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

  // 6. Handle post not found
  if (error || !post) {
    console.error('Post fetch error:', error?.message || 'Post not found');
    return res.status(404).send('Post not found');
  }

  // 7. Build the metadata
  const title = post.title || 'Watch this video on Freeupper';
  const description = post.description || 'A video shared on Freeupper';
  const image = post.thumbnail_url || post.media_url || 'https://freeupper.vercel.app/freeupper.png';
  const url = `https://freeupper.vercel.app/post/${id}`;
  const authorName = post.profiles?.display_name || 'Anonymous';
  const authorUsername = post.profiles?.username || '';
  const verifiedStatus = post.profiles?.verified_status || 'none';

  // 8. Generate the HTML page with dynamic OG meta tags
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)} · Freeupper</title>

  <!-- Open Graph / Social Media -->
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

  <!-- Redirect to the actual video player page -->
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
    // Fallback redirect if meta refresh fails
    window.location.href = '/video.html?post=${encodeURIComponent(id)}';
  </script>
</body>
</html>
  `;

  // 9. Send the HTML response
  res.setHeader('Content-Type', 'text/html');
  res.status(200).send(html);
}

// Helper: escape HTML entities to prevent injection
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}