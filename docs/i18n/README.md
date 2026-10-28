# FreeUpper multilingual implementation

The language picker now changes the application interface and persists the selected language. This release is **partial**: catalog completeness is different from complete application extraction or native-quality translation.

## Identifiers and compatibility

All identifiers are valid BCP 47 language tags. Existing storage IDs are preserved:

`en`, `en-US`, `fr`, `es`, `de`, `ar`, `hi`, `pt`, `zh`, `ja`, `ko`, `ru`, `yo`, `ha`, `ig`, `pcm`, `sw`, `zu`, `xh`, `af`, `am`, `so`, `sn`, `rw`, `lg`, `ak`.

- `en` is the legacy UK selection; document language and Intl formatting use `en-GB`. `en-GB` preferences resolve to `en`.
- `en-US` has a separate resource and US spelling. Other English regional tags resolve to UK English.
- `pt` uses Brazilian Portuguese; regional Portuguese tags currently resolve to this resource.
- `zh` uses Simplified Chinese. Regional/script Chinese preferences currently resolve to this resource; Traditional Chinese is not a separate option.
- Supported regional preferences resolve to their base language. Underscores are accepted for legacy inputs. Unsupported preferences fall back to English.
- Language choice is independent of country, location and device time zone.

## Architecture and safety

`js/i18n-core.js` exports a DOM-independent i18next service and locale resolution functions. React/Next.js can import this service with their own resource loader; Phoenix can serve the same JSON files or use the HTML adapter. No framework, database, credentials or account data are required by the core.

The browser adapter loads the selected JSON dictionary and UK English fallback on demand. The i18next 25.6.0 ESM distribution is committed under `js/vendor/`, with its upstream licence; package.json/package-lock.json pin the npm dependency. Run `node scripts/sync-i18next.mjs` after an intentional dependency upgrade. No CDN is used for i18next.

Translations use textContent or an allowlisted text attribute (placeholder, aria-label, title, alt). They never use innerHTML. Existing source templates have explicit UI markers. The observer translates newly inserted marked UI, and an explicit registry covers authentication form labels without changing authentication code. It does not scan arbitrary text for English words. A marked placeholder that a renderer replaces with content is released from translation management, including before initial dictionary loading. User posts, names, captions, hashtags and private messages are not submitted for runtime translation.

The picker keeps its confirmation UI, saves `freeupper_lang` only after successful loading, applies document lang/dir, displays a translated success toast and synchronizes other tabs. New users default to navigator.languages. Failed switches retain the current language. Arabic applies RTL and adjusts the desktop rail and body offset. Controls wrap; layout tests cover all languages in Settings at 320 and 1280 pixels, plus the picker at 390 pixels. This is not a complete visual audit of every screen.

Intl handles locale-aware numbers, NGN currency display, counted video comment labels, CLDR plural selection and date/time display. UTC parsing/transport and automatic device time zones remain intact. All plural grammar, particularly counted messages outside English/Arabic, requires native review; the seeded generic counted template uses a localized noun with a formatted number.

The PWA precaches the engine, adapter, CSS and English fallback; selected dictionaries are cached on demand by the existing public-asset fetch policy. Previously loaded languages work offline. Selecting an uncached language offline shows the retry path. Bump the service-worker cache version when dictionaries or adapter assets change. Deep links, authenticated media exclusions, API exclusions and private/no-store handling are retained.

## Coverage and quality

The extracted English catalog contains 940 keys. English UK and US have 940 entries; 23 other languages have all 940 catalog keys (Arabic adds four CLDR categories). Nigerian Pidgin has 168 entries and uses English fallback for 772 keys. Missing catalog keys are enumerated in `locales/coverage.json`; run `node scripts/i18n-coverage.mjs` to regenerate it.

Non-English dictionaries combine hand-authored core vocabulary with author-time machine translations of developer-authored UI literals. The public machine translation endpoint was used only to author JSON; it is not an application dependency. No runtime translation requests are sent to it. Nigerian Pidgin was unsupported by that endpoint and retains a smaller hand-authored resource. `locales/translation-provenance.json` records this distinction.

**Every non-English dictionary requires native-speaker review**, including terminology, grammar, plural forms, accessibility wording and legal text. Machine output is not claimed to be native-quality. Review Chinese script variants, Portuguese regional terminology and Arabic alignment beyond the tested layouts.

Extraction is incomplete: some concatenated/interpolated controls, mixed text/icon labels, placeholder strings and backend-supplied errors still display English. Complex reply-count phrases, some audience option assignments and some authentication explanatory sentences need explicit bindings. Admin is intentionally outside this release. Legal/privacy pages have extracted text but need legal and native-language review. The following table measures marked static/template UI only; dynamic translated sinks and shared navigation are additional coverage. A full catalog column means these extracted keys exist, not that every string on the page is translated.

| Page | UI markers | Unique catalog keys | Pidgin keys | Other 25 resources |
|---|---:|---:|---:|---|
| `admin.html` | 0 | 0 | 0/0 | Out of scope |
| `chat.html` | 77 | 64 | 7/64 | Full catalog |
| `create.html` | 36 | 31 | 9/31 | Full catalog |
| `index.html` | 72 | 58 | 19/58 | Full catalog |
| `music.html` | 5 | 5 | 2/5 | Full catalog |
| `notification.html` | 5 | 5 | 1/5 | Full catalog |
| `policy.html` | 82 | 79 | 1/79 | Full catalog |
| `privacy-verification.html` | 9 | 9 | 0/9 | Full catalog |
| `privacy.html` | 75 | 74 | 2/74 | Full catalog |
| `profile.html` | 83 | 69 | 16/69 | Full catalog |
| `recently-deleted.html` | 4 | 4 | 1/4 | Full catalog |
| `reset-password.html` | 9 | 9 | 8/9 | Full catalog |
| `saved-sounds.html` | 1 | 1 | 0/1 | Full catalog |
| `search.html` | 18 | 17 | 12/17 | Full catalog |
| `settings.html` | 147 | 122 | 68/122 | Full catalog |
| `sound.html` | 2 | 2 | 0/2 | Full catalog |
| `studio.html` | 43 | 42 | 9/42 | Full catalog |
| `video.html` | 38 | 31 | 11/31 | Full catalog |

## Validation and release

Executed local validation results are recorded in `validation.md`. The GitHub Cloudflare workflow runs the full suite and deploys the web Worker after a push to main. The API Worker was not changed; its dry run is still required. Production verification must check the deployed commit and all resource responses before claiming deployment success.

## Files

Modified:

- `bottom-nav.js`
- `chat.html`
- `chat.js`
- `cloudflare/build.mjs`
- `create.html`
- `foryou.js`
- `global.js`
- `index.html`
- `js/freeupper-time.js`
- `lightbox.js`
- `music.html`
- `music.js`
- `notification-permission.js`
- `notification.html`
- `notification.js`
- `onboarding.js`
- `package-lock.json`
- `package.json`
- `policy.html`
- `privacy-verification.html`
- `privacy.html`
- `profile.html`
- `recently-deleted.html`
- `recently-deleted.js`
- `reset-password.html`
- `saved-sounds.html`
- `saved-sounds.js`
- `search.html`
- `search.js`
- `service-worker.js`
- `settings.html`
- `settings.js`
- `side-nav.js`
- `sound.html`
- `studio.html`
- `video-render.js`
- `video.html`

Created:

- `js/freeupper-i18n.js`
- `js/i18n-core.js`
- `js/i18n-ui.js`
- `js/i18n.css`
- `js/vendor/i18next.LICENSE`
- `js/vendor/i18next.js`
- `locales/af.json`
- `locales/ak.json`
- `locales/am.json`
- `locales/ar.json`
- `locales/coverage.json`
- `locales/de.json`
- `locales/en-US.json`
- `locales/en.json`
- `locales/es.json`
- `locales/fr.json`
- `locales/ha.json`
- `locales/hi.json`
- `locales/ig.json`
- `locales/ja.json`
- `locales/ko.json`
- `locales/lg.json`
- `locales/manifest.json`
- `locales/pcm.json`
- `locales/pt.json`
- `locales/ru.json`
- `locales/rw.json`
- `locales/sn.json`
- `locales/so.json`
- `locales/sw.json`
- `locales/translation-provenance.json`
- `locales/xh.json`
- `locales/yo.json`
- `locales/zh.json`
- `locales/zu.json`
- `scripts/check-i18n-syntax.mjs`
- `scripts/i18n-coverage.mjs`
- `scripts/sync-i18next.mjs`
- `tests/i18n-browser.test.js`
- `tests/i18n.test.js`
- `docs/i18n/README.md`
- `docs/i18n/validation.md`
