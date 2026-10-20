import { stagingSession } from './staging-session.js';

export async function mountStagingReader(view) {
  const root = document.createElement('main');
  root.id = 'privacy-staging-reader';
  root.style.cssText = 'position:fixed;inset:0;overflow:auto;z-index:2147483600;background:#101827;color:#fff;padding:24px;font:16px system-ui';
  root.innerHTML = '<h1>FreeUpper · isolated staging</h1><p>Read-only preview. Public posting and production accounts are separate.</p>' +
    '<nav><a href="index.html?privacy_staging=1">Feed</a> · <a href="video.html?privacy_staging=1">Studio</a> · ' +
    '<a href="profile.html?privacy_staging=1">My staging profile</a></nav>' +
    '<form data-login><label>Staging email <input type="email" name="email" autocomplete="off" required></label> ' +
    '<label>Staging password <input type="password" name="password" autocomplete="off" required></label> ' +
    '<button>Sign in</button></form><button data-signout type="button" hidden>Sign out</button>' +
    '<form data-search><label>Search visible posts <input name="q" maxlength="200"></label><button>Search</button></form>' +
    '<p role="status">Sign in to load authorized posts.</p><section data-posts></section><button data-more hidden>Load more</button>';
  document.body.replaceChildren(root);
  const login = root.querySelector('[data-login]'), status = root.querySelector('[role="status"]');
  const postsEl = root.querySelector('[data-posts]'), more = root.querySelector('[data-more]');
  const params = new URLSearchParams(window.location.search);
  let offset = 0, generation = 0;
  const link = (page, key, value) => page + '?privacy_staging=1&' + key + '=' + encodeURIComponent(value);
  function clear() { generation++; offset = 0; postsEl.replaceChildren(); more.hidden = true; }
  async function load(append = false) {
    if (!stagingSession.enabled) { clear(); return; }
    if (!append) clear();
    const run = generation;
    status.textContent = 'Loading authorized posts…';
    try {
      const sharedId = params.get('post');
      let posts;
      if (sharedId) {
        const post = await window.PostsAPI.loadPostById(sharedId); posts = post ? [post] : [];
      } else {
        posts = await window.PostsAPI.loadStagingPosts({
          author_id: view === 'profile' ? params.get('user') || stagingSession.userId : null,
          source: view === 'video' ? 'studio' : null,
          q: root.querySelector('[data-search] input').value.trim(), offset, limit: 10
        });
      }
      if (run !== generation || !stagingSession.enabled) return;
      for (const post of posts) {
        const article = document.createElement('article');
        article.style.cssText = 'max-width:720px;margin:24px auto;padding:20px;border:1px solid #52617a;border-radius:12px';
        const author = document.createElement('a'); author.textContent = post.profile?.display_name || 'Staging member';
        author.href = link('profile.html', 'user', post.user_id); article.appendChild(author);
        const title = document.createElement('h2'); title.textContent = post.title; article.appendChild(title);
        const audience = document.createElement('p'); audience.textContent = 'Audience: ' + post.visibility; article.appendChild(audience);
        const text = document.createElement('p'); text.style.whiteSpace = 'pre-wrap'; text.textContent = post.content; article.appendChild(text);
        if (post.mediaUnavailable) {
          const unavailable = document.createElement('p'); unavailable.textContent = 'Media unavailable'; article.appendChild(unavailable);
        } else for (const item of post.media) {
          const media = document.createElement(item.type === 'video' ? 'video' : 'img');
          media.src = item.url; media.style.cssText = 'display:block;max-width:100%;max-height:75vh;margin:12px auto';
          if (item.type === 'video') { media.controls = true; media.playsInline = true; media.preload = 'metadata'; if (item.thumbnailUrl) media.poster = item.thumbnailUrl; }
          else { media.alt = ''; media.loading = 'lazy'; }
          article.appendChild(media);
        }
        const shared = document.createElement('a'); shared.href = link('video.html', 'post', post.id); shared.textContent = 'Open authenticated link';
        article.appendChild(shared); postsEl.appendChild(article);
      }
      offset += posts.length; more.hidden = !!sharedId || posts.length < 10;
      status.textContent = postsEl.childElementCount ? 'Showing posts authorized for this staging account.' : 'No accessible posts.';
    } catch (_) { if (run === generation) { clear(); status.textContent = 'Posts unavailable. No public fallback was used.'; } }
  }
  try { await stagingSession.configure(); }
  catch (_) { status.textContent = 'Staging is not activated. No production posts were loaded.'; login.hidden = true; return; }
  login.addEventListener('submit', async event => {
    event.preventDefault(); const button = login.querySelector('button'); button.disabled = true;
    try { await stagingSession.signIn(login.elements.email.value.trim(), login.elements.password.value); await load(); }
    catch (_) { clear(); status.textContent = 'Staging sign-in unavailable.'; }
    finally { login.elements.password.value = ''; button.disabled = false; }
  });
  root.querySelector('[data-signout]').addEventListener('click', () => stagingSession.signOut().catch(() => {}));
  root.querySelector('[data-search]').addEventListener('submit', event => { event.preventDefault(); load(); });
  more.addEventListener('click', () => load(true));
  window.addEventListener('privacy-staging-session', () => {
    clear(); login.hidden = stagingSession.enabled; root.querySelector('[data-signout]').hidden = !stagingSession.enabled;
    if (!stagingSession.enabled) status.textContent = 'Signed out. Protected content cleared.';
  });
  if (stagingSession.enabled) await load();
}
