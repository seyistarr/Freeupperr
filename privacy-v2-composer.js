// FreeUpper Privacy V2: authenticated protected-image publishing.
// Never use the public Cloudinary uploader or public media URLs here.
(function () {
  'use strict';
  const EDGE_PUBLISHING = 'https://jmjtqidirpmnegzvmiaq.supabase.co/functions/v1/protected-publishing';
  async function request(path, token, payload) {
    // Publishing/signing/registration are served by the production Edge Function.
    // Its server-side release gates remain authoritative.
    path = EDGE_PUBLISHING;
    const response = await fetch(path, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), credentials: 'same-origin', cache: 'no-store'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Protected publishing unavailable');
    return data;
  }
  async function token() {
    const client = window.sb;
    if (!client?.auth?.getSession) throw new Error('Authentication is not ready');
    const { data, error } = await client.auth.getSession();
    if (error || !data?.session?.access_token) throw new Error('Sign in again to publish');
    return data.session.access_token;
  }
  async function videoPoster(file) {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.playsInline = true;
    try {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Video thumbnail timed out')), 15000);
        video.onloadeddata = () => { clearTimeout(timeout); resolve(); };
        video.onerror = () => { clearTimeout(timeout); reject(new Error('Video cannot be decoded')); };
        video.src = url;
      });
      if (!video.videoWidth || !video.videoHeight) throw new Error('Video has no frame');
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 960 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
      if (!blob) throw new Error('Cannot create video thumbnail');
      return new File([blob], 'protected-video-poster.jpg', { type: 'image/jpeg' });
    } finally {
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
    }
  }
  async function publish({ audience, title, content, tags, commentsHidden, media, onProgress }) {
    if (!['followers', 'friends', 'only_me'].includes(audience)) throw new Error('Invalid audience');
    const video = Array.isArray(media) && media.length === 1 && media[0]?.type === 'video';
    if (!Array.isArray(media) || !media.length || media.length > 20 ||
        media.some(m => !m.protectedFile || !['image', 'video'].includes(m.type) ||
          !m.protectedFile.type.startsWith(m.type + '/')) ||
        (media.some(m => m.type === 'video') && !video)) {
      throw new Error('Choose up to 20 images or one video');
    }
    const bearer = await token();
    const poster = video ? await videoPoster(media[0].protectedFile) : null;
    const uploadFiles = media.map(m => ({ file: m.protectedFile, type: m.type }));
    if (poster) uploadFiles.push({ file: poster, type: 'image', slot: 20 });
    let draftId;
    try {
      const draft = await request('/api/privacy-v2-publish', bearer, {
        action: 'create', visibility: audience, media_types: media.map(m => m.type),
        fields: { title, content, tags, commentsHidden, source: 'composer' }
      });
      draftId = draft.id;
      if (!draftId) throw new Error('Draft creation failed');
      for (let index = 0; index < uploadFiles.length; index++) {
        const entry = uploadFiles[index];
        const slot = entry.slot ?? index;
        const signed = await request('/api/privacy-v2-upload-signature', bearer, {
          action: 'sign', post_id: draftId, slot
        });
        const upload = new FormData();
        upload.append('file', entry.file);
        for (const key of ['api_key', 'timestamp', 'folder', 'public_id', 'type', 'overwrite', 'signature']) {
          if (signed[key] != null) upload.append(key, String(signed[key]));
        }
        const resourceUrl = 'https://api.cloudinary.com/v1_1/' +
          encodeURIComponent(signed.cloud_name) + '/' + entry.type + '/upload';
        const result = await fetch(resourceUrl, { method: 'POST', body: upload, cache: 'no-store' });
        const asset = await result.json().catch(() => ({}));
        if (!result.ok || !asset.asset_id || !asset.public_id ||
            asset.type !== 'authenticated' || asset.resource_type !== entry.type) {
          throw new Error('Protected media upload failed');
        }
        await request('/api/privacy-v2-register-asset', bearer, {
          action: 'register', post_id: draftId, slot, public_id: asset.public_id,
          asset_id: asset.asset_id, resource_type: entry.type
        });
        onProgress?.(index + 1, uploadFiles.length);
      }
      return await request('/api/privacy-v2-publish', bearer, {
        action: 'publish', post_id: draftId
      });
    } catch (error) {
      if (draftId) {
        // A lost publish response must not cause cancellation of a committed post.
        const status = await request('/api/privacy-v2-publish', bearer,
          { action: 'status', post_id: draftId }).catch(() => null);
        if (status?.status === 'published') return status;
        await request('/api/privacy-v2-publish', bearer,
          { action: 'cancel', post_id: draftId }).catch(() => {});
      }
      throw error;
    }
  }
  window.FreeUpperProtectedPublish = { publish };
})();
