# DEP-02 — Manual validation on devices (owner checklist)

Run this on the published app (GitHub Pages). For every device, tick each step and record the
outcome in [`compatibility-matrix.md`](compatibility-matrix.md): date, device, OS + version,
browser + version, result (pass / fail / n/a) and a short note for every failure. **Only what is
recorded there as passed may be claimed as compatible** (CLAUDE.md, TEST_PLAN.md §5).

Use your own authorized list. Never paste credentials, full server hosts or stream URLs into the
notes: the masked text from "Copy details" / "Copy report" is safe to paste.

Devices (TEST_PLAN.md §5): Android Chrome · iPhone Safari (browser) · iPhone installed PWA ·
desktop Chrome · desktop Firefox · macOS Safari if available · a TV browser or Android TV / Fire TV
if available.

Legend: **[all]** every device · **[mobile]** phones · **[desktop]** · **[TV]** TV / remote.

## A. Core (TEST_PLAN.md §5)

- [ ] A1 [mobile] Install / add to home screen: correct icon and name; opens standalone.
- [ ] A2 [all] Add a real list; Settings › Lists › Diagnostics results look consistent.
- [ ] A3 [all] Play 5 channels (TS and HLS if the list has both): time to first frame (rough
      seconds), sound present.
- [ ] A4 [all] Zap fast 10× (↑/↓ or the channel buttons): no crash, no doubled audio.
- [ ] A5 [mobile] Fullscreen, rotation, Picture-in-Picture, Android back button.
- [ ] A6 [all] Movie: play, seek, leave, open again → resumes.
- [ ] A7 [all] Series: the next episode card appears and plays.
- [ ] A8 [all] Search; favorites; recently watched.
- [ ] A9 [all] Airplane mode / offline: the app opens and the messages are correct.
- [ ] A10 [all] App update while playing: playback is not interrupted; "Update" is offered.
- [ ] A11 [all] Settings › Privacy › Delete all data: back to onboarding, nothing left.

## B. Features added after the TEST_PLAN

- [ ] B1 [all] **First screen speed (QA-04)**: on a fresh profile the welcome screen appears in
      about 2–3 s on mobile data; no flash of an empty Home.
- [ ] B2 [all] **Playback failure diagnosis (PLY-06)**: on a channel that does not play, the
      overlay "Details" list every attempt and a likely cause; "Copy details" copies masked text.
- [ ] B3 [all] **Audio tracks and subtitles (PLY-05)**: on content with several audio tracks or
      subtitles, the "Audio and subtitles" menu lists them, switching does not restart playback, and
      the choice is applied again next time. iPhone: same with Safari's native player.
- [ ] B4 [mobile] **Lock screen / Media Session (MSS-01)**: channel or movie name and artwork on
      the lock screen / notification; play/pause and previous/next (channel change on live, next
      episode on series) work.
- [ ] B5 [all] **XMLTV guide (EPG-02/03)** on an M3U list with `url-tvg` (the M3UPT list publishes
      `.xml.xz`): Settings › Lists › edit list › Guide shows a status and coverage; Live shows now /
      next; Diagnostics shows the share of channels with a guide. Note if `.xz` fails
      ("xz-unavailable") and the file size.
- [ ] B6 [all] **TV guide grid (EPG-04)**: Live › TV guide; scroll by time and by channel is
      smooth (note any stutter), the "Now" line is right, a programme opens its details, "Watch
      channel" plays it.
- [ ] B7 [all] **Backup (EXP-01)**: Settings › Backup: export without a password (file has no
      passwords), export with a password, import on another device or after Delete all data —
      merge and replace both work; a wrong password is refused.
- [ ] B8 [all] **Master password (SEC-02)**: turn it on; reload → lock screen; wrong password
      refused; unlock; background the app for more than the lock delay → locked again; turn it off.
- [ ] B9 [all] **Parental control (SEC-03)**: set a PIN, restrict a category: it is hidden from the
      grids, search and Home until the PIN is entered; "Lock now" hides it again.
- [ ] B10 [all] **Protected content (UX-07)**: on a list with DRM/DASH entries they show
      "Protected" and Play is disabled; Settings › Playback › Hide protected content removes them.

## C. Keyboard, screen reader and TV remote

- [ ] C1 [desktop] **Keyboard only (UX-03)**: Tab → "Skip to content" first; add a list, play a
      channel, zap, open a movie, search — without the mouse.
- [ ] C2 [desktop/mobile] **Screen reader (UX-03 AC4)**: run the 10-step checklist in
      [`UX-03.md`](UX-03.md#manual-checklist-for-ac4-owner-dep-02) with NVDA + Firefox/Chrome,
      VoiceOver (macOS / iOS) and, if possible, TalkBack (Android).
- [ ] C3 [TV] **Remote / D-pad (UX-05)**: arrows move between the side bar, categories, the list
      or grid and the player controls; OK plays; Back closes the player / dialog and then goes back;
      CH+ / CH− change channel; the focus ring is clearly visible. Note the TV model and browser.

## D. Personal proxy (PRX-01) — only on the PC first

Follow [`proxy/README.md`](../../proxy/README.md).

- [ ] D1 [desktop, same PC] Node 24 installed; `node server.ts --generate-token`; config written;
      `node server.ts` starts and prints only the port and counts.
- [ ] D2 [desktop, same PC] In the app: Settings › Personal proxy, URL `http://localhost:8787` +
      token → "Test connection" is OK; set your provider's list to **Streams only** → live channels
      that failed with "redirect to http://" now play.
- [ ] D3 [desktop] Close the player: the proxy health shows `activeUpstreams: 0` (the provider's
      one-connection limit is respected); zapping does not hit "too many connections".
- [ ] D4 [mobile] With Tailscale on the PC and the phone: `tailscale serve --bg 8787`; in the app
      use `https://<pc>.<tailnet>.ts.net`; Test connection OK; channels play on the phone.
- [ ] D5 [all] Wrong token → "wrong token"; proxy stopped → "unreachable" hint;
      `tailscale funnel status` shows Funnel **off**.

## Wrap-up

- [ ] Every row is in `compatibility-matrix.md`.
- [ ] Failures: tell the coordinator (paste the masked details); each becomes a fix or a new story.
- [ ] When A–D pass on the target devices: DEP-02, UX-03 (AC4) and PRX-01 (AC3) move to Done.
