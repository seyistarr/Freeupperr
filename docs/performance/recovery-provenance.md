# Cache reconciliation recovery provenance

The 2026-11-16 executor accepts shell commands again, but its workspace was reset.
The earlier local-only feature SHA `7b2db6eabbf02898dcb1b07be0a5d73fba7429e4`
and its three commits were never pushed. They are absent from the fresh clone;
a direct authorized fetch returns `upload-pack: not our ref`.

This recovery branch reconstructs the recorded cache release, worker, lifecycle,
Search state, offline page and listener adjustment on the original baseline
`8417d0deaa3829f47eaa140cf19b0c9fbaddbd53`. It is NOT the original commit object
or an exact historical archive. Historical test counts are not evidence for this
reconstruction. Fresh reconciliation/build/test results must be reported.

A merge-tree simulation against freshly fetched main is recorded separately.
The actual implementation is reconciled on a dedicated integration branch rooted
at current main, preserving recent functionality. No merge to main or remote
publication is performed. No production settings/workflows are edited.
