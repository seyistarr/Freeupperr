// Review-branch authorization helper for protected FreeUpper media.
// Does not issue URLs; callers must independently verify JWT and asset ownership.
export function canViewProtectedMedia({ viewerId, authorId, visibility, authorPrivate, authorSuspended, isDeleted, isHidden, followsAuthor, authorFollowsViewer }) {
  if (!authorId || authorSuspended !== false || typeof authorPrivate !== 'boolean' || isDeleted !== false || isHidden !== false) return false;
  if (viewerId && viewerId === authorId) return true;
  if (visibility === 'only_me') return false;
  if (visibility === 'public' && authorPrivate === false) return true;
  if (!viewerId || !followsAuthor) return false;
  if (visibility === 'public' || visibility === 'followers') return true;
  return visibility === 'friends' && !!authorFollowsViewer;
}
