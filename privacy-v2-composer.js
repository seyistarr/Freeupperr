// FreeUpper Privacy V2: authenticated protected-image publishing.
// Never use the public Cloudinary uploader or public media URLs here.
(function () {
  'use strict';
  async function request(path, token, payload) {
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
  async function publish({ audience, title, content, tags, commentsHidden, media, onProgress }) {
    if (!['followers', 'friends', 'only_me'].includes(audience)) throw new Error('Invalid audience');
    if (!Array.isArray(media) || !media.length || media.length > 20 ||
        media.some(m => !m.protectedFile || !m.protectedFile.type.startsWith('image/'))) {
      throw new Error('Choose protected images before publishing');
    }
    const bearer = await token();
    let draftId;
    try {
      const draft = await request('/api/privacy-v2-publish', bearer, {
        action: 'create', visibility: audience, media_types: media.map(() => 'image'),
        fields: { title, content, tags, commentsHidden, source: 'composer' }
      });
      draftId = draft.id;
      if (!draftId) throw new Error('Draft creation failed');
      for (let slot = 0; slot < media.length; slot++) {
        const signed = await request('/api/privacy-v2-upload-signature', bearer, {
          post_id: draftId, slot
        });
        const upload = new FormData();
        upload.append('file', media[slot].protectedFile);
        for (const key of ['api_key', 'timestamp', 'folder', 'public_id', 'type', 'overwrite', 'signature']) {
          if (signed[key] != null) upload.append(key, String(signed[key]));
        }
        const resourceUrl = 'https://api.cloudinary.com/v1_1/' +
          encodeURIComponent(signed.cloud_name) + '/image/upload';
        const result = await fetch(resourceUrl, { method: 'POST', body: upload });
        const asset = await result.json().catch(() => ({}));
        if (!result.ok || !asset.asset_id || !asset.public_id || asset.type !== 'authenticated') {
          throw new Error('Protected media upload failed');
        }
        await request('/api/privacy-v2-register-asset', bearer, {
          post_id: draftId, slot, public_id: asset.public_id,
          asset_id: asset.asset_id, resource_type: 'image'
        });
        onProgress?.(slot + 1, media.length);
      }
      return await request('/api/privacy-v2-publish', bearer, {
        action: 'publish', post_id: draftId
      });
    } catch (error) {
      if (draftId) {
        // Best effort: the server owns authoritative draft cancellation.
        await request('/api/privacy-v2-publish', bearer,
          { action: 'cancel', post_id: draftId }).catch(() => {});
      }
      throw error;
    }
  }
  window.FreeUpperProtectedPublish = { publish };
})();
