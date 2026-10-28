# Executed validation — 2026-10-28

- Full regression command:
  `FREEUPPER_TEST_ORIGIN=http://localhost:8787 FREEUPPER_TEST_BUNDLE=.wrangler/test-build FREEUPPER_CHROMIUM=/usr/bin/chromium node --test --test-isolation=none tests/*.test.js tests/*.test.cjs`
  **162 passed, 0 failed, 0 skipped.** Includes live local workerd assets/routes and WASM previews, protected media browser decoding, database privacy fixtures, API gateway, UTC/device-time regression tests and multilingual tests.
- `FREEUPPER_CHROMIUM=/usr/bin/chromium npm run test:i18n`: **7 passed, 0 failed, 0 skipped.** Covers all 26 resources and switching, meaningful non-English dictionaries, key/placeholder validity, explicit missing-key fallback, browser detection and saved preference precedence, lazy loading, retry after failure, pinned vendor verification, picker confirmation and localized success, reload/navigation persistence, initial and subsequent user-content isolation, dynamic authentication labels, counted Arabic comments, RTL, mobile and desktop Settings overflow at 320/390/1280 pixels, service-worker caching and offline use of a previously loaded language.
- `npm run build:cloudflare`: passed; publishes the locales directory and vendored engine with existing public assets.
- `XDG_CONFIG_HOME=/tmp/freeupper-config WRANGLER_SEND_METRICS=false npx wrangler deploy --dry-run --outdir .wrangler/test-build`: passed.
- `XDG_CONFIG_HOME=/tmp/freeupper-config WRANGLER_SEND_METRICS=false npx wrangler deploy --config cloudflare/api/wrangler.jsonc --dry-run --outdir .wrangler/api-test-build`: passed.
- `node scripts/check-i18n-syntax.mjs`: compiled 33 inline classic scripts successfully.
- `git -c core.whitespace=cr-at-eol diff --check`: passed; existing CRLF convention in search.html retained.

The default Wrangler config/log directory is unwritable in this workspace; XDG_CONFIG_HOME points it to a writable temporary directory. The downloaded Playwright browser lacked the media support needed by the existing H.264 decoding test; the final successful full run used system Chromium. Earlier failed attempts are not counted as successful validation.

These checks do not establish native translation quality, full app extraction, authenticated production account workflows, or complete visual correctness on every screen. See README.md for resource gaps and review requirements. Production deployment and verification are reported separately after pushing this commit; this file records executed local validation.
