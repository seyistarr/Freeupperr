// Imported only by the exact isolated-staging publishing API after getUser().
export async function legacyOwnerRequest({ db, owner, body }) {
  const { data, error } = await db.rpc('legacy_owner_consent', {
    p_owner: owner, p_post: body.post_id, p_action: body.action,
    p_visibility: body.visibility || null, p_acknowledge: body.acknowledge === true
  });
  if (error || !data) return { status: 409, data: { error: 'Owner consent unavailable; migration may require operator recovery' } };
  return { status: 200, data };
}
