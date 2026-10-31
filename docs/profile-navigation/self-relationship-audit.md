# Self-relationship audit and cleanup proposal

Production audit on 2026-10-31 found **2 self-follow rows, both active**.
The existing follow RPC already rejects self-follow, but the table had no CHECK
constraint, so direct writes could create invalid edges. `get_suggestions`
already excludes the authenticated user; the client lists and counts did not
exclude historical self-edges. Joining both lists also turned those edges into
self-friends. No production records were deleted or rewritten.

The `prevent_self_relationships` migration adds a NOT VALID CHECK: new inserts
and updates cannot create self-edges; historical rows remain available for review.
Client lists remove the profile owner's own ID and deduplicate IDs. Counts exclude
self-edges in the database query. A legitimate viewer remains visible in another
owner's lists. Server RLS, approved-edge authorization and gateway rules are unchanged.

## Proposed cleanup (separate administrative review)

1. Export the exact self-edge rows to a restricted backup and review provenance,
   related approvals and notification references. Do not publish user IDs here.
2. Re-audit immediately before a maintenance transaction; abort if the reviewed
   row set changed. Explicitly approve any deletion and dependent-record handling.
3. Refresh affected relationship counts and lists after the reviewed cleanup.
4. Validate `follows_no_self_relationship` once the audit returns zero rows.

Read-only audit:

```sql
select count(*) as self_rows,
       count(*) filter (where status='active') as active_self_rows
from public.follows where follower_id=following_id;
```

Rollback of the schema guard, if necessary, is an explicit administrative
`ALTER TABLE public.follows DROP CONSTRAINT follows_no_self_relationship`.
It does not recover historical invalid-row writes and should not accompany a
normal application rollback; the existing RPC already enforces the same rule.

## Verification

The guard was applied to production on 2026-10-31 under migration version
`20261031073211`. Both historical self-edges remain. The CHECK is intentionally
unvalidated until reviewed cleanup; it already enforces new INSERTs and UPDATEs.
RLS remains enabled, and the follows policy checksum is identical before and
after deployment. The security-advisory set did not change.

The available staging project does not contain `public.follows`; the attempted
staging transaction rolled back without changing tables or records. A local
PostgreSQL regression fixture verified historical-row preservation, idempotence,
rejection of self-inserts and self-updates, and normal relationship writes.
