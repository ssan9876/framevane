# Bugs: reel (M0)

Found by `npx playwright test` (apps/desktop/e2e/specs) on 2026-10-11, Windows 11 / Electron 44 (Chromium 152), 1600×960.
Only reproduced bugs are listed. Each one has a test that failed before the fix and passes after it.

| ID | sev | title | status |
| --- | --- | --- | --- |
| BUG-001 | S2 | Dropdowns inside dialogs open behind the dialog | fixed in 16aa598 |
| BUG-002 | S3 | Double-clicking an agent suggestion starts two runs (double cost) | fixed in 16aa598 |
| BUG-003 | S3 | "VideoSample is closed" uncaught error when edits land mid-frame | fixed in 16aa598 |
| BUG-004 | S3 | Frame step lands one frame short; timecode lags a frame | fixed in 16aa598 |
| BUG-005 | S3 | Missing or still-converting media is requested anyway (404s); a missing source isn't shown offline on the timeline | fixed in 16aa598 |
| BUG-006 | S3 | Tabs in Settings and the inspector point aria-controls at panels that don't exist | fixed in 16aa598 |
| BUG-007 | S3 | Inspector slider thumbs have no accessible name | fixed in 16aa598 |
| BUG-008 | S4 | Home requests project covers before their thumbnails exist (404) | fixed in 16aa598 |

Open: none. No S1 bugs found.

---

### BUG-001: Dropdowns inside dialogs open behind the dialog

- Severity: S2 (export settings can't be changed with the mouse; keyboard type-ahead was the only workaround)
- Flow / case: F10 / F10-E2, F10-E3, F10-E5 (also S02 project settings)
- Screen: S22, S02
- Build: b16fdc2  Browser / device: Electron 44 (Chromium 152), 1600×960

Steps
1. Open a project with a clip, then click Export.
2. Click the Resolution dropdown and click "4K (2160p)".

Expected: the list opens over the dialog and the option is chosen.
Actual: the list renders under the dialog's overlay, and the click never reaches the option (Playwright: "waiting for element to be visible, enabled and stable" ×60, timeout).
Evidence: run1 F10-E2/E3/E5 failures, `test-results/artifacts/f10-export-*/test-failed-1.png`
Suspected cause: z-index tokens put popovers (40) below modals (50), and Radix portals selects to the body.
Fix: tokens now stack popover 60 over modal 50 (toast 70, tooltip 80), noted in tokens.json `_notes.z`.
Status: fixed in 16aa598

### BUG-002: Double-clicking an agent suggestion starts two runs

- Severity: S3 (two API runs billed; duplicate transcript)
- Flow / case: F12 / F12-E4
- Screen: S27
- Build: b16fdc2

Steps
1. Open a project, then double-click "Cut the silences and add captions" in the agent panel.

Expected: one run.
Actual: two "Your message" turns and two runs.
Evidence: run1 F12-E4 "Expected: 1, Received: 2".
Suspected cause: the `running` flag comes from the store, which updates only after the first IPC call returns.
Fix: a synchronous `useRef` guard in `send()`.
Status: fixed in 16aa598

### BUG-003: "VideoSample is closed" uncaught error when edits land mid-frame

- Severity: S3 (uncaught page error; that frame isn't drawn)
- Flow / case: F02 / F02-E5
- Screen: S13
- Build: b16fdc2

Steps
1. Split a clip, then press Ctrl+Z 20 times quickly.

Expected: undo to the start, no errors.
Actual: `pageerror: VideoSample is closed.`
Evidence: run1 F02-E5 console errors.
Suspected cause: `setDoc` pruned decoders for clips that no longer exist while a render still held a frame from one of them.
Fix: pruning is deferred until the render finishes, and drawing a frame closed in flight is skipped.
Status: fixed in 16aa598

### BUG-004: Frame step lands one frame short

- Severity: S3 (→ shows the same frame; timecode off by one)
- Flow / case: X-KB
- Screen: S13, S20
- Build: b16fdc2

Steps
1. Press Home, then →.

Expected: timecode 00:00:00:01.
Actual: 00:00:00:00. One frame at 30 fps was rounded to 33333 µs, which is just under 1/30 s, and the timecode floors it.
Evidence: run1 X-KB "Expected: Preview at 00:00:00:01, Received: …:00".
Fix: `stepFrames()` steps by frame index and lands exactly on the frame. The timecode tolerates 0.001-frame rounding.
Status: fixed in 16aa598

### BUG-005: Missing or still-converting media is requested anyway; a missing source isn't shown offline

- Severity: S3 (console errors; a missing clip looks normal on the timeline)
- Flow / case: F01 / F01-N2, F04-E2 (AVI being transcoded)
- Screen: S13, S20
- Build: b16fdc2

Steps
1. Import a clip, add it, then go to Projects.
2. Delete the source file, then reopen the project.

Expected: no failed requests, and the clip shows "Media offline".
Actual: `reel-media://asset/<id>` returns 404 (console error) and the clip looks normal. The same request happens for an AVI while its mezzanine transcode is still running.
Evidence: run2 failed requests `[{"url":"reel-media://asset/…","status":404}]`.
Fix: the player decodes only media whose status is `ready`, and only once the media list has loaded. It redraws when statuses change. The timeline marks missing sources "Media offline".
Status: fixed in 16aa598

### BUG-006: Tabs point aria-controls at panels that don't exist

- Severity: S3 (critical axe violation `aria-valid-attr-value`; screen readers announce broken tab/panel links)
- Flow / case: X-A11Y
- Screen: S23, S24, S28, S14
- Build: b16fdc2

Steps
1. Open Settings, or select a clip (inspector), then run axe.

Expected: no violations.
Actual: `aria-valid-attr-value` on `#radix-…-trigger-general` / `-agents` / `-shortcuts` / `-video`.
Fix: tab content now renders inside `TabPanel` (Radix Tabs.Content) in Settings and the inspector.
Status: fixed in 16aa598

### BUG-007: Inspector slider thumbs have no accessible name

- Severity: S3 (serious axe violation `aria-input-field-name` ×5)
- Flow / case: X-A11Y
- Screen: S14, S19
- Build: b16fdc2

Steps
1. Select a clip, then run axe.

Expected: each slider is announced by its label ("Scale", "Opacity"…).
Actual: unnamed sliders.
Fix: `aria-label` on the Radix slider thumb (the root's labelledby doesn't reach it).
Status: fixed in 16aa598

### BUG-008: Home requests project covers before their thumbnails exist

- Severity: S4 (404 console error, blank cover until the next visit)
- Flow / case: F01 / F01-N2
- Screen: S01
- Build: b16fdc2

Steps
1. Create a project from files, then go straight back to Projects.

Expected: placeholder icon, no failed request.
Actual: `reel-media://thumb/<id>` returns 404.
Fix: `projects.list` joins the cover asset and only returns `coverUrl` when its poster exists on disk.
Status: fixed in 16aa598

---

## Test bugs (fixed in the specs, not the app)

- `projectDuration()` read the project panel, which is hidden when a clip is selected. It now reads the player timecode (which also gained an accessible label).
- My VFR fixture is 12 s long, not 7 s, so the expectation was corrected.
- F01-N3 refreshed the list by creating a new project. It now restarts the app.
- An ambiguous "Undo" matched both the toolbar and the toast action, so the test now scopes to the toolbar (`banner`).
- axe in Electron needs `setLegacyMode(true)` (no new pages).

## To check (not reproduced as a bug yet)

- Escape didn't close the review dialog once, right after the "timeline changed" warning toast appeared. The toast may take the key. Other dialogs close on Escape.
- **The live Claude API is untested** (F12-H2, F12-N2 prompt injection). There's no key on this machine.
- Audio is actually audible during playback and in sync over long clips. Manual, by ear.
- Playback smoothness with 4K × several tracks (performance pass, M1).
- F02-N1: the overlap message when dragging an overlay clip onto another. Manual; there's no overlay drag test yet.
- Offline behaviour of the agent (F12-E6). Manual.
