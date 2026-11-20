# Physical iPhone acceptance — pending

No physical iPhone or installed iOS PWA was tested. This checklist is reproducible
on the isolated HTTPS origin proposed in `preview-plan.md`, only after approval.
Use synthetic accounts/media; do not run destructive storage tests on production.

Record model, iOS build, Safari version, free storage, Low Power Mode, network,
app commit, release digest, fixture version, time, console errors and screenshots.
Use a lower-memory supported iPhone and a current supported device. Run separately
in Safari and Add to Home Screen standalone mode. Mark PASS/FAIL/BLOCKED/NOT RUN.

1. Verify trusted HTTPS, manifest id/scope `/`, start `/home`, icon/name, root SW,
   correct release digest, `isSecureContext` and standalone display mode. Test a
   first install and an existing PWA upgrade. Cache installation must finish before
   measuring warm/offline behavior. Record bytes/time and quota estimates.
2. Exercise all 20 directed transitions between the five different primary tabs.
   Check cold/warm response, one nav bar, active selection, loading UI, repeated
   taps, slow/held HTML, Back/Forward and Safari edge-swipe. Record scroll positions
   in Home/Search/Profile, Search selection and Profile Notes/Series/Gallery.
3. Create an unsent labelled draft, settings and permitted photo/video selections.
   Repeat tab cycles, rotate, open/close the keyboard and background >2 minutes.
   Ordinary tab navigation must retain text/settings/files; no duplicate memory
   references or abandoned blob URLs should accumulate. Do not publish the draft.
4. Play a local fixture video to a nonzero timestamp; leave Video and check pause,
   return/current-item/time, scrub, mute and overlays. Respect iOS gesture policy.
   Check that Range remains network-backed and no duplicate players/transfers form.
5. Open Notes -> Gallery -> selected video -> Sounds -> Back. Check original sound
   stops, video timestamp and loop mode restore, Profile retains its document,
   header/scroll survive, close/Forward restore the correct viewer, and guest auth
   initialization does not reset the page. Repeat with authenticated sign-out and
   assert the old heap/media/draft are disposed.
6. Leave inactive Search/Video while Create is dirty, background >2 minutes, then
   return. The heavy child documents may be disposed, but controls/snapshots should
   restore within their bounds; active screens, primary feeds and drafts remain
   protected. Repeat many cycles and inspect retention/memory. Do not assume Safari
   emits a standard memory-pressure event; the app hook is explicit.
7. After >60 seconds, resume Search online and confirm fresh results; resume offline
   and confirm expired results clear while controls remain. Change/expire account
   A while backgrounded, then enter B: check the first visible frame and history
   for old queries, profile ownership, Notes/Gallery, drafts and protected blobs.
8. Revoke synthetic private-media/follow permissions, unfollow, make an account
   private, and repeat navigation/restoration. New reads must reauthorize and deny
   correctly. Inspect Cache Storage: no tokens, passwords, private API payloads,
   chats, decrypted attachments, video or range responses may be present.
9. After installation disconnect transport; open all five tabs plus Music, Studio,
   Sounds, Saved Sounds, Recently Deleted and Gallery. Public loaded languages
   should work offline. Authentication/publishing and uncached media need network;
   unknown/share/API routes must not get an unrelated Home shell.
10. Clear one script entry on this origin only: matching bytes must recover online.
    Corrupt bytes must be rejected/recovered. Delete all Cache Storage, retain the
    worker, reconnect to the same release and verify reconstruction. Offline with
    no shell bytes cannot promise a full shell. Test cache.open/read/write failures
    separately with the acceptance fault fixtures; valid matching network bytes
    must work, mismatched bytes must fail closed.
11. Exercise low free storage, interrupted installs, process termination, tab
    discard, bfcache and Low Power Mode. A failed new install must preserve the old
    complete release. Drafts are memory-only: OS kill/document restart can lose
    them, unlike ordinary tab changes. Record this limitation explicitly.
12. Keep release A open with a dirty draft, make B available on the test origin,
    trigger update and verify B waits with no forced reload/claim/activation. Music
    and supporting HTML/scripts must all remain A; alternate query labels must not
    fetch B's script. Evict an A entry after B is served: mismatched B bytes must
    be rejected. Unknown network documents must use network assets, not A's cache.
13. Preserve any draft before deliberately closing all controlled tabs/PWA windows.
    Relaunch: B must activate, use matching bytes and remove only obsolete FreeUpper
    caches. An open/background client can defer activation indefinitely. Update
    discovery is hourly on foreground, not an immediate UI prompt.
14. Exercise an approved rollback fixture. Check matching shell/assets, metadata,
    auth/media denials, actual Gallery/Sounds and mock notification destinations.
    Real Firebase delivery/Supabase RLS acceptance needs separately approved isolated
    service tests; mock success is not proof of production integrations.

Release only after applicable cases have evidence, supported iOS versions and
OS-kill draft limitations are explicit, failed cases are resolved, production
pipeline controls are approved, and a separate release approval is given.
