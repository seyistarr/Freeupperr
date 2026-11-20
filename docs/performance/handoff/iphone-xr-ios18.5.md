# iPhone XR / iOS 18.5 acceptance

Physical results remain **NOT RUN**. Record the exact iOS build, free storage,
network, battery/Low Power Mode, orientation, date and screenshots. Run each case
separately in Safari and Add to Home Screen mode; mark PASS / FAIL / BLOCKED.

Existing, unchanged inspection origins:

- A: https://release-a-freeupper-cache-acceptance-isolated.oluwaseyistarr.workers.dev/__acceptance
- B: https://release-b-freeupper-cache-acceptance-isolated.oluwaseyistarr.workers.dev/__acceptance
- Same-origin update target: https://freeupper-cache-acceptance-isolated.oluwaseyistarr.workers.dev

The A/B aliases have separate storage and registrations. Switching links does NOT
test an update. Do not delete production FreeUpper, its website data or its icon.
Use only synthetic A/B accounts; no Google or production credentials. The fixture
password is `fixture-only`, emails `a@example.test` and `b@example.test`.
Production publishing, OAuth, database permissions, private media and Firebase
transport are not exercised by these mocks.

## Basic acceptance on each inspection origin

1. Use Synthetic A on the control page, then **Home**. Wait for shell installation.
   From Home, Share → Add to Home Screen. Install name must be **FU Test**, distinct
   from production. Launch that icon and confirm standalone mode. If the PWA has
   a separate session, use its existing email login form with synthetic credentials.
2. Exercise all 20 directed moves between Home, Search, Create, Video and Profile,
   first cold then warm. Repeat rapid taps, Back/Forward and Safari edge swipes.
   Expect one nav bar, correct selection and URL, no blank/duplicate screens, and
   usable controls above the XR home indicator. Rotate and open/close the keyboard.
3. Scroll Home and Profile three screens and record the visible item/offset. Leave
   and return: same content/scroll. Preserve Profile Notes/Series/Gallery selection.
   Preserve Search query/view; after 60 seconds revalidate online or clear expired
   offline results without crossing accounts.
4. Enter a unique unsent Create draft, choose settings and a harmless small local
   photo/video. Cycle all tabs and Back/Forward; text/settings/files must survive.
   Background >2 minutes and return. Do not publish. Save the text before deliberate
   closure. Memory-only drafts may be lost on an OS process kill/full restart;
   distinguish that from ordinary tab navigation, where loss is a failure.
5. Play a Video to a nonzero timestamp; leave the tab: it pauses. Return: same item
   and position, no duplicate players or audio. In Profile Gallery, play/seek/mute,
   open the sound disc, play the synthetic sound, Back: sound stops and prior
   video/time restores. Close Gallery: Profile scroll/header/history survive.
6. After installation, turn on Airplane Mode AND disable Wi-Fi. Reload the five
   shells, Music/Studio/Sounds/Saved Sounds/Recently Deleted; cached shells work.
   Fresh personalized data and uncached media may require network. Reconnect:
   matching assets recover without false successful empty results or unrelated UI.
7. Keep A's draft/Gallery open; in another tab on that SAME origin choose B, then
   return. Old heap, draft, query and media must be discarded, and B ownership
   correct. Log out and use Back/Forward/offline: old A/B state must not return.
   Safari and installed PWA session storage may be independent; test within each.

## Operator-coordinated update acceptance — approval still required

The harness bug is fixed locally. No server version switches were made during this
diagnosis. Obtain explicit approval before changing traffic on the isolated stable
origin, even between its already-uploaded versions. Keep both alias URLs intact.

Existing versions for the operator to verify read-only before any approved switch:

| Version | Worker version ID | Cache release | global.js SHA-256 |
|---|---|---|---|
| A | a5b32ed5-340f-415f-b02d-8d2ffb232971 | a9cd31e1b99a7cf46051 | 5bdd1044ca4366b480a5d07a848358717e93e128522c3a096172d90156ded52f |
| B | cd7dba23-9139-4fae-921e-75800054fa52 | c3525abfeb828b487cc5 | 11244ef1664771f2562078567c6ca2a09cba6764e65448cc7e1d99276dded36b |

8. After approval, operator serves A on the stable origin. Verify manifest, script
   SHA and controller from that origin. Keep two controlled tabs/windows open,
   one with an unsent Create draft and the other with Video/Gallery at a recorded
   position. Operator then serves the existing B version on the SAME origin.
9. Trigger `registration.update()` from that preview's Web Inspector or a normal
   top-level app visit on that same origin. Wait until **registration.waiting.state
   is installed**. Merely seeing B in CacheStorage or an active/ready registration
   is not sufficient. With A clients open, B must wait; no automatic reload or
   controllerchange may destroy their draft, scroll, selected item or playback.
10. Close one A tab. The other still pins A HTML/scripts and keeps B waiting.
    Preserve the draft separately, then deliberately close ALL controlled clients,
    including background windows and standalone instances. Operator's corrected
    harness must await the captured candidate's activated state and old-cache
    cleanup BEFORE creating the next controlled page. Do not reopen early and
    infer B from cache presence. The next page must use B controller/HTML/script
    hashes together; offline/corrupt/missing-entry recovery must remain correct.
11. Repeat B→A with the same origin/scope and waiting/closure/barrier procedure.
    Rollback must restore matching A bytes, never new HTML with an old script.
    Never force skipWaiting/claim/reload or clear a draft to manufacture success.
12. Test low storage, lock/unlock, long background restoration and process discard.
    Use Web Inspector where available to corrupt/remove ONE preview cache entry;
    matching bytes recover online and incompatible bytes fail closed. Never clear
    all Safari data. If cache/quota/controller inspection is unavailable on the
    physical setup, mark that subcase BLOCKED, not passed. Automated fault coverage
    is separate evidence and is not a physical-device result.

For optional Mac-assisted inspection: enable Web Inspector for Safari in the
iPhone's Advanced settings, then select the exact preview page/PWA in Mac Safari's
Develop menu. Verify the origin before running any console command; never inspect
or clear production data as part of this test. If no supported inspector is available,
record what could and could not be verified rather than guessing release identity.

Close fixture tabs/PWA windows after testing to stop synthetic background polling.
Monitor shared account usage during the coordinated session and pause preview
activity if headroom/production availability becomes uncertain. Passing visual
navigation alone does not certify Service Worker activation or production RLS.
