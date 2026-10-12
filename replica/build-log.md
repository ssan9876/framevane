# Build log: framevane (M0 vertical slice)

Branch `build/m0-vertical-slice`. Screenshots in `replica/clone-screens/` come from the e2e runs at 1600×960.
Desktop app: the minimum window is 1280×720, so the skill's 390 px mobile check doesn't apply (no mobile target in scope).

## How to run

```bash
pnpm install
cd apps/desktop && node scripts/build.mjs && npx electron .      # or: node scripts/dev.mjs (Vite HMR + auto-restart)
pwsh scripts/make-seed-media.ps1                                   # dev/test media in replica/seed-media
node e2e/vertical-slice.mjs                                        # F01 F02 F04 F10 through the UI + screenshots
node e2e/agent-flow.mjs                                            # F12 with the test-double model (no API key needed)
cd ../../packages/doc && npx vitest run                            # 20 op/timeline tests
```
The local AI sidecar needs `uv` (installed). The first transcription downloads Whisper large-v3-turbo (~1.6 GB) to `%APPDATA%\Framevane\models`.

## Screens

| ID | date | status | what's missing | harder than expected |
| --- | --- | --- | --- | --- |
| S01 Home | 2026-10-11 | done | — | — |
| S02 Project settings | 2026-10-11 | done | proxy toggle, copy-vs-link media | — |
| S03 Editor shell | 2026-10-11 | done | resizable panes, layout presets, missing-media relink banner | zustand v5 loops forever on object selectors; use one selector per value |
| S04 Media | 2026-10-11 | done | multi-select, relink | — |
| S05 Audio | 2026-10-11 | partial | SFX and free library (CC0 via user API key) | — |
| S06–S10, S12 asset tabs | 2026-10-11 | stub | M3/M4 | — |
| S11 Auto captions | 2026-10-11 | done | bilingual, keyword highlight option, SRT import/export | faster-whisper 1.2.1 breaks on PyAV ≥15; pinned av 14.2.0 |
| S13 Player | 2026-10-11 | done | on-canvas transform handles (M1), safe-area guides | a canvas that mounts after the player starts needs a callback ref; `desynchronized` canvases don't show in captures |
| S14 Inspector: Video | 2026-10-11 | partial | Basic only (scale, position, rotation, opacity, mirror); Remove BG/Mask/Retouch stubs; keyframes M1 | — |
| S15 Inspector: Audio | 2026-10-11 | partial | volume only; fades/denoise M3 | — |
| S16 Inspector: Speed | 2026-10-11 | partial | constant speed only; curve, optical flow, keep pitch | — |
| S17 Animation · S18 Adjust | 2026-10-11 | stub | — | — |
| S19 Text/caption inspector | 2026-10-11 | partial | caption text + track style; text clips and TTS M3 | — |
| S20 Timeline | 2026-10-11 | done | markers UI, group, copy/paste, track resize, keyboard roving between clips | magnet moves need `pack_track` and ripple trims as single ops (intermediate states would overlap) |
| S21 Keyframe graph | 2026-10-11 | stub | Alt+K tells you it's coming | — |
| S22 Export | 2026-10-11 | done | audio-only, GIF/ProRes/WebM, range export, custom bitrate | Mediabunny needs audio fed interleaved with video; slices are fed 1 s ahead |
| S23 Settings | 2026-10-11 | partial | performance/cache controls | — |
| S24 Shortcuts | 2026-10-11 | partial | read-only list; rebinding is a should-have | — |
| S25 Photo editor | 2026-10-11 | stub | M7 | — |
| S26 Script to video | 2026-10-11 | stub | agent recipe later | — |
| S27 Agent panel | 2026-10-11 | done | permission prompts (M2, for MCP tools) | — |
| S28 Agents & tools settings | 2026-10-11 | partial | API key, model, effort; MCP server list M2 | — |
| S29 Edit review | 2026-10-11 | done | before/after split view (one "after" preview only) | — |
| S30 Transcript editing | 2026-10-11 | stub | pointer in the Captions tab | — |
| S31 Agent library | 2026-10-11 | stub | popover in the agent panel | — |

Count: 31 screens. 12 done, 9 partial, 10 stub. Every screen is reachable.

## Flows verified end to end (through the UI, real decode/encode/AI)

- **F01** new project → import via the media panel → add to the timeline. The thumbnails, filmstrip and waveform jobs complete.
- **F02** split at 5 s with Ctrl+B → delete → undo → redo.
- **F04** auto captions with local Whisper on CUDA (8–11 lines). The active word is highlighted in preview and export.
- **F10** export: H.264 1920×1080 30 fps + AAC, 24.13 s (= 29.13 s − the 5 s cut). The burned-in test-pattern clock in the export matches the cut exactly, so it is frame-accurate.
- **F12** agent: get_project_summary → find_silences (7 pauses, 12.6 s) → cut_ranges → add_captions. Review: excluded one cut, applied 7 edits (29.1 s → 17.9 s), then Ctrl+Z restored the original.
- No console errors in either run.

## What is not proven yet (said plainly)

- **The live Claude API has not been called.** There is no Anthropic key on this machine, so F12 ran on a deterministic test double (`FRAMEVANE_FAKE_AGENT=1`, `src/main/agent/fake-model.ts`). It drives the real tools, fork, review and apply, but not the model's own judgement or the request format against the real API (betas, `fallbacks: "default"`, thinking display "updates"). First thing to do with a key: run "cut the silences and add captions" on `replica/seed-media/talk.mp4`.
- **Codecs:** real phone footage (HEVC 10-bit HDR, VFR) and ProRes/AVI have not been tested. The mezzanine path is written but unexercised.
- **Crash recovery:** journal replay is implemented, but no kill-mid-edit test exists yet.
- **Long media:** preview audio decodes the whole file into memory. That is fine up to about 20 minutes; streaming decode is needed for long recordings.
- **Flaky screenshot:** one early run timed out taking a screenshot. It hasn't recurred since the `desynchronized` canvas flag was removed, and the e2e script now reports whether the renderer is responsive if it happens again.

## Deviations from architecture.md

- **Compositor is Canvas 2D for M0, not WebGPU.** It is the same single renderer for preview and export, so parity holds. WebGPU replaces `drawFrame` internals when effects, masks and color arrive (M4).
- **The agent loop is the documented streaming manual loop, not the beta Tool Runner.** That gives direct control of streaming, cancellation and mixed Zod/MCP tool schemas.
- **SQLite runs on Electron's built-in `node:sqlite` (Node 24.21), not better-sqlite3.** No native rebuild is needed; the SQL is the same.
- **Silence detection runs in the main process via ffmpeg `silencedetect`, not in the Python sidecar.** It is faster and needs no model.
- **electron-vite doesn't support Vite 8,** so builds use esbuild for main/preload and Vite for the renderer.

## Connect Claude Code (2026-10-11, pulled forward from M2)

Framevane is now an MCP server, so a Claude Code session (your own login, no API key in Framevane) edits the open project directly.
- `src/main/editor-mcp.ts`: streamable HTTP on `127.0.0.1:47821/mcp` (stateless), bearer token (settings table), refuses non-local Host and any browser Origin.
- Tools: the 12 agent tools plus list_projects, open_project, create_project, import_media, add_to_timeline, undo, redo, export_video (23).
- Every mutating call is one op batch, so it's one undo step. Edits show live, with a toast (Undo) and an activity feed in the agent panel.
- The window reports the open project, playhead and selection, so "caption the selected clip" works. Export is delegated to the window (WebCodecs).
- Settings → Agents & AI: "Add to Claude Code" runs `claude mcp add --scope user --transport http framevane …` with the token; there's also Copy command, Reset token, and an on/off switch.
- Harder than expected:
  - The first report of the open project could lag the agent's first call; there's now a fallback to the project loaded in main.
  - Transcription jobs linked MCP calls to a non-existent agent run (FK error). Only real in-app runs link now.
- Not built: review mode for external agents (their edits apply directly; undo is the safety net).

## Next (architecture build order)

- **M1 timeline must-haves:**
  - keyframes and the S21 graph
  - on-canvas transform handles
  - copy/paste, markers, group, freeze, reverse, crop, detach audio
  - proxy jobs
  - crash test for the journal
- **M2 agent platform:**
  - the editor as an MCP server (Claude Code can drive it)
  - user-added MCP servers (S28) with per-tool permission prompts
  - `get_frames` against the live API
  - run F12 against real Claude
