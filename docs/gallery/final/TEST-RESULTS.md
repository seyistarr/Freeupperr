# Final local acceptance results

**Publication preflight passed on the basis of these local checks.** No known
Notes/Gallery regression remains in the exercised cases. Publication has explicit user approval and remains gated on remote CI; no production operation has been performed at this snapshot.

| Check | Final result |
|---|---|
| Complete regression: `FREEUPPER_CHROMIUM=/usr/bin/chromium node --test --test-isolation=none tests/*.test.js tests/*.test.cjs` | **542 passed, 0 failed, 12 skipped** (554 total; 328 seconds; Worker bundle enabled) |
| Focused Linux WebKit UI/components/privacy/preservation checks | **21 passed, 0 failed** |
| Separate current-main Chat browser suite | **11 passed, 0 failed** |
| Current-main Home renderer, Video CSS/DOM, Auth/Google/Chat/backend/cache preservation | **PASS**, included in complete and focused runs |
| Chromium native Sounds Back tap and nonzero playback restoration | **PASS**, included in complete run |
| WebKit native Sounds Back tap, nonzero restoration and restored loop flag | **PASS**, included in focused run |
| Mobile main/integration comparison at 390px and 430px | **PASS**, measured typography, handles, counts, card geometry and shared disc presence |
| Local Cloudflare build | **PASS**, 84 root assets and existing API handlers prepared; no deployment |
| JavaScript syntax and staged/unstaged whitespace checks | **PASS** |
| New Gallery migrations, backend/config changes, infrastructure, Series/collections | **NONE** |

The 21 focused Chromium cases also ran within the final complete suite. The
separate WebKit command uses the existing local WebKit executable wrapper and
includes `gallery-browser`, `gallery-components`, `gallery-main-preservation`,
`gallery-preview-browser`, `notes-browser`, `profile-content-browser` and
`gallery-visibility-review` test files.

The complete suite includes Home, Video, profile/navigation, interaction counts
and canonical mutations, current Chat integration, Google trusted-name signup,
identity/auth recovery, existing publishing and media authorization, and PWA
cache/account-isolation regressions. The separate Chat acceptance file is run
outside the complete Node suite, following main's existing CI convention.

## Skips and practical limits

Twelve optional checks are skipped by the complete-suite command: Worker tests
requiring an enabled local runtime/bundle, the opt-in offline matrix, and the
standalone WebKit theme case. They are **not** counted as passes. No test service
or staging infrastructure was added to run them. Desktop Chromium theme and
safe-area navigation tests passed; focused WebKit media/navigation tests passed.

The earlier WebKit offline-emulation/refresh instability also occurred on main;
it was not addressed or claimed resolved by this final feature change. This
review adds no physical-device, live-Supabase/RLS or hosted-Cloudinary claim.
Synthetic backend denials and actual local media are used for deterministic UI
checks. Existing protected-media and authorization regressions run locally; no
new permissions, sound grants or production data access are introduced.

The final nested sound regression initially exposed two fixture/native details:
seekable test media needs HTTP byte ranges, and WebKit's paused looping iframe
seek can reset to zero. The fixture now serves proper ranges and a small original
three-second clip. Gallery's restoration handles the confirmed native loop issue;
its scoped workaround and loop restoration are tested in both engines. Final
results above supersede exploratory failures, without skipping the regression.

## Evidence

- [Complete regression output](regression.txt)
- [Focused WebKit output](webkit.txt)
- [Chat browser output](chat.txt)
- [Local build output](build.txt)
- [Screenshots, scope and security review](REVIEW.md)
- [Exact changed-file inventory](CHANGED-FILES.txt)

Windows/iPhone kits and staging packages are excluded from this change. No
publication, push, merge, deployment, production configuration edit or migration
application occurred. Budget: **₦0**.
