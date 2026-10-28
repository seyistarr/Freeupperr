# Theme controller

`theme.js` is a blocking head script on every HTML page. It resolves
`freeupper_theme` before styles or other scripts, sets the root theme and native
color scheme, and synchronizes browser theme-color metadata. Missing, invalid or
unavailable storage falls back to dark. `global.js` renders theme controls but no
longer owns theme state.

Use `window.applyTheme('dark' | 'light')`, `window.toggleTheme()` and
`window.getCurrentTheme()`. A real change dispatches the existing document
`themeChanged` CustomEvent with `{ theme }` detail. Reapplying the current theme
makes no visual mutations and emits no duplicate event. Storage, pageshow and
visibility restoration reconcile the persisted preference without reloading.

Previously Settings bypassed the shared API, Admin used a separate preference,
and most pages started dark until global.js executed. Other event listeners
redundantly rewrote the root attribute. A universal transition rule plus page and
navigation overrides produced inconsistent timings. Cache-first PWA assets could
retain the old implementation after documents updated.

`theme.css` suppresses startup transitions and coordinates background, text,
border, fill and stroke colors over 225ms with natural easing during a switch.
The temporary rules never include layout or position properties. Reduced motion
turns transitions off. Shared global asset URLs are versioned to avoid mixing the
new controller with an old active service worker's cached global.js; the precache
version also advances and includes the new theme assets. Normal PWA activation
is preserved, with no forced reload or takeover.

## Verification

Run the existing Cloudflare build and both Worker dry runs before the complete
Node suite, following `.github/workflows/cloudflare-tests.yml`.

```
FREEUPPER_CHROMIUM=/usr/bin/chromium node --test tests/theme.test.js
```

The browser test uses actual page markup/styles at a mobile viewport, isolating
backend scripts. It covers both directions, rapid and repeated changes, event
counts, persistence, all 18 pages' early initialization, cross-tab updates,
Settings controls, browser metadata, reduced motion, restored pages, no reloads,
and cached offline PWA navigation/refresh. A controller test covers blocked
storage. Set `FREEUPPER_WEBKIT=1` with Playwright WebKit installed to repeat the
browser coverage in WebKit. This workspace downloaded WebKit 26 but cannot launch
it because host GTK4, Graphene, WOFF2, HarfBuzz ICU, Hyphen, Manette and GLES
libraries are unavailable. Physical iOS standalone testing remains manual; the
OS-owned launch splash precedes page JavaScript and uses manifest/OS settings.
