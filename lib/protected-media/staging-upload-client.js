// Privacy V2 isolated-staging protected upload client.
// Used only by the isolated staging publisher. Never return Cloudinary delivery URLs.
const STAGING_SIGNATURE = '/api/privacy-v2-upload-signature';
const STAGING_REGISTER = '/api/privacy-v2-register-asset';
const MAX_BYTES = 50 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ASSET_ID = /^[a-f0-9]{32}$/i;
const MEDIA_TYPE = /^(image|video)\/[a-z0-9][a-z0-9.+-]*(?:\s*;.*)?$/;
function supportedFile(file) {
  return file && typeof file.type === 'string' && MEDIA_TYPE.test(file.type);
}

async function jsonResponse(response) {
  if (!response.ok) throw new Error('Protected media operation unavailable');
  return response.json();
}

/**
 * Upload an image/video with a server-issued authenticated Cloudinary signature
 * and register it against a pre-existing restricted post in isolated staging.
 * The server verifies ownership, visibility and Cloudinary asset metadata.
 *
 * @param {{file:File,postId:string,accessToken:string,signal?:AbortSignal}} input
 * @returns {Promise<{assetId:string,status:string}>} Registry identifier only.
 */
export async function uploadProtectedStagingAsset({ file, postId, accessToken, signal, draft = false, slot } = {}) {
  if (!supportedFile(file) ||
      !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_BYTES ||
      !UUID.test(postId || '') || typeof accessToken !== 'string' || !accessToken.trim()) {
    throw new Error('Invalid protected media upload');
  }
  const authorization = { Authorization: `Bearer ${accessToken.trim()}` };
  const signed = await jsonResponse(await fetch(STAGING_SIGNATURE, {
    method: 'POST', headers: { ...authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify(draft ? { post_id: postId, slot } : {}),
    cache: 'no-store', credentials: 'omit', redirect: 'error', signal
  }));
  if (signed.cloud_name !== 'sxdcqs5x' || !signed.api_key ||
      !signed.signature || !signed.timestamp || !signed.folder ||
      !/^asset_[a-f0-9]{32}$/.test(signed.public_id || '') ||
      signed.type !== 'authenticated' || signed.overwrite !== false) {
    throw new Error('Invalid protected upload authorization');
  }
  const resourceType = file.type.startsWith('video/') ? 'video' : 'image';
  const form = new FormData();
  form.append('file', file);
  for (const key of ['api_key', 'timestamp', 'folder', 'public_id', 'type', 'signature']) {
    form.append(key, String(signed[key]));
  }
  form.append('overwrite', 'false');
  const uploaded = await jsonResponse(await fetch(
    `https://api.cloudinary.com/v1_1/${signed.cloud_name}/${resourceType}/upload`,
    { method: 'POST', body: form, credentials: 'omit', cache: 'no-store', redirect: 'error', signal }
  ));
  const expectedPublicId = `${signed.folder}/${signed.public_id}`;
  if (uploaded.public_id !== expectedPublicId || uploaded.type !== 'authenticated' ||
      uploaded.resource_type !== resourceType || !ASSET_ID.test(uploaded.asset_id || '')) {
    throw new Error('Protected media upload verification failed');
  }
  const registered = await jsonResponse(await fetch(STAGING_REGISTER, {
    method: 'POST',
    headers: { ...authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      post_id: postId, public_id: uploaded.public_id,
      asset_id: uploaded.asset_id, resource_type: resourceType, ...(draft ? { slot } : {})
    }),
    credentials: 'omit', cache: 'no-store', redirect: 'error', signal
  }));
  if (!UUID.test(registered.asset_id || '') || registered.status !== 'ready') {
    throw new Error('Protected media registration verification failed');
  }
  return { assetId: registered.asset_id, status: 'ready' };
}


/**
 * Stage a post's complete image/video set using authenticated delivery.
 * Each file must be registered before the caller may consider the media ready.
 * Partial failures are reported as failures, not silently published as Public.
 * The caller must not publish or expose the post until every asset is ready.
 *
 * This does NOT create posts or revoke already uploaded Cloudinary assets.
 * If a batch fails, server-side cleanup of any completed registrations is
 * required before discarding the draft.
 */
export async function uploadProtectedStagingMediaSet({ files, postId, accessToken, signal, draft = false } = {}) {
  validateProtectedStagingMediaSet({ files, postId, accessToken });
  files = [...files];
  const registered = [];
  try {
    for (let slot = 0; slot < files.length; slot++) {
      if (signal?.aborted) throw new Error('Protected upload cancelled');
      registered.push(await uploadProtectedStagingAsset({ file: files[slot], postId, accessToken, signal, draft, slot }));
    }
    return { postId, assets: registered, status: 'ready' };
  } catch (error) {
    const failure = new Error('Protected media set incomplete; do not publish this post');
    failure.cause = error;
    failure.registeredAssetIds = registered.map(item => item.assetId);
    throw failure;
  }
}

export function validateProtectedStagingFiles(files) {
  if (!Array.isArray(files) || files.length < 1 || files.length > 20) {
    throw new Error('Protected media set must contain 1–20 files');
  }
  files = Array.from(files); // Include sparse entries: a missing file must reject before any request.
  if (files.some(file => !supportedFile(file))) {
    throw new Error('Unsupported protected media type');
  }
  const videos = files.filter(file => file.type.startsWith('video/'));
  if (videos.length > 1 || (videos.length === 1 && files.length !== 1)) {
    throw new Error('Upload either one video or up to 20 images');
  }
  if (files.some(file => !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_BYTES)) {
    throw new Error('Every protected file must contain 1 byte to 50 MiB');
  }
}

export function validateProtectedStagingMediaSet({ files, postId, accessToken } = {}) {
  validateProtectedStagingFiles(files);
  if (typeof postId !== 'string' || !UUID.test(postId) ||
      typeof accessToken !== 'string' || !accessToken.trim()) {
    throw new Error('A valid post ID and access token are required');
  }
}
