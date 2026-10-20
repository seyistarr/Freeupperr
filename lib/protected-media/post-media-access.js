import { canViewProtectedMedia } from './post-media-authorization.js';

// Call only after authenticating the viewer and resolving the asset server-side.
// Missing or failed lookups always deny access.
export async function authorizeProtectedMedia({ db, asset, viewerId }) {
  if (!db || !asset || !viewerId || asset.status !== 'ready' ||
      asset.delivery_type !== 'authenticated' || !asset.post_id) return false;
  const { data: post, error: postError } = await db.from('posts')
    .select('id,user_id,visibility,is_deleted,is_hidden')
    .eq('id', asset.post_id).maybeSingle();
  if (postError || !post || post.user_id !== asset.owner_id) return false;
  const { data: author, error: authorError } = await db.from('profiles')
    .select('id,is_private,suspended').eq('id', post.user_id).maybeSingle();
  if (authorError || !author) return false;
  let followsAuthor = false;
  let authorFollowsViewer = false;
  if (viewerId !== post.user_id) {
    const { data: follow, error: followError } = await db.from('follows')
      .select('follower_id').eq('follower_id', viewerId)
      .eq('following_id', post.user_id).eq('status', 'active').maybeSingle();
    if (followError) return false;
    followsAuthor = !!follow;
    if (post.visibility === 'friends' && followsAuthor) {
      const { data: reverse, error: reverseError } = await db.from('follows')
        .select('follower_id').eq('follower_id', post.user_id)
        .eq('following_id', viewerId).eq('status', 'active').maybeSingle();
      if (reverseError) return false;
      authorFollowsViewer = !!reverse;
    }
  }
  return canViewProtectedMedia({
    viewerId, authorId: post.user_id, visibility: post.visibility,
    authorPrivate: author.is_private, authorSuspended: author.suspended,
    isDeleted: post.is_deleted, isHidden: post.is_hidden,
    followsAuthor, authorFollowsViewer
  });
}
