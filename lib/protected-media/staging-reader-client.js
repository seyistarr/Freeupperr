import { stagingSession } from './staging-session.js';
export async function loadStagingRows(options = {}) {
  if (!stagingSession.enabled) return [];
  const viewer = stagingSession.userId;
  const params = new URLSearchParams({ reader: 'posts', ...Object.fromEntries(
    Object.entries(options).filter(([, value]) => value != null && value !== '').map(([key, value]) => [key, String(value)])) });
  const response = await fetch('/api/privacy-v2-publish?' + params, {
    headers: { Authorization: 'Bearer ' + await stagingSession.accessToken() },
    cache: 'no-store', credentials: 'omit', redirect: 'error'
  });
  if (!response.ok) throw new Error('Staging posts unavailable');
  const result = await response.json();
  if (!stagingSession.enabled || stagingSession.userId !== viewer) throw new Error('Staging session changed');
  if (!Array.isArray(result.posts)) throw new Error('Invalid staging response');
  return result.posts.map(row => ({ ...row, __staging: true, media_url: '', thumbnail_url: '' }));
}
