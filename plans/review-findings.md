# Review Findings — October 2026

Results of a code review plus in-browser testing (Chrome, driven via page JavaScript against `python -m http.server`).
"Verified" items were reproduced in the browser; "Code-evident" items were found by reading the code only.

Status: `[ ]` open · `[x]` fixed — see *Fix log* at the end.

---

## High severity (verified)

- [x] **H1. Opening a saved file project while a YouTube/URL project is active overwrites the wrong project.**
  `SessionsManager.openSessionByKey` (`js/sessions.js`) enters Detached Review Mode without clearing
  `state.mediaSourceType`, `state.youtubeVideoId` or `state.externalUrl`. `state.getStorageKey()` keeps returning the
  YouTube/URL key, so any edit made in detached mode is auto-saved over the YouTube/URL project. The YouTube stage
  also stays visible.
  *Repro:* have a YouTube project with notes → Projects → open a local-file project → edit a note → the YouTube
  project's record now holds the file project's notes; the file project is unchanged.

- [x] **H2. Stored XSS through imported JSON `thumb` field.**
  `<note-card>` interpolates `note.thumb` into `src="${note.thumb}"` without escaping (`js/components/note-card.js`),
  and `ImportManager` copies `thumb` from JSON unvalidated. A shared JSON file with
  `"thumb": "x\" onerror=\"…"` executes script; it is auto-saved to IndexedDB, so it re-runs each time the project
  opens.

- [x] **H3. Notes imported with no media loaded are silently lost.**
  With no media, `getStorageKey()` is `null`, so the import is never persisted; opening a media file afterwards runs
  `state.notes = []` in `loadFile`. The import toast reports success.

## Medium severity (verified)

- [x] **M1. `loadDirectUrl` never returns `true`.**
  The Open URL modal never closes after a successful direct-URL load, and re-opening a saved URL project from
  Projects always falls through to Detached Review Mode.

- [x] **M2. Timeline is inert for YouTube and direct-URL sources.**
  `timeline.js` checks `state.mediaFile || state.detachedMode` for "has media", so click-to-seek, wheel scroll and
  zoom are ignored, and the waveform/playhead are not drawn.

- [x] **M3. Timeline pointer/wheel handlers are registered twice.**
  Inline `onpointerdown/onpointermove/onpointerleave/onwheel` attributes in `index.html` *and*
  `TimelineEngine.setupPointerEvents()`. One Ctrl+wheel notch zooms 1.5625× instead of 1.25×; each click starts two
  scrubs.

- [x] **M4. A single file drop calls `loadFile` three times.**
  Inline `ondrop` on `#drop-zone`, the `addEventListener('drop')` on the zone, and the window-level drop handler
  (which runs because the zone is already `.hidden` by then).

- [x] **M5. Documented I/O shortcuts don't exist.**
  README, the shortcuts modal and the on-screen hint say `I`/`O` set In/Out; the code binds `A`/`B`.

- [x] **M6. Global shortcuts hijack browser shortcuts.**
  The keydown handler ignores modifier keys: Ctrl+−/Ctrl+= are swallowed (browser zoom broken), Ctrl+A sets the A
  point, Ctrl+P/F/L trigger PiP/fullscreen/skip.

- [x] **M7. Mute desyncs from the volume slider.**
  After pressing `M` and then raising the slider, `state.isMuted` becomes `false` and the icon shows unmuted, but
  `videoEl.muted` stays `true` (YouTube is never `unMute`d either).

## Low severity (verified)

- [x] **L1. Invalid SRT/VTT timestamps.** `formatSRTTime(1.9996)` → `00:00:01,1000`; milliseconds can round to 1000.
- [x] **L2. `showToast(message, 7000)` misuse.** The player error handler passes `7000` as the `showUndo` flag:
  error toasts show a no-op Undo button and disappear after 2.8 s instead of 7 s.
- [x] **L3. Shortcuts fire while a modal is open** (e.g. Space toggles playback, T toggles theme behind a dialog).

## Code-evident bugs (not reproduced)

- [x] **C1. Waveform worker `ERROR` messages are never handled.** The main thread only listens for
  `PEAKS_COMPLETED`/`DEMUX_COMPLETED`/`DEMUX_FAILED`, so a worker exception leaves the promise pending forever.
  The channel buffer was also transferred, so the in-thread fallback can't use it.
- [x] **C2. Local-video thumbnails capture the wrong frame.** `takeSnapshot` draws the *current* frame, not the stamped
  time; press `N`, keep typing while playing, and the thumbnail is from later.
- [x] **C3. Lightbox download is always named `.png`** even when the fallback image is a JPEG data URL.
- [x] **C4. `generateSyntheticWaveform(name, duration)` argument mismatch** *(moot: synthetic waveform removed)*. Three call sites in `player.js` pass a
  string name then the duration, but the string form of the signature is `(name, size, duration)`, so duration
  defaults to 60 s.
- [x] **C5. `state.isDirty` is never set to `true`**, so the `beforeunload` guard is dead code.
- [x] **C6. Web Audio routing persists across sources.** After any audio file plays, the `<video>` element is
  permanently routed through `MediaElementAudioSourceNode`; a later cross-origin URL without CORS would play silent.
- [x] **C7. Global paste replaces the project without confirmation** for any pasted `http…` URL or text containing
  `youtube.com`.
- [ ] **C8. Large-file memory use.** Files up to 500 MB are read fully into memory, copied with `slice(0)`, then
  decoded to PCM — potentially several GB for long videos.

## Improvement areas

- Remove duplicated wiring (inline handlers + `addEventListener`) — root cause of M3/M4; the `data-action`
  delegation in `plans/maturation.md` fits here.
- Single `hasMedia()` helper — four modules compute it differently (root cause of M2).
- Single "reset media/session state" routine — the field-by-field reset is copied across six places; H1 is a copy
  that missed fields.
- Validate imported notes (numeric `start`, safe `thumb`) and regenerate IDs on merge to avoid duplicate IDs.
- ~~Label the synthetic waveform as an approximation~~ → synthetic waveform removed; a plain flat track is shown instead.
- Service worker network-first fetch has no timeout, so slow connections stall instead of using the cache.
- Housekeeping: JSON export `version: '1.2.0'` vs `APP_CONFIG.version` `1.1.0`; `manifest.json` duplicates
  `manifest.webmanifest`; `plans/maturation.md` links to `file:///c:/Users/benb/...`.
- No automated tests — import parsers, time formatters and `parseMediaUrl` are easy unit-test targets.

---

## Fix log

Fixed items were re-checked in Chrome by re-running the original reproductions (YouTube state simulated, `medialoaded`
fired manually because the test tab could not play media in the background). Pure helpers are covered by
`node --test tests/*.test.mjs`.

| Item | Fix |
|---|---|
| H1 | Detached review now clears `mediaSourceType`/`externalUrl`/`youtubeVideoId` and hides the YouTube stage. |
| H2 | New `sanitizeImageSrc()` (only `data:image/…` or http(s)); `<note-card>` escapes `src`; JSON import validates every note (finite `start ≥ 0`, `end > start`, known tag, string text). |
| H3 | Loaders adopt notes that have no session (`takeOrphanNotes()`); `autoRestoreSession` merges saved + in-memory notes by id and persists them. Import warns when nothing is open. |
| M1 | `loadDirectUrl` returns `true`. |
| M2 | Shared `state.hasMedia()` used by timeline, notes, player and app. |
| M3/M4 | Removed inline timeline/drop-zone handlers and their proxies; window drop handler skips already-handled drops. |
| M5 | `I`/`O` bound (A/B kept as aliases); button titles updated. |
| M6 | Shortcuts ignore Ctrl/Cmd/Alt (AltGr still allowed). |
| M7 | `setVolume` syncs `videoEl.muted` and YouTube mute state. |
| L1 | SRT/VTT times rounded to whole milliseconds before splitting. |
| L2 | `showToast(msg, showUndo, onUndo, duration)`; player error toast uses 7 s, no Undo. |
| L3 | Only Escape is handled while a `modal-dialog` is open. |
| C1 | Worker `ERROR` messages resolve the pending task; detached buffers fall back to the flat track. |
| C2 | Snapshot grabbed at the note's time via `renderFrameOffscreen()` when the playhead has moved on. |
| C3 | Download extension follows the actual image type. |
| C4 | Superseded: the synthetic waveform generator was removed entirely. |
| C5 | `isDirty` set while saves are in flight / when notes have no session; unload guard also covers an unsent draft. |
| C6 | `releaseAudioGraph()` swaps in a fresh `<video>` before loading a direct URL. |
| C7 | Paste only reacts to a bare URL; with a project open it pre-fills the Open URL dialog instead of switching. |

Also done from *Improvement areas*: shared `hasMedia()`, import validation + id re-keying on merge, synthetic waveform
replaced by a plain flat track whenever no decoded audio is available, 4 s service-worker network timeout before falling back to cache, export
`version` now reads `APP_CONFIG.version` (1.2.0), `plans/maturation.md` links made relative, first unit tests.

Still open: C8 is only partly addressed (one full-file copy removed; long files are still decoded fully to PCM),
the duplicated reset routine across loaders, the remaining inline `onclick` proxies, and the duplicate
`manifest.json`.

---

## UX round (C → B → A)

Plan: `~/.claude/plans/vectorized-tumbling-rainbow.md`. Verified in Chrome via page JS plus `node --test`.

- **PWA**: `launchQueue` consumer (OS "Open with" now works); `?action=open` shortcut highlights the drop zone;
  deep links `?v=<id|url>&t=…` / `#t=…`; Android `share_target` (`?url=` / `?text=`). Params are stripped after use.
- **Data safety**: `navigator.storage.persist()` after the first save + usage/protection row in Settings;
  Projects → *Back Up All* / *Restore…* (restore merges by note id, including into the open project);
  thumbnails 320 px @ 0.6; in-app `confirmDialog()` replaces `window.confirm()` for clear-all and delete-project.
- **Note editing**: edit start/end ("Now" buttons) and tag of saved notes; `Shift+,`/`Shift+.` nudge ±0.1 s;
  "Stamp earlier while playing" (0–3 s); pause-while-typing now resumes after saving (works for YouTube too via
  `player.pause()/play()`); `UndoHistory` (`js/history.js`) with `Ctrl/Cmd+Z` for add/edit/delete/nudge/import/clear, and redo via `Ctrl/Cmd+Shift+Z` / `Ctrl+Y` or the Redo button on the "Undid …" toast.
- Not verifiable in the background test tab: real OS file launch, the Android share sheet, actual playback
  resume, and how the new edit fields look at narrow widths.
