import { authorizeApprovedAsset } from './approved-asset-access.js';

// Production authorization adapter. No public HTTP route imports this yet.
// Never rely on a historical follows.active row for approval.
// Staging/legacy access is intentionally not wired into the release branch.
export async function authorizeProtectedMedia({ db, asset, viewerId, production = false } = {}) {
  if (production !== true) return false;
  return authorizeApprovedAsset({ db, asset, viewerId });
}
