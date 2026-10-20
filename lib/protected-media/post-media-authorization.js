// Authorization decision only. Caller must authenticate viewer and resolve
// post, author, and follower relationships from trusted server-side records.
export function canViewProtectedMedia({ viewerId, authorId, visibility, authorPrivate, authorSuspended, isDeleted, isHidden, followsAuthor, authorFollowsViewer }) {
  if (!authorId || authorSuspended !== false || typeof authorPrivate !== 'boolean' || isDeleted !== false || isHidden !== false) return false;
  if (!['public', 'followers', 'friends', 'only_me'].includes(visibility)) return false;
  if (viewerId && viewerId === authorId) return true;
  if (visibility === 'only_me') return false;
  if (visibility === 'public' && authorPrivate === false) return true;
  if (!viewerId || !followsAuthor) return false;
  if (visibility === 'public' || visibility === 'followers') return true;
  return visibility === 'friends' && !!authorFollowsViewer;
}
