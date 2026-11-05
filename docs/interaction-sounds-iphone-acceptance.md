# FreeUpper physical-device acceptance checklist

Status: **NOT EXECUTED on a physical iPhone or Android device.** No device,
Safari remote debugger, or installed mobile PWA is connected to this workspace.
Desktop Chromium automation and mocked `webkitAudioContext` tests are not physical
iPhone evidence. Desktop WebKit could not start because system libraries are missing.

Use the reviewed commit identified in the review manifest. Perform these checks
in an explicitly authorized test/preview environment with dedicated test accounts,
posts and listings. No preview or production deployment was performed by this review.
Do not automate actions against production users or alter production settings.
A production change still requires the user's explicit approval.

## Record the environment and result

| Field | Tester fills in |
| --- | --- |
| Tester and UTC date | |
| Candidate commit SHA and URL | |
| Device model / OS version | |
| Browser version / Safari or installed PWA | |
| Fresh install, upgrade or existing installation | |
| Speaker/headphones/Bluetooth route; device volume | |
| Silent switch/Action button state; Focus state | |
| Test account aliases (no tokens or private payloads) | |
| Each case | PASS / FAIL / BLOCKED, actual result, evidence reference |

Run the complete checklist separately in **iPhone Safari** and the **installed
Home Screen PWA**. Repeat on physical Android Chrome. Desktop Chrome, Firefox,
and Safari acceptance should cover the relevant desktop controls as well.
Record unavailable browsers as NOT TESTED; do not infer a pass.

## Expected cues and action behavior

The cue acknowledges **activation**, not server success. There must be no later
success chime, replay or retry sound when a request completes. Existing visual
success/error/rollback behavior remains authoritative. Multiple oscillator voices
may form one cue; count audible cues, not oscillator nodes.

| Control | Expected |
| --- | --- |
| Like/Love and Unlike | One short, quiet pop for each eligible activation |
| Open repost menu | One quiet UI tap |
| Confirm Repost / Undo repost / save repost note | One soft, neutral cue |
| Open Share / share listing or profile | One light, short swoosh; cancellation is not announced as success |
| Open comments / send a nonempty comment | One gentle tap per activation |
| Save / Unsave listing or post | One soft, neutral cue |
| Follow / Unfollow / cancel follow request | One short, positive but subdued cue; failure is still shown visually |
| Primary navigation, result tabs, Market categories | One quiet tap; no delayed cue after content loads |

Check all eligible controls on Home/For You, Explore and its full-screen/lightbox
view, Market, Video, Search, and Profile, including Profile's retained post and
Market details and relationship lists. Mark nonexistent controls N/A rather than
creating new interactions. Check Video's double-tap Like separately. Two taps to
open and confirm a menu are separate activations, each with at most one cue.

## Cases

- [ ] **Fresh authenticated launch:** wait for the test account to load, then use
  an eligible control. Record whether the first touch is audible. Try a keyboard
  or VoiceOver activation as a separate first gesture, where available.
- [ ] **Auth still pending / signed out:** no sound before authenticated identity
  is established, no deferred sound after login, and the next eligible tap works.
- [ ] **Unlock diagnostics:** in Settings inspect `FUSound.diagnostics()` using
  Safari's remote debugger if available. Record context state and unlock errors.
  The existing Test sound button tests notification-style audio directly, even
  with notification sounds muted; it does not prove interaction tone audibility.
- [ ] **Asynchronous resume:** if the context is suspended/interrupted, record the
  first resume tap and a second tap. The implementation drops a cue when the
  context has not reached `running` synchronously; it must never play it late.
  Do not silently mark a missing first cue as a pass: record this limitation and
  obtain product acceptance if first-tap silence is observed.
- [ ] **Background/foreground:** activate a control, immediately background/lock
  the phone, wait at least 30 seconds, then return. No old cue may replay. Test
  a fresh control and capture any required second unlock tap.
- [ ] **OS interruption:** test after a call/Siri or audio route change in the
  test environment. No stale cue or stuck playback; subsequent taps recover
  when the OS permits audio.
- [ ] **Five primary tabs:** Home → Search → Create → Video → Profile → Home,
  cold and warm. Each visible navigation control produces at most one full cue;
  no cut-off or missing cue solely because the launch feed is suspended.
- [ ] **Lightbox / retained details:** navigate between Profile post/Market details
  and their parent. Hidden renderers remain silent and no cue replays on Back.
- [ ] **Notification independence:** Notification OFF / Interaction ON permits
  only interaction cues; Interaction OFF / Notification ON permits only eligible
  incoming notification/message cues. Use approved test senders/recipients only.
- [ ] **Default and persistence:** a new account on this browser defaults ON.
  Mute interactions, reload, fully close and reopen the same browser/PWA: the
  same account remains muted while its browser storage is retained.
- [ ] **Account isolation:** set different values on test accounts A/B; switch
  A → B → sign out → A. No prior-account tone may continue, and each value is
  restored. Incoming events for another account must remain silent.
- [ ] **Browser-local scope:** another device/browser profile starts at its own
  default. Safari and a Home Screen app may have separate storage containers;
  do not expect cross-device or cross-container synchronization. Same-origin
  tabs sharing a storage container should reflect changes.
- [ ] **Private browsing/storage failure:** verify settings while the private
  window remains open. When storage is denied/full, a failed toggle rolls back
  and announces an error instead of pretending to save. A fresh private session
  may reset preferences after all private windows close, by browser design.
- [ ] **Silent mode and routing:** repeat with silent mode on/off, volume zero/
  nonzero, headphones/Bluetooth and speaker. Record actual results; OS audio
  restrictions are authoritative. The app must not override system volume or
  force an audio route, and muted/blocked audio must not delay actions.
- [ ] **Rapid taps:** on test content, perform 20–30 eligible activations. No
  duplicate cue per activation, no queued burst after stopping, no stuck tone,
  and no action latency attributable to timers/network waits for sound.
- [ ] **Passive activity:** scroll every feed, swipe Video, scrub/play/pause native
  media, type search text, load more results and receive passive updates. These
  must not produce interaction cues. Incoming notification sounds are a separate
  category and are allowed only according to their existing guards/preference.
- [ ] **Failure path:** deny a test action or disconnect its network request. One
  neutral activation cue is allowed; no success melody on error. Existing error
  messages and optimistic rollback must still work.
- [ ] **Offline → online:** after loading the authorized test app, go offline.
  Local feedback and stored mute remain responsive; mutations may fail normally.
  Reconnect: no failed/old activation is replayed, fresh actions work normally.
- [ ] **PWA upgrade:** start with the authorized old build, then make the candidate
  available through an approved process. Observe the new worker waiting while
  old clients remain open. Close all old clients, reopen, verify the new worker,
  v4 sound script and v30 interaction cache (Cloudflare adds its existing suffix).
  No old/new script mix may throw, and the saved mute must survive the update.
- [ ] **Keyboard/accessibility:** Tab to both sound checkboxes, verify accessible
  names/descriptions and focus outline, and use Space. Check VoiceOver focus and
  activation, reduced motion, and keyboard action controls. Muting audio must
  not remove visual or screen-reader feedback.

## Exit criteria

Every applicable case needs a recorded result for Safari and installed iPhone PWA.
No duplicate, scrolling, background or delayed interaction cue is acceptable.
Action/auth/account-isolation failures block release. Record OS-imposed silence,
first-tap resume behavior and subjective loudness separately; these need explicit
product acceptance rather than an automated-test pass. Keep physical acceptance
and dependency-advisory triage attached to the exact candidate SHA before asking
for production deployment approval. This checklist itself grants no approval.
