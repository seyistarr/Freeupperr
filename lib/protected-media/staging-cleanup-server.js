import { randomUUID, timingSafeEqual } from 'node:crypto';

export function validCleanupWorker(authorization, secret) {
  if (typeof secret !== 'string' || secret.length < 32) return false;
  const supplied = /^Bearer ([^\s]+)$/i.exec(authorization || '')?.[1] || '';
  const left = Buffer.from(supplied), right = Buffer.from(secret);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function cleanupStagingDraft({ db, cloudinary, ownerId, postId, expiredOnly = false, namespace = 'freeupper-privacy-v2-staging' }) {
  if (!['freeupper-privacy-v2-staging','freeupper-protected-v2'].includes(namespace)) throw Error('Cleanup namespace unavailable');
  const lease = randomUUID();
  const { data: claim, error } = await db.rpc('claim_protected_cleanup', {
    p_owner: ownerId, p_post: postId, p_lease: lease, p_expired_only: expiredOnly
  });
  if (error || !claim) throw new Error('Cleanup unavailable');
  if (!claim.claimed) return { id: postId, status: claim.status, cleanupPending: claim.status !== 'published' };
  const prefix = namespace + '/' + ownerId + '/asset_';
  const results = [];
  for (const intent of claim.intents || []) {
    let ok = false;
    if (typeof intent.cloudinary_public_id === 'string' && intent.cloudinary_public_id.startsWith(prefix) &&
        /^[a-f0-9]{32}$/.test(intent.cloudinary_public_id.slice(prefix.length))) {
      try {
        // A signature cannot bind resource_type. Remove wrong-type orphan uploads
        // too, always under this persisted owner-scoped ID and authenticated type.
        const outcomes = await Promise.all(['image', 'video', 'raw'].map(resource_type =>
          cloudinary.uploader.destroy(intent.cloudinary_public_id, { resource_type, type: 'authenticated', invalidate: true })));
        ok = outcomes.every(result => ['ok', 'not found'].includes(result?.result));
      } catch (_) { /* Keep the intent pending for a backoff/replay-window retry. */ }
    }
    results.push({ id: intent.id, ok });
  }
  const { data: recorded, error: recordError } = await db.rpc('record_protected_cleanup', {
    p_owner: ownerId, p_post: postId, p_lease: lease, p_results: results
  });
  if (recordError || !recorded) throw new Error('Cleanup retry pending');
  return recorded;
}

export async function sweepStagingDrafts({ db, cloudinary, namespace = 'freeupper-privacy-v2-staging' }) {
  const { data: candidates, error } = await db.rpc('protected_cleanup_candidates', { p_limit: 3 });
  if (error || !Array.isArray(candidates)) throw new Error('Cleanup scan unavailable');
  let processed = 0, pending = 0;
  for (const draft of candidates) {
    try {
      const result = await cleanupStagingDraft({ db, cloudinary, ownerId: draft.owner_id, postId: draft.id, expiredOnly: true, namespace });
      processed++; if (result.cleanupPending) pending++;
    } catch (_) { pending++; }
  }
  return { processed, pending };
}
