# Publication preflight passed; CI gate pending

Approved base and freshly fetched remote main: `98efce5592466153d0b7f5bf3bd5e458adccb8e5`.

The authorized fixture correction hashes exact raw Git blobs, preserving CRLF.
`search.html` matches the approved base byte-for-byte (SHA-256
`72047c65d128dee5d52bde5ac92c6e7f57164ce413f8c3033fc309436dc84d00`).
The regression test hashes filesystem bytes without line-ending normalization.
The prior failure artifact is retained as historical evidence; the corrected
preservation check passes all four cases without a bypass.

Publication rerun: complete regression 542 passed, 0 failed, 12 optional skips
(554 total, Worker bundle enabled); focused WebKit 21 passed; Chat 11 passed.
Cloudflare frontend build and web/API Wrangler dry-run packaging passed.
No migrations, Supabase operations or production configuration changes are included.

User has authorized publication. The source branch must pass GitHub CI before
merging; the existing main workflow alone performs automatic deployment.
At this snapshot no merge or production deployment has occurred. Final merge,
deployment and read-only smoke results will be reported after the remote gates.
