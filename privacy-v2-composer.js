// FreeUpper Privacy V2: authenticated protected-image publishing.
// Never use the public Cloudinary uploader or public media URLs here.
(function () {
  'use strict';
  const EDGE_PUBLISHING = 'https://api.freeupper.com/functions/v1/protected-publishing';
  async function request(token, payload) {
    // Publishing/signing/registration are served by the production Edge Function.
    // Its server-side release gates remain authoritative.
    const response = await fetch(EDGE_PUBLISHING, {
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
        video.load();
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
      video.onloadeddata = null;
      video.onerror = null;
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
    }
  }
  async function publish({ audience, title, content, tags, commentsHidden, media, source = 'composer', textTemplateId, onProgress }) {
    if (!['followers', 'friends', 'only_me'].includes(audience)) throw new Error('Invalid audience');
    if (!['composer', 'studio'].includes(source)) throw new Error('Invalid publishing source');
    const text = Array.isArray(media) && media.length === 0 && !!String(content || title || '').trim();
    const video = Array.isArray(media) && media.length === 1 && media[0]?.type === 'video';
    if (!Array.isArray(media) || (!media.length && !text) || media.length > 20 ||
        media.some(m => !(m.protectedFile instanceof Blob) || !['image', 'video'].includes(m.type) ||
          !m.protectedFile.type.startsWith(m.type + '/') || m.protectedFile.size <= 0 ||
          m.protectedFile.size > 50 * 1024 * 1024) ||
        (media.some(m => m.type === 'video') && !video)) {
      throw new Error('Choose up to 20 images or one video');
    }
    const bearer = await token();
    const { data: beta, error: betaError } = await window.sb.rpc('protected_studio_beta_status');
    if (betaError || beta?.approved !== true || beta?.ready !== true || beta.mode !== 'production') {
      throw new Error('Protected publishing is unavailable for this account');
    }
    if (text) {
      const result = await request(bearer, { action:'text', visibility:audience,
        fields:{title,content,tags,commentsHidden,source,textTemplateId} });
      if (result.status !== 'published') throw new Error('Restricted text publication failed');
      return result;
    }
    const poster = video ? await videoPoster(media[0].protectedFile) : null;
    const uploadFiles = media.map(m => ({ file: m.protectedFile, type: m.type }));
    if (poster) uploadFiles.push({ file: poster, type: 'image', slot: 20 });
    let draftId;
    try {
      const draft = await request(bearer, {
        action: 'create', visibility: audience, media_types: media.map(m => m.type),
        verification: false,
        fields: { title, content, tags, commentsHidden, source }
      });
      draftId = draft.id;
      if (!draftId) throw new Error('Draft creation failed');
      for (let index = 0; index < uploadFiles.length; index++) {
        const entry = uploadFiles[index];
        const slot = entry.slot ?? index;
        const signed = await request(bearer, {
          action: 'sign', post_id: draftId, slot
        });
        if (signed.cloud_name !== 'duzyf1kda' || signed.type !== 'authenticated' ||
            signed.overwrite !== false || !signed.api_key || !signed.signature ||
            !Number.isSafeInteger(signed.timestamp) ||
            !/^freeupper-protected-v2\/[0-9a-f-]{36}$/.test(signed.folder || '') ||
            !/^asset_[0-9a-f]{32}$/.test(signed.public_id || '')) {
          throw new Error('Invalid protected upload signature');
        }
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
            asset.type !== 'authenticated' || asset.resource_type !== entry.type ||
            asset.public_id !== signed.folder + '/' + signed.public_id) {
          throw new Error('Protected media upload failed');
        }
        const registered = await request(bearer, {
          action: 'register', post_id: draftId, slot, public_id: asset.public_id,
          asset_id: asset.asset_id, resource_type: entry.type
        });
        if (registered.status !== 'ready' || !registered.asset_id) throw new Error('Protected registration failed');
        onProgress?.(index + 1, uploadFiles.length);
      }
      const published = await request(bearer, {
        action: 'publish', post_id: draftId
      });
      if (published.status !== 'published' || published.id !== draftId) throw new Error('Publishing confirmation unavailable');
      return published;
    } catch (error) {
      if (draftId) {
        // A lost publish response must not cause cancellation of a committed post.
        const status = await request(bearer,
          { action: 'status', post_id: draftId }).catch(() => null);
        if (status?.status === 'published' && status.id === draftId) return status;
        if (status?.status === 'draft') await request(bearer,
          { action: 'cancel', post_id: draftId }).catch(() => {});
      }
      throw error;
    }
  }
  window.FreeUpperProtectedPublish = {
    publish,
    async verificationList() { return request(await token(), { action: 'verification-list' }); },
    async verificationCleanup(postId) { return request(await token(), { action: 'verification-cleanup', post_id: postId }); }
  };
})();
