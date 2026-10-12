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

- **Compositor is Canvas 2D for M0, not WebGPU.** It is the same single renderer for preview and export, so parity holds.
- **Looks run on WebGL2 (GLSL ES 3.0), not WebGPU (WGSL) (M4).** WebGL2 calls are synchronous, so the shader passes run inside the one `drawFrame` that preview and export share. WebGPU would have made that path async. WebGL2 also works on every Windows GPU driver, and in software for tests. Masks and AI cut-outs (M5) can reuse the same pipeline.
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

## M1 timeline must-haves (2026-10-11)

| area | status | notes |
| --- | --- | --- |
| Keyframes (S14, S15, S20) | done | Position, scale, rotation, opacity, volume. Diamonds in the inspector (add, remove, previous/next) and on clips. Easing presets. Keyframes stay continuous across split, trim and speed change (`sliceKeyframes`). "Clear keyframes" keeps the value at the playhead. Volume keys drive gain automation in preview and export. |
| On-canvas handles (S13) | done | Click the picture to select. Drag to move, corners to resize, knob to rotate, snapping to centre lines. Shared geometry (`mediaGeometry`) with the compositor. Live preview from a locally simulated doc; one undo step on release. Keyed props get keyframes. |
| Crop, blend, background (S14, S03) | done | Crop per side (no re-zoom), 16 blend modes, colour or blurred background. |
| Clipboard | done | Ctrl+C/X/V/D. Paste inserts on the magnet track, otherwise first free track or a new one (placement checked by simulating ops). |
| Detach audio + linkage | done | Linked clips select, move and delete together. Linkage toggle. |
| Freeze, reverse, mirror, enable/disable, group | done | Reverse renders in 2 s chunks so memory is bounded. |
| Markers | done | M, Shift+M, Alt+Shift+M, right-click delete, accessible buttons on the ruler. |
| Proxies, relink | done | 1280px proxies above 1080p (preview only). Locate… for missing media. |
| Agent tools | done | New: animate_clip, set_background, add_marker. set_clip gained blend, crop and mirror. Available to the in-app agent and to Claude Code over MCP. |
| Keyframe graph S21 | partial | Easing presets only. Curve editing is a should-have. |
| Compound clips, keep-pitch speed | not built | Could / partial items, moved to later. |

Harder than expected:
- **BUG-010:** zod `.partial()` keeps defaults, so every one-field transform or caption-style edit reset the others. Present since M0, caught by the on-canvas drag, fixed with `patchOf()`.
- **Keyframes across edits:** keeping them continuous needed boundary keyframes inserted at the cut values. A naive filter loses the animation.

## M2 agent platform (2026-10-11)

| area | status | notes |
| --- | --- | --- |
| MCP servers for the built-in agent (S28) | done | Settings → Agents & AI → "Tools from other apps". A server is a local command (stdio: command, arguments, env vars) or a URL (streamable HTTP + headers). Secrets are encrypted with DPAPI (`safeStorage`) in the settings table; only key names reach the window. Connect, reconnect, enable/disable, edit, remove. Servers connect at startup. The bundled local AI shows as a read-only "local" provider. |
| Per-tool permission | done | Read-only tools (MCP `readOnlyHint`) default to Auto, the rest to Ask. Never hides the tool from agents. A "costs money" tick makes a tool ask every time, with no "Always allow". The in-panel prompt offers Allow once / Always allow / Deny / Never, and shows the call's input. |
| External tools in the agent loop | done | Offered as `server__tool`. MCP results are converted to Claude content: text, images, links and resources, with long text cut at 60k characters. The system prompt says how to bring generated media in. Calls are logged in `tool_calls`. |
| New editor tools | done | `set_canvas_size` (ratio presets), `import_media`, `import_from_url` (http(s), video/audio/image only, 2 GB cap, saved to the cache), `add_to_timeline`. These moved from the MCP server into the shared tool list, so Claude Code and the panel agent get the same set. |
| Agent library (S31) | done | Six built-ins: Editor, Silence cutter, Captioner, Short-form maker, Filler-word remover, Highlight finder. They are re-seeded on start and are read-only; "Duplicate to edit" copies one. Custom agents set instructions, a tool allow-list (globs), model (or "from Settings"), effort, review or auto-apply, and a suggested request. Migration 002 adds `agent_defs.starter`. There is a picker in the agent panel header. The runner refuses calls to tools the agent wasn't given. |
| Batch (F14) | partial | On Home, "Select for an agent" lets you pick projects and run one agent on all of them, one after another, with live progress. Edits either apply automatically or wait in each project's agent panel ("pending" proposals load when the project opens). Ask-tools are refused in a batch, because nobody is there to approve them. Photos come in M7. |
| Conflict "Ask again" | done | When a proposal can't apply because the timeline changed, the review dialog discards it and sends the same request to the same agent. |
| OAuth MCP servers, JSON import/export of agents | not built | Servers that need a browser sign-in aren't supported yet. Agents can't be shared as files yet. |

Notes:
- Pending proposals live in memory, so they are lost if the app restarts before review. The transcript and ops stay in SQLite, so this could be rebuilt later.
- The fake model (`FRAMEVANE_FAKE_AGENT=1`) gained policies for "test tool" (calls `*__make_clip` → import → place) and "mark…" (adds a marker). The e2e fixture `e2e/test-mcp-server.mjs` is a real stdio MCP server.

## M3 text, captions, audio (2026-10-11)

| area | status | notes |
| --- | --- | --- |
| Text (S06, S19) | done | Text clips have a transform + keyframes like media, and on-canvas handles (layout is shared with the compositor through `textGeometry`). Style: font, weight, B/I/U, size, colour, outline, shadow, box (colour, opacity, roundness), letter spacing, line height, alignment; explicit line breaks. New op `set_text`. 12 presets, previewed by the real compositor on small canvases. |
| Text animation (S17 for text) | partial | In/out: fade, slide up/down/left/right, pop, zoom, typewriter, wipe, each with a length. A split keeps the in-animation left and the out-animation right. No loop animations yet. |
| Fonts | done | Windows-installed families (listed via System.Drawing, drawn by name), imported .ttf/.otf/.woff/.woff2 (family/weight/italic read from the name and OS/2 tables, served as `framevane-media://font/…`), 9 bundled OFL/Apache display fonts (fontsource, pinned). |
| Text to speech | done | Kokoro v1.0 int8 in the sidecar (12 voices, a one-time 120 MB download with SHA-256 pinned; 4.8 s of speech in 1.75 s on the CPU) + the Windows SAPI voices. Cached by voice + speed + text. The audio lands on an audio track under the text. |
| Captions | done | Style gains font, box, shadow, spacing, a highlight colour (or none), one-word-at-a-time; 5 presets. SRT/TXT export, SRT/VTT import. |
| Transcript editing (S30) | done | In the Captions tab: words of the main track, click to jump, Shift/Ctrl to select, Delete or "Cut N selected", "Remove N fillers". Each cut is one undo step. |
| Audio | done | Fades (preview + export, outer fades survive a split). Clean-up = FFmpeg to a new file of the same length: denoise ×3, enhance voice, normalize (−14 LUFS). A video clip's sound moves to a linked cleaned audio clip. "Lower under speech" writes a volume curve with the new `set_keyframes` op. Voiceover recording with a mic picker, recording at the playhead while the timeline plays. |
| Agent tools | done | add_text, edit_text, export_captions, import_captions, remove_filler_words, clean_audio, duck_music, list_voices, text_to_speech; set_clip fades; style_captions with font/box/highlight/one-word. New built-in agent "Sound fixer"; Filler-word remover, Captioner and Short-form maker use the new tools. All of these also go to Claude Code over MCP. |
| ML noise removal (DeepFilterNet), beat detection, stems, loop text animations | not built | DeepFilterNet needs PyTorch; FFmpeg's afftdn covers most room noise. Beats and stems are later should-haves. |

Harder than expected:
- **BUG-011:** the seed video's audio track is 1.3 s shorter than its picture, so the first cleaned file was shorter than the clip and the op was rejected. Processed audio is now padded to the source's full length.
- axe checks colour contrast even on `aria-hidden` text, and treats outlined text by its stroke colour. The preset previews are now drawn on canvases by the compositor (more faithful anyway).
- The inspector column didn't scroll; the longer text inspector spilled over the timeline.

## M4 visuals (2026-10-12)

| area | status | notes |
| --- | --- | --- |
| Look pipeline | done | WebGL2 shader passes per clip (chroma key → filter → LUT → colour → effects), run inside the shared compositor, so preview and export match (the export test checks pixels of the MP4). Clips without a look take the old path unchanged. Pictures are processed at the size they are shown, never above the source. |
| Filters (S10) | done | 20 own looks in 6 groups (natural, warm, cool, vivid, film, black & white) with strength. Each is a set of colour values plus optional split toning, so agents can read what a filter does. Tile previews are drawn by the same shaders on a drawn sample scene. |
| LUTs | done | 3D .cube import (validated, 1D refused with a reason), stored once in the app's luts folder by content hash, strength per clip. Project files list them (`luts`), and `add_lut` registers one (undoable). |
| Basic colour (S18) | done | 13 sliders in Light, Colour and Finish groups, and Reset. Not keyframable yet. |
| Effects (S08) | done | 22 own effects with params, up to 8 per clip, run in order; reorder and remove in the inspector's new Effects tab. They go on clips, not as separate effect segments on the timeline. |
| Transitions (S09) | done | 16 own transitions, 0.1–5 s, centred on the cut. They read past each clip's ends (the media's handles), holding the first or last frame where there's no more media, so the timeline's timing never changes. "Apply to all cuts". A diamond on the timeline marks each one. A split keeps the transition on the right piece. |
| Chroma key | done | Remove BG tab: colour (swatches, hex, or pick from the screen), intensity, edge softness, keep shadows, remove spill. |
| Agent tools | done | list_looks, adjust_color, apply_filter, apply_lut (path or id), add_effect, remove_effect, set_transition (per clip or a whole track), chroma_key; get_timeline now reports each clip's look. New built-in agent "Look designer". All of these also go to Claude Code over MCP. |
| Adjustment layers, saved colour presets, HSL, curves, keyframed effect params | not built | should-haves |

Harder than expected:
- **BUG-013:** the first chroma key measured plain colour distance, so a real green screen (darker than pure #00ff00) didn't key at the default settings. It now compares hue direction and relative saturation.
- Picking the GPU API: WebGPU submits work asynchronously, which would have split the one synchronous draw function that preview and export share. WebGL2 (GLSL ES 3.0) runs inside it (see Deviations).
- Transitions mix premultiplied layers; with straight alpha a cross-fade over the background came out too dark.

## Next (architecture build order)

- **Still open from M1/M2:**
  - the S21 curve graph
  - a crash test for the journal
  - run F12 and `get_frames` against the live Claude API (needs a key)
  - OAuth MCP servers
  - agent import/export
- **M5 AI:**
  - Remove BG (RVM for video, BiRefNet for photos), local on the GPU
  - auto reframe (subject tracking → keyframes)
  - a model download manager in settings (S23)
