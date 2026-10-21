import { uploadProtectedStagingMediaSet, uploadProtectedStagingAsset,
  validateProtectedStagingFiles } from './staging-upload-client.js';

const ENDPOINT = '/api/privacy-v2-publish';
export async function publishingRequest(action, body, accessToken, signal) {
  const response = await fetch(ENDPOINT, {
    method: 'POST', headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, action }), cache: 'no-store', credentials: 'omit', redirect: 'error', signal
  });
  if (!response.ok) throw new Error('Protected draft operation unavailable');
  return response.json();
}

// Generate a poster locally. Never request a public Cloudinary transformation.
export function protectedVideoThumbnail(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    let finished = false;
    const timer = setTimeout(() => finish(null), 20000);
    function finish(blob) {
      if (finished) return; finished = true;
      clearTimeout(timer); video.onloadeddata = video.onerror = null;
      video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url);
      if (blob?.size) resolve(blob); else reject(new Error('Could not prepare a protected video thumbnail'));
    }
    video.muted = true; video.preload = 'auto'; video.playsInline = true;
    video.onerror = () => finish(null);
    video.onloadeddata = () => {
      try {
        const canvas = document.createElement('canvas');
        const ratio = Math.min(1, 960 / Math.max(video.videoWidth, video.videoHeight));
        canvas.width = Math.max(1, Math.round(video.videoWidth * ratio));
        canvas.height = Math.max(1, Math.round(video.videoHeight * ratio));
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        video.onloadeddata = null;
        canvas.toBlob(finish, 'image/jpeg', 0.85);
      } catch (_) { finish(null); }
    };
    video.src = url;
  });
}

export async function publishProtectedStagingPost({ fields, files, accessToken, thumbnailFile, signal, cloudName = 'sxdcqs5x' } = {}) {
  // Validate the entire set before creating even a draft, much less an upload.
  validateProtectedStagingFiles(files);
  if (typeof accessToken !== 'string' || !accessToken.trim()) throw new Error('Staging authentication required');
  files = [...files];
  if (!['followers', 'friends', 'only_me'].includes(fields?.visibility)) throw new Error('Restricted audience required');
  const types = files.map(file => file.type.startsWith('video/') ? 'video' : 'image');
  if (types[0] === 'video') {
    thumbnailFile ||= await protectedVideoThumbnail(files[0]);
    validateProtectedStagingFiles([thumbnailFile]);
    if (!thumbnailFile.type.startsWith('image/')) throw new Error('A protected image thumbnail is required');
  }
  const draft = await publishingRequest('create', { fields, visibility: fields.visibility, media_types: types }, accessToken, signal);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(draft.id || '') || draft.status !== 'draft') {
    throw new Error('Invalid protected draft');
  }
  let publishAttempted = false;
  try {
    await uploadProtectedStagingMediaSet({ files, postId: draft.id, accessToken, signal, draft: true, cloudName });
    if (types[0] === 'video') await uploadProtectedStagingAsset({ file: thumbnailFile, postId: draft.id,
      accessToken, signal, draft: true, slot: 20, cloudName });
    publishAttempted = true;
    const result = await publishingRequest('publish', { post_id: draft.id }, accessToken, signal);
    if (result.status !== 'published' || result.id !== draft.id) throw new Error('Publication unconfirmed');
    return result;
  } catch (cause) {
    if (publishAttempted) {
      // A lost final response must not trigger destructive rollback of a committed post.
      try {
        const status = await publishingRequest('status', { post_id: draft.id }, accessToken);
        if (status.status === 'published') return status;
      } catch (_) { /* Cancellation below is serialized and refuses published posts. */ }
    }
    let cleanupPending = true;
    try {
      const cancelled = await publishingRequest('cancel', { post_id: draft.id }, accessToken);
      cleanupPending = cancelled.cleanupPending;
    } catch (_) { /* Hidden draft and durable upload intents remain available for cleanup retry. */ }
    const error = new Error('Protected publishing did not complete. Draft ' + draft.id + ' requires review before retrying.');
    error.cause = cause; error.postId = draft.id; error.cleanupPending = cleanupPending;
    throw error;
  }
}
