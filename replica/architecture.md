# Architecture: framevane (working name), a rebuild of CapCut Desktop's core features plus a pluggable agent layer

Inputs: `recon.md` (S01–S31, F01–F15), `features.csv` (61 must / 52 should / 22 could / 9 skip).
Target machine: Windows 11, Ryzen 7 7700X, 32 GB RAM, RTX 4060 (CUDA + NVENC) plus an AMD iGPU.
Installed toolchain: Node 24, pnpm, uv, FFmpeg 9, Rust.

The default replica stack is for web SaaS: Next.js, Postgres, auth and Stripe. This app is a
single-user, local-first desktop editor, so every layer is swapped. There is no server, no
accounts and no payments. The only network calls are the user's own API keys and MCP servers.

## Stack

| layer | choice | why |
| --- | --- | --- |
| desktop shell | **Electron** + electron-vite + TypeScript | Chromium gives the same WebCodecs and WebGPU on every install. The Node main process hosts the Anthropic TS SDK, the MCP SDK, FFmpeg and SQLite. Tauri's WebView2 would also work, but agents, MCP and the native processes would then span two languages. |
| UI | React + Zustand (with immer patches) | Familiar. The patches map directly to the op journal. |
| styling | Tailwind with tokens from replica-design | |
| packages | pnpm workspaces | `apps/desktop`, `packages/doc` (schema + ops), `packages/render`, `packages/agent`, `packages/mcp-server`, `sidecar/` (Python) |
| project document | `project.json` per project folder, typed by **zod**, versioned, plus an append-only `ops.jsonl` journal | Portable. External agents and git can read it. Crash recovery replays the journal. |
| app index database | **SQLite** via better-sqlite3 (`schema.sql`, 17 tables) | One local file holding the project list, media cache, jobs and the agent log. No server. |
| demux / mux | **Mediabunny** (WebCodecs-native, MP4/MOV/WebM/MKV) | Frame-accurate packet access for the decoder. Muxes the encoder output. |
| decode (preview + export) | **WebCodecs VideoDecoder**, hardware (NVDEC through Media Foundation/D3D11) | H.264, HEVC, VP9 and AV1 decode on the GPU without copying frames through Node. |
| compositor | **WebGPU** + WGSL shaders, running in a worker on an OffscreenCanvas | `importExternalTexture(VideoFrame)` avoids copies. Effects, transitions, masks, blend modes, color and chroma key are all shaders. Text, Lottie and stickers are drawn to Canvas2D and uploaded as textures. |
| encode | **WebCodecs VideoEncoder** (NVENC H.264/HEVC/AV1), muxed by Mediabunny | **The same compositor renders preview and export**, so what you see is what you export. |
| audio | Web Audio for preview; **OfflineAudioContext** renders the export mix to WAV | One graph definition is built for both contexts. |
| FFmpeg (bundled, LGPL build) | probe, proxy/mezzanine transcode, waveforms, thumbnails, final mux + AAC/MP3/Opus encode, GIF/ProRes/WebM, loudnorm, vidstab | Covers what WebCodecs can't do. Runs as a child process in the main process. |
| local AI | **Python sidecar** (uv-managed, Python 3.12, PyTorch CUDA 12 + ONNX Runtime CUDA/DirectML), served as an **MCP server over stdio** | The editor's agents call local AI the same way they call any third-party MCP server. Models download on first use to `%LOCALAPPDATA%\framevane\models`. |
| local models | faster-whisper large-v3-turbo (captions, word timings) · RobustVideoMatting + BiRefNet + SAM 2 (background removal, cutout, brush) · Real-ESRGAN (upscale) · RIFE (frame interpolation) · Demucs v4 (stems) · DeepFilterNet 3 (noise reduction / enhance voice) · Kokoro / Piper (TTS) · LaMa (inpaint) · PySceneDetect · librosa beats · YOLO/face tracker (auto reframe) | All free, with open weights. Each fits in 8 GB of VRAM on its own. The sidecar runs one GPU model at a time. |
| agents (in-app) | **Anthropic TS SDK `@anthropic-ai/sdk`**, Tool Runner (`client.beta.messages.toolRunner` + `betaZodTool`), model **`claude-opus-5-5`** by default (picker: Sonnet 5.5 / Haiku 5.5 for cheap batch agents) | Edit-op schemas are already zod, so they become tools for free. Per-turn hooks provide permission gates and cancellation. |
| agent tools from elsewhere | **`@modelcontextprotocol/sdk` client** in the main process (stdio + streamable HTTP) | Supports local stdio servers (the AI sidecar, filesystem tools) and remote ones (Higgsfield etc.). The API's server-side MCP connector is URL-only, so a local client is required. |
| editor as a tool | **`@modelcontextprotocol/sdk` server** on `127.0.0.1` (streamable HTTP, bearer token) | Claude Code or any external agent can drive the open project, using its own auth (no API key needed in the app). |
| secrets | Electron `safeStorage` (DPAPI) | API keys and MCP env values never touch SQLite or `project.json`. |
| tests | Vitest (doc/ops, render golden frames), Playwright for Electron (flows) | Golden-frame tests guard preview/export parity. |
| packaging | electron-builder (NSIS). The sidecar Python environment is created by uv on first launch. | No Python install needed. |

One process tree, no microservices:
```
Electron main (Node) ── SQLite · job queue · FFmpeg children · AgentRunner (Claude) · MCP client hub · MCP server (editor)
 ├─ renderer (React UI)  ← typed IPC (contextBridge, zod-validated) →  main
 ├─ render worker (WebGPU compositor + WebCodecs decode/encode)  ← MessagePort → renderer
 └─ sidecar (Python, MCP stdio) ← MCP client hub
```

## Project document (the contract the UI and agents share)

Every change to a project is an **op**. The UI, keyboard shortcuts, undo/redo, the agent panel
and external MCP agents all go through the same `applyOps(doc, ops) → {doc, inverse}`. A new
feature exists once it has an op, and an agent can use it as soon as that op exists.

```ts
// packages/doc — sketch; zod schemas generate TS types + JSON Schema for tools
Project   { schema: 3, id, name, canvas: {w, h, fps: {num, den}, bg: Bg}, tracks: Track[], markers: Marker[],
            media: Record<AssetId, AssetRef>, captionStyles, version }
Track     { id, kind: 'main'|'video'|'audio'|'text'|'effect'|'adjustment'|'caption', locked, hidden, muted, clips: Clip[] }
Clip      { id, kind, assetId?, derived?: {kind, assetId}, startUs, inUs, outUs,
            speed: {mode:'normal'|'curve', rate, curve?, keepPitch, opticalFlow}, reversed, freezeAtUs?,
            transform: {x, y, scale, rotation, opacity, flipH, flipV, crop}, blend, mask?, bgRemoval?,
            color?: {basic, hsl, curves, wheels, lut?, intensity}, audio?: {volumeDb, fadeInUs, fadeOutUs,
            normalize, denoise, enhance, voiceFx, pitch}, anim?: {in, out, combo}, effects: EffectInstance[],
            keyframes: Record<PropPath, Keyframe[]>, text?: TextContent, captions?: CaptionSeg[],
            enabled, groupId?, linkId? }
Transition { id, trackId, fromClipId, toClipId, type, durationUs, params }
```

**Op catalogue**, each one {zod args, apply, invert, validate}:
`add_track · remove_track · set_track_flags · add_clip · remove_clips · move_clips · trim_clip ·
split_at · ripple_delete_range · set_clip_props (path, value) · set_speed · reverse · freeze_frame ·
add_keyframe · remove_keyframe · set_keyframe_easing · add_transition · remove_transition ·
apply_effect · remove_effect · set_effect_params · add_text · set_text · add_captions (segments) ·
set_caption_style (all|ids) · add_marker · group · ungroup · make_compound · set_canvas ·
attach_derived (clipId, derivedAssetId)` (results of AI jobs are attached through this op).

Rules: ops are deterministic and pure. Times are integer microseconds, snapped to the project's
frame grid when committed. A batch is atomic. Each commit bumps `doc.version`, appends to
`ops.jsonl`, and autosaves `project.json` atomically (write a temp file, then rename) at most once every 2 s.

## Schema

Tables: **17** (`replica/schema.sql`, SQLite). Access rules: **data-layer checks in the main
process.** Only the main process opens the DB. The renderer and every agent reach data through
typed IPC handlers or MCP tools that validate input with zod and confine file paths to the project
folder, the media cache and user-picked paths.

| group | tables |
| --- | --- |
| projects + media | `projects` (video and photo), `media_assets` (global, keyed by content hash), `project_media`, `derived_assets` (non-destructive AI outputs, LRU cache), `analyses` (transcripts, scenes, beats, silences, faces…) |
| work | `jobs` (one queue for proxies, AI work and exports; the dedupe key collapses repeats), `export_jobs` |
| agents | `tool_providers`, `provider_tools` (per-tool `auto/ask/never`, `mutates`, `costs_money`), `agent_defs`, `agent_runs` (tokens + cost), `agent_messages` (append-only transcript), `tool_calls`, `edit_ops` (proposals, same format as the undo journal) |
| misc | `presets`, `fonts`, `settings` |

The hard constraints are enforced in the DB:
- One active job per piece of work: a unique partial index on `jobs.dedupe_key WHERE status IN (queued, running)`.
- Media used by a project can't be deleted: `project_media.asset_id ON DELETE RESTRICT`.
- An AI result is computed once per source and params: `derived_assets UNIQUE(source, kind, params_hash)`.
- Valid ranges: `CHECK (range_out_us > range_in_us)`.

## API

There are no HTTP routes. The "API" has three surfaces:
- **IPC** (renderer → main), typed `invoke` channels.
- **Tools**, shared by the in-app agent and the editor's MCP server.
- **The sidecar's MCP tools.**

### IPC channels, by flow

| channel | does | who | input | output | flow |
| --- | --- | --- | --- | --- | --- |
| `project.list` | list projects for Home | renderer | `{type?, query?}` | `ProjectSummary[]` | F01 |
| `project.create` | make a folder + `project.json`, insert a row | renderer | `{name, type, canvas?, files?}` | `{projectId}` | F01, F11 |
| `project.open` / `close` | load the doc, start the journal | renderer | `{projectId}` | `Project` | F01 |
| `project.rename` / `duplicate` / `delete` | manage projects | renderer | `{projectId, …}` | `ok` | S01 |
| `project.settings` | change canvas (an op) | renderer | `{canvas}` | `{version}` | S02 |
| `doc.apply` | commit an op batch (the only mutation path) | renderer, AgentRunner, MCP server | `{projectId, baseVersion, ops[]}` | `{version, inverse}` or `CONFLICT` | all |
| `doc.undo` / `doc.redo` | walk the op journal | renderer | `{projectId}` | `{version}` | all |
| `media.import` | hash, probe, register; queue proxy/thumbs/waveform | renderer | `{projectId, paths[]}` | `AssetRef[]` | F01 |
| `media.relink` | find moved files by hash / pick a folder | renderer | `{assetIds, folder?}` | `{relinked, missing}` | F01 edge |
| `analysis.request` | transcribe / scenes / beats / silences | renderer, agent | `{assetId, kind, opts}` | `{jobId}` | F04, F15 |
| `ai.process` | matte, upscale, interpolate, stabilize, denoise, stems, tts, inpaint, expand, reframe | renderer, agent | `{kind, assetId?, range?, params}` | `{jobId}` → `derived_assets` | F05, F08, S14–S16 |
| `jobs.subscribe` / `jobs.cancel` | progress stream / cancel | renderer | `{filter}` / `{jobId}` | events | all |
| `export.start` | render on a doc snapshot | renderer, agent | `ExportSettings` | `{jobId}` | F10 |
| `export.captions` | SRT/TXT from caption tracks | renderer, agent | `{projectId, format}` | `{path}` | F04, F10 |
| `photo.*` | open/save the photo doc; same op model with layer ops | renderer, agent | … | … | F11 |
| `fonts.list` / `fonts.import` | font index | renderer | — | `Font[]` | F03 |
| `presets.*` | color/text/caption/export presets | renderer | … | … | F09 |
| `settings.get` / `set` | prefs, shortcuts, AI device, cache cap | renderer | `{key, value}` | — | S23, S24 |
| `agent.run` | start a run from the panel | renderer | `{projectId, agentDefId?, prompt, context}` | `{runId}` + event stream | F12 |
| `agent.permission` | answer a tool-permission prompt | renderer | `{toolCallId, allow, remember?}` | — | F12 |
| `agent.review` | apply the included ops / reject | renderer | `{runId, includeOpIds[], action}` | `{version}` or `CONFLICT` | F12, F14 |
| `agent.cancel` | stop the loop and the running jobs | renderer | `{runId}` | — | F12 |
| `agent.batch` | run one agent def over N assets/photos | renderer | `{agentDefId, assetIds[], prompt}` | `{parentRunId}` | F14 |
| `agents.defs.*` | CRUD for agent definitions; import/export JSON | renderer | … | … | S31 |
| `tools.providers.*` | add/enable/remove MCP servers; list tools; set permission | renderer | `{kind, command/url, env}` | `{tools[]}` | F13, S28 |
| `secrets.set` / `secrets.has` | write-only key storage | renderer | `{name, value}` | `bool` | S28 |

### Agent tool surface (in-app agent and the editor MCP server expose the same set)

Read tools (permission `auto`):
- `get_project_summary` – tracks, clip counts, duration, canvas.
- `get_timeline(range?)` – a compact JSON view of clips, ids and times.
- `get_selection` – what the user has selected.
- `get_transcript(assetId | clipId)` – words with timeline times.
- `find_silences(threshold, minMs)`, `find_scenes`, `find_beats`.
- `get_frames(times[], maxEdge=768)` – JPEG image blocks for vision.
- `list_media`, `list_effects`, `list_fonts`, `list_presets`.

Write tools (permission `auto` in propose mode, because nothing applies until review):
- Every op in the catalogue, plus convenience macros: `cut_ranges`, `add_captions_from_transcript`,
  `reframe(ratio, follow:'face'|'subject'|'center')`, `auto_duck(musicTrack, voiceTrack)`,
  `apply_color_preset(clipIds)`, `beat_sync(clipIds, beats)`.

Job tools (permission `ask` by default):
- `run_ai(kind, …)` – a sidecar job that returns a `derivedAssetId`.
- `export(settings)`.

External tools: any MCP server's tools, namespaced `provider__tool`. The permission defaults to
`ask`. A tool flagged `costs_money` (for example remote generation) is always `ask` unless the
user changes it.

Tool results carry **ids and times, not media.** Images only come back from `get_frames`, as
downscaled JPEG. Large results (a full transcript of an hour of video) are paged.

### Agent loop (AgentRunner, main process)

1. Fork the doc at `base_doc_version`. Write tools mutate the **fork** and record ops into `edit_ops`.
2. Run the Tool Runner loop. Settings:
   - `model` from the agent def (default `claude-opus-5-5`) and `output_config.effort` set
     explicitly (default `medium`; it's the model's default too).
   - Adaptive thinking, with `display: "updates"` (beta `thinking-display-updates-2026-08-18`)
     so S27 shows progress notes.
   - Streaming, with `eager_input_streaming` on client tools and parsed inputs validated against zod.
   - `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`). Check `stop_reason` for
     `refusal` / `max_tokens` before running tools.
   - `tool_choice: auto` only. Forced tool choice returns a 400 on Opus 5.5.
3. Prompt caching: the tool list and system prompt are frozen and sorted, with a cache breakpoint
   after them. The project summary and selection go in the first user turn. Per-turn reminders use
   mid-conversation `system` messages. History is **append-only** (preserved thinking): never edit
   earlier turns. Compaction (`compact-2026-01-12`) applies to long runs.
4. A per-turn hook checks the tool's permission. For `ask`, it emits `awaiting_permission` to S27
   and waits. It also enforces the agent def's `allowed_tools` and `max_cost_micro_usd`.
5. On `end_turn`, the status becomes `awaiting_review`. S29 renders a before/after (fork vs
   current) and the op list.
6. Accept → `doc.apply({baseVersion, ops})`. If the user has edited since, the ops are rebased:
   op targets are ids, not indexes. Each op re-validates. Ops that no longer apply are marked
   `conflicted` and shown in S29.

**External agents (Claude Code etc.):** they connect to `http://127.0.0.1:<port>/mcp` with the
token shown in Settings > Agents. They get the same tools against the open project. The project's
review mode decides whether their edits arrive as proposals (S29) or apply directly, so the user
can undo them.

### Sidecar MCP tools (Python, stdio)

`transcribe · detect_scenes · detect_beats · detect_silences · matte_video · cutout_image ·
segment_click (SAM 2) · upscale · interpolate · stabilize · denoise_audio · enhance_voice ·
separate_stems · tts · inpaint · outpaint (optional SD/Flux if installed) · track_subject (reframe) ·
models.status / models.download`

Every tool takes file paths and params and writes outputs under `cache/derived/`. Long tools
stream MCP progress notifications, and `notifications/cancelled` stops them.

**External services** (official APIs, user's own keys, all optional):
- Anthropic Messages API.
- Any MCP server the user adds (for example Higgsfield for gen-image/video/TTS on their account).
- Pexels/Pixabay/Freesound APIs for stock media and music.
- YouTube Data API upload (OAuth), later.

Never CapCut's endpoints.

**Webhooks in/out:** none (desktop app).

**Jobs:**

| job | schedule | what it does |
| --- | --- | --- |
| probe + thumbs + waveform | on import | ffprobe; sprite thumbnails; peak file |
| mezzanine | on import if the file isn't WebCodecs-decodable, is VFR, or is HDR | full-resolution, constant-frame-rate H.264 high-bitrate copy; HDR tone-mapped to BT.709 |
| proxy | on import if longer edge > 1920 or the user enables it | 1080p/720p short-GOP H.264 for scrubbing |
| analyses | on demand, plus prefetch transcription after import if "auto-transcribe" is on | Whisper, scenes, beats, silences |
| AI processing | on demand (UI or agent) | sidecar tools → `derived_assets` |
| export | user/agent | compositor render → mux → FFmpeg finalize |
| autosave | 2 s after the last commit | atomic `project.json` write |
| cache GC | app start + daily | LRU-evict proxies and derived assets over the cache cap (default 50 GB); never evicts anything an open project uses |
| sidecar health | app start + on demand | start the uv environment, check CUDA, report models present |

## The parts that bite

- **Time and frame accuracy:**
  - Store integer µs. Seek by presentation timestamp, not by time ÷ fps.
  - Phone footage is often VFR, so it gets the mezzanine.
  - Speed curves map timeline time to source time through an integrated curve that is cached per clip.
  - Audio is sample-accurate and video frame-accurate. The two are reconciled in one timebase at export.
- **Preview/export parity:** one compositor, one shader set, one audio graph builder. A golden-frame test suite renders N fixtures in both modes and diffs them.
- **Performance:**
  - Decoder pool: one `VideoDecoder` per visible clip, with a cap, LRU-reused, and pre-roll ahead of the playhead.
  - `VideoFrame.close()` discipline: a leaked frame stalls the hardware decoder.
  - Preview drops to proxy and half resolution under load, and export always uses full resolution.
  - 4K × 4 tracks on a 4060 is the benchmark to hit by M3.
- **Color:** BT.709 everywhere in v1. HDR/HLG phone clips are tone-mapped in the mezzanine. LUTs (.cube) are applied in linear or log space as tagged.
- **Idempotency:**
  - Jobs dedupe on `dedupe_key`.
  - AI outputs are cached by `params_hash`.
  - An agent re-running a tool returns the cached derived asset.
  - Op batches carry `baseVersion`, so a retried apply after a crash is rejected as stale, not doubled.
- **Races:**
  - The user edits while an agent runs: the agent works on a fork and the apply rebases by id.
  - Two agents at once: allowed, each on its own fork, applied in order.
  - An export takes a doc snapshot at start, so edits during export don't affect it.
- **Crash safety:**
  - `ops.jsonl` journal plus atomic `project.json` writes. On open, replay journal entries newer than the snapshot.
  - The sidecar is crash-isolated: restart it and retry the job once.
- **GPU contention:**
  - The sidecar runs one model at a time and gets 6 GB of VRAM.
  - The compositor and NVENC share the rest.
  - The AMD iGPU must not be picked for WebGPU: request the high-performance adapter.
- **Large files:** stream everything. Never load a whole video into memory. The cache size and location are configurable; the default should go on D:, not C:.
- **Paths:** the user profile path contains a space (`C:\Users\Seth Sander`). Always use argv arrays for FFmpeg and the sidecar, never shell strings. Long paths need `\\?\` handling in FFmpeg calls.
- **Agent safety:**
  - Transcripts, filenames, MCP tool output and frames are **untrusted data**. They go in tool results, never into the system prompt.
  - Tool file paths are confined.
  - `costs_money` tools always prompt.
  - The external MCP server binds to 127.0.0.1 only and needs a per-install token.
- **Rate limits / cost:**
  - Show tokens and $ per run (`usage` incl. cache reads).
  - Per-agent `max_cost_micro_usd`.
  - Handle 429 with the SDK's retries and back-off.
  - Batch runs (F14) use bounded concurrency (3).
- **Licensing:**
  - Bundle an LGPL FFmpeg build. NVENC works in LGPL builds; avoid `--enable-gpl` x264 in the bundle and use the hardware encoder.
  - Model licenses: RVM is GPL-3, which is fine for personal use and flagged if the app is ever distributed. Real-ESRGAN BSD, Whisper MIT, Demucs MIT, Kokoro Apache, SAM 2 Apache, LaMa Apache.
  - Fonts: OFL only.
- **Not applicable:** time zones, email deliverability, multi-tenancy, GDPR deletion, search at scale. Search is a local SQLite FTS over transcripts and media names if needed.

## Build order

Each milestone ends with the app runnable and the slice's ops exposed as agent tools.

1. **M0 vertical slice (≈2–3 weeks):** import → cut → auto-caption → export, plus an agent that removes silences and captions.
   - Screens: S01 (minimal), S03, S04, S13, S20 (one video track + one caption track), S11 (generate only), S22 (MP4 H.264 only), S27 (minimal), S29.
   - Tables: `projects`, `media_assets`, `project_media`, `jobs`, `export_jobs`, `analyses`, `settings`, `agent_runs`, `agent_messages`, `tool_calls`, `edit_ops`.
   - Ops: `add_clip`, `split_at`, `trim_clip`, `remove_clips`, `ripple_delete_range`, `add_captions`.
   - Channels: `project.create/open/list`, `media.import`, `doc.apply/undo/redo`, `analysis.request` (transcribe, silences), `export.start`, `agent.run/review/cancel`.
   - Sidecar with only `transcribe` + `detect_silences`.
   - Proves: WebCodecs decode → WebGPU composite → WebCodecs encode → mux, the op model, and the agent loop.
2. **M1 timeline must-haves:**
   - S20 complete: multi-track, magnet, snapping, linkage, copy/paste, zoom, lock/hide/mute, mirror/rotate/crop.
   - S16 speed (normal), S14 Basic (transform, opacity, blend, canvas bg, keyframes), S13 on-canvas transforms, S02, S24 shortcuts.
   - PiP overlay tracks; proxy + mezzanine jobs; autosave/journal.
3. **M2 agent platform must-haves:**
   - The full op catalogue as tools; `get_frames` vision.
   - **Editor MCP server** (Claude Code can drive it).
   - **MCP client hub** + S28 (add stdio/HTTP servers, tool list, per-tool permission).
   - Claude provider + key in safeStorage; permission prompts; cost tracking; tables `tool_providers`, `provider_tools`, `agent_defs`.
4. **M3 text, captions, audio must-haves:**
   - S06/S19 text + fonts, caption styling + apply-to-all, SRT export.
   - S05/S15 music, volume/keyframes, fades, waveforms, noise reduction (DeepFilterNet), TTS (Kokoro).
5. **M4 visuals must-haves:**
   - S08/S09/S10 own WGSL effect, transition and filter library (≈20 / 15 / 20 to start); .cube LUTs.
   - S18 basic color; chroma key.
6. **M5 AI must-haves:** S14 Remove BG (RVM video, BiRefNet image); auto reframe (subject tracking → keyframes); model download manager in S23.
7. **M6 export + settings must-haves:**
   - S22 complete: H.264/HEVC/AV1 up to 4K60 with no watermark, bitrate presets, progress/cancel.
   - S23 performance and cache settings.
8. **M7 photo editor must-haves:** S25 layers, crop/resize, adjust/filters, cutout, PNG/JPG/WebP with alpha; the same op/agent model (`photo.*` ops).
9. **Should-haves**, in this order:
   - Agents: S31 library with built-in recipes (Captioner, Silence cutter, Ad-cut maker, Reframer, Color matcher, Photo retoucher), batch runs (F14), conflict UI.
   - S30 transcript editing + filler removal; S21 keyframe graph; curve speed + optical flow (RIFE).
   - Masks, stabilize, upscale, Demucs stems, beats + auto-duck, HSL/curves, animations, audio-only/range export, AI inpaint/expand/upscale in the photo editor.
10. **Could-haves:** compound clips, motion tracking, color wheels, retouch, relight, script-to-video and long-to-shorts (agent recipes), gen-AI in the media panel via MCP, plugin SDK.
11. **Fixes from replica-entrepreneur:** once it has run (CapCut's paywall moves, export bugs, the missing ducking toggle and so on are likely themes).

Size check: this matches the recon estimate of **L**. M0–M2 is roughly 5–7 weeks and the rest of the must-haves another 5–6.
