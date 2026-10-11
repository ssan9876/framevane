# Recon map: CapCut Desktop (Windows desktop)

Scope: the core desktop editor (multi-track video timeline, text, captions, audio,
effects, filters, transitions, color, keyframes, masks, AI tools, export), a photo
editor, and a pluggable AI agent layer that CapCut does not have in this form. No
templates marketplace, cloud spaces, teams or accounts.
For: the owner's own content production (store ads, social video). Single user, local-first,
no billing. Every CapCut "Pro" or credit-gated feature is a free local feature here.
Date: 2026-10-11

Clean-room rules for this project: public sources only. No CapCut code, assets, fonts,
music, effects or copy go into the clone. `replica/screens/` is for reference
screenshots only. None have been captured yet; add them from the user's own
CapCut install if wanted, and never ship them.

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | pricing page | https://www.capcut.com/pricing | Free / Pro $19.99 / Ultra $79 / Teams $12.49 per seat; AI credits; 1 TB cloud |
| 2 | help: Pro features | https://www.capcut.com/help/capcut-pro | Pro categories: text templates, transitions, effects, body effects, filters |
| 3 | help: 2026 pricing change | https://www.capcut.com/help/new-capcut-subscription-pricing | Apr 8 2026: credits 550→1200, 100 GB→1 TB, Standard tier |
| 4 | help: export gating | https://www.capcut.com/help/join-capcut-pro-for-exporting | Desktop locks 4K, 60 fps and No Watermark; a Pro asset blocks export |
| 5 | help: Pro icon | https://www.capcut.com/help/how-to-remove-pro-features | Pro badge on items; export blocked until removed |
| 6 | help: credits | https://www.capcut.com/help/how-to-use-credits | Remove BG, Smart Cutout, AI Portrait, script-to-video, premium voices spend credits |
| 7 | help: export | https://www.capcut.com/help/export-videos-in-capcut | Export button top-right; resolution, fps ≤60, bitrate |
| 8 | help: 2K/4K greyed | https://www.capcut.com/help/no-2k-or-4k-option-for-export | Export resolution capped by project settings |
| 9 | help: watermark | https://www.capcut.com/help/video-without-watermark | Ending clip with logo |
| 10 | help: auto captions | https://www.capcut.com/help/how-to-recognise-subtitles | Captions > Auto captions > language > Generate |
| 11 | help: auto cut | https://www.capcut.com/help/auto-cut-in-capcut | Beat sync, speech-pause detection, script-based cut (Feb 2026) |
| 12 | help: transitions | https://www.capcut.com/help/transitions-in-capcut | Drag between adjacent clips; duration on the timeline |
| 13 | help: login | https://www.capcut.com/help/log-in-to-capcut | Google / TikTok / Facebook / QR (not cloned) |
| 14 | marketing: desktop editor | https://www.capcut.com/tools/desktop-video-editor | Keyframe graphs, color wheels, smart search, cloud space |
| 15 | marketing: desktop AI | https://www.capcut.com/tools/desktop-ai-power | Script-to-video, filler-word removal, smart search, auto reframe, retouch, cutout, TTS, AI presenter |
| 16 | blog: pro editor | https://www.capcut.com/resource/pc-professional-video-editor | Masks, motion tracking, chroma key, HSL, optical flow, vocal isolation, voice clone, proxy mode, track magnet |
| 17 | blog: PC Pro list | https://www.capcut.com/resource/capcut-pro-pc | Pro-gated: TTS, noise reduction, enhance voice, AI color, retouch, remove BG |
| 18 | blog: Standard vs Pro | https://www.capcut.com/resource/capcut-standard-vs-pro | Claims captions, tracking, noise reduction, BG removal are Pro (conflicts with others) |
| 19 | blog: how to use on PC | https://www.capcut.com/resource/how-to-use-capcut-on-pc | Home screen cards, left tabs, export fields |
| 20 | blog: keyframes | https://www.capcut.com/resource/how-to-add-keyframes-in-capcut | Diamond buttons, Alt+K keyframe panel |
| 21 | blog: remove BG | https://www.capcut.com/resource/how-to-remove-background-in-capcut | Auto / custom brush / chroma key sub-panel |
| 22 | blog: caption generator | https://www.capcut.com/resource/video-caption-generator | Language, bilingual, highlight keywords |
| 23 | blog: overlay | https://www.capcut.com/resource/overlay-video-on-video | Mask shapes, feather, blend modes |
| 24 | marketing: upscaler | https://www.capcut.com/tools/ai-video-upscaler | Video > Basic > Enhance quality |
| 25 | marketing: relight | https://www.capcut.com/tools/relight-videos-with-ai | Relight presets and controls |
| 26 | marketing: stabilize | https://www.capcut.com/tools/video-stabilization | 3 stabilize levels |
| 27 | marketing: voice changer | https://www.capcut.com/tools/voice-changer | Voice effects, noise reduction |
| 28 | marketing: photo editor | https://www.capcut.com/tools/photo-editor | Image editor feature list |
| 29 | marketing: AI image desktop | https://www.capcut.com/tools/ai-image-generator-desktop | AI design: upscale, remove BG, expand, inpaint, remove |
| 30 | blog: EditPilot | https://www.capcut.com/resource/how-to-use-editpilot-in-capcut-pc | Prompt-driven rough cut (Aug 2026), the closest thing to our agent layer |
| 31 | newsroom: Seedance 2.5 | https://www.capcut.com/newsroom/giving-creators-more-control-with-dreamina-seedance-2-5-and-dola-seedream-5-0-pro | Gen-video / gen-image models (Jul 2026) |
| 32 | legal: material license | https://www.capcut.com/clause/material-license-agreement | Music, fonts, stickers, effects are licensed platform materials |
| 33 | App Store listing | https://apps.apple.com/us/app/-/id1500855883 | Speed 0.1–100x, curves, freeze, optical flow, chroma key, stabilize |
| 34 | Microsoft Store listing | https://apps.microsoft.com/detail/xp9kn75rrb9nhs | Search snippet only (fetch empty) |
| 35 | third-party tutorial | https://primalvideo.com/guides/capcut-for-pc-mac-tutorial/ | Project "Modify" dialog, Q/W ripple delete, transcript editing, audio tools |
| 36 | third-party: timeline | https://filmora.wondershare.fr/advanced-video-editing/capcut-timeline.html | Timeline toolbar, magnet/snap/linkage/preview axis, track lock/hide/mute |
| 37 | third-party: shortcuts | https://tutorialtactic.com/blog/capcut-shortcuts/ | Full shortcut list |
| 38 | third-party: shortcuts | https://fastshortcuts.com/shortcuts/capcut/ | Shortcut table (cross-check) |
| 39 | third-party changelog | https://pixflow.net/blog/?p=94259 | 2026 timeline of releases |

## Core loop

Drop clips on a timeline, cut them, add captions, text and music, then export an MP4
for social. CapCut's Pro tier gates 4K/60 fps/no-watermark export, captions, TTS, BG
removal, noise reduction and premium effects.

**Our loop:** the same, with nothing gated, plus "tell an agent what you want". The
agent reads the timeline, calls editor tools and local/remote AI models, and proposes
edits you accept or reject.

## Screens

Screens S01–S26 come from CapCut. S27–S31 are new screens for the agent layer.

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Home / projects | app launch | create, open, rename, duplicate, delete projects | Create-project button, "Photo editor" card, project grid (thumb, name, duration, modified), search, "..." menu, Settings button | empty (no projects), filled, project missing media |
| S02 | Project settings ("Modify") | editor > inspector with nothing selected > Modify; or on create | set canvas | name, ratio (Original/16:9/9:16/1:1/4:3/21:9/custom), resolution, fps, copy-vs-link media, proxy toggle | default, adapted-to-first-clip |
| S03 | Editor shell | open a project | main 4-pane workspace | menu bar (File/Edit/View/Help), project name + autosave status, Export button, resizable panes, layout presets | loading project, filled, missing-media relink banner |
| S04 | Asset panel: Media | editor left panel, tab 1 | import and manage project media | Import drop zone, media grid with duration, filter (video/audio/image), "+" add, drag to timeline, used-in-project dot | empty (big drop zone), importing/generating proxies, filled, unsupported file error |
| S05 | Asset panel: Audio | left panel tab | music, SFX, extract audio | sub-list (Local music, SFX, Extracted, Free library), waveform preview, "+" | empty library, filled, preview playing |
| S06 | Asset panel: Text | left panel tab | add text and text presets | "Default text" card, style presets, our own text templates, local font import | filled |
| S07 | Asset panel: Stickers | left panel tab | add stickers/emoji/shapes | grid, search, import PNG/GIF/Lottie as sticker | empty, filled |
| S08 | Asset panel: Effects | left panel tab | video effects and body effects | category list, preview-on-hover cards, "+", drag onto a clip or onto its own track | filled, preview playing |
| S09 | Asset panel: Transitions | left panel tab | transitions | category list, cards, drag between clips, "Apply to all" | filled; invalid drop (gap between clips) |
| S10 | Asset panel: Filters | left panel tab | LUT/look filters | cards, intensity, import .cube LUT | filled |
| S11 | Asset panel: Captions | left panel tab | auto captions, import SRT, caption templates | Auto captions form (language, bilingual, highlight keywords, emoji, source track), Generate, Import SRT | idle, generating (progress), done, no speech found |
| S12 | Asset panel: Adjustment | left panel tab | adjustment layers and saved color presets | "Adjustment layer" card, saved presets | empty, filled |
| S13 | Player | editor center | preview, direct manipulation | canvas with bounding box handles, play/pause, timecode, preview-quality dropdown, ratio dropdown, fullscreen, safe-area guides | no media, playing, scrubbing, proxy preview |
| S14 | Inspector: Video | select a video/image clip | per-clip visual props | sub-tabs Basic (position/scale/rotation/opacity + keyframe diamonds, blend mode, canvas bg, auto reframe, stabilize, enhance quality, relight, flicker removal), Remove BG (auto, smart brush/eraser, chroma key), Mask (shapes, feather, invert, keyframes), Retouch (skin, face) | default, AI processing (progress), applied, AI error |
| S15 | Inspector: Audio | select clip with audio | sound props | volume dB + diamond, fade in/out, normalize, noise reduction, enhance voice, vocal isolation, voice changer, pitch | default, processing |
| S16 | Inspector: Speed | select clip; Ctrl+R | speed | Normal (0.1–100x slider + duration field), Curve (presets + editable bezier), smooth slow-mo (optical flow), keep pitch | default, rendering optical flow |
| S17 | Inspector: Animation | select clip/text/sticker | in/out/combo animations | In / Out / Combo sub-tabs, preset cards, duration slider | none applied, applied |
| S18 | Inspector: Adjust (color) | select clip or adjustment layer | color grading | Basic (temp, tint, exposure, contrast, highlights, shadows, saturation, vibrance, sharpen, vignette), HSL (8 hues), Curves (RGB + channels), Color wheels, LUT slot, Auto adjust, Save preset | default, modified (reset arrow) |
| S19 | Inspector: Text | select text/caption clip | text styling + TTS | content box, font, size, bold/italic/underline, color, stroke, shadow, background, spacing, alignment, presets, "Apply to all captions", Text-to-speech sub-tab (voice grid, preview, Generate speech) | default, TTS generating, TTS done (new audio clip) |
| S20 | Timeline | editor bottom | arrange clips | left toolbar (select/split mode, undo/redo, split, delete left/right, freeze, reverse, mirror, rotate, crop, marker), right toggles (magnet, snapping, linkage, preview axis, zoom slider, fit), ruler with markers, track headers (lock/hide/mute, cover), clips with thumbs/waveforms/keyframe diamonds, playhead, right-click menu (group, compound, copy, paste, delete, detach audio) | empty ("drag media here"), filled, multi-select, drag in progress, snap guide shown |
| S21 | Keyframe graph panel | Alt+K or clip keyframe button | edit easing | per-property lanes, bezier handles, easing presets | no keyframes, keyframes present |
| S22 | Export dialog | Export button, top-right | render output | name, folder, video toggle (resolution 480p–4K+, fps 24–60+, bitrate preset/custom, codec H.264/HEVC/AV1/ProRes, format MP4/MOV/WebM/GIF), audio-only toggle (MP3/WAV/AAC), captions SRT/TXT, range (all / in-out / selected) | settings, exporting (progress %, ETA, cancel), done (open folder), error (encoder failed) |
| S23 | Settings | top-right gear or menu | preferences | General (project folder, autosave interval, language), Performance (HW encode/decode, proxy, preview quality, cache size + clear), Shortcuts, AI (local model paths, GPU device), Agents (see S28) | default, saved |
| S24 | Keyboard shortcuts | Settings > Shortcuts, or `?` | view and rebind keys | grouped list, search, click-to-rebind, conflict warning, reset to defaults | default, rebinding, conflict |
| S25 | Photo editor | Home > Photo editor, or right-click an image > Edit photo | edit images | canvas, layers panel (image/text/sticker/shape, reorder, lock, hide), tools (crop, resize, adjust, filters, cutout/remove BG, AI expand, inpaint/remove object, upscale, retouch), export PNG/JPG/WebP | blank canvas, image loaded, AI processing, exported |
| S26 | Script-to-video / AI video maker | Home > AI video maker | rough draft from a script | script box (write or generate), style, ratio, voice, duration, Create → scene list editor | idle, generating, draft created (opens S03) |
| S27 | **Agent panel** (new) | editor right dock tab or Ctrl+Space | chat with editing agents | agent picker, chat thread, context chips (selected clips, playhead, range), tool-call log, attach media, Stop button | idle, thinking, running tools (step list), awaiting approval, error, done |
| S28 | **Agents & tools settings** (new) | Settings > Agents | plug in agents and tools | providers (Claude API key, model), MCP servers list (add stdio/HTTP, enable, tool list), local tools (Whisper, rembg/SAM, Real-ESRGAN, RIFE, Demucs, Piper TTS) with install status, per-tool permission (auto / ask / never) | none configured, connected, server error, model downloading |
| S29 | **Edit proposal review** (new) | appears when an agent finishes a batch | approve agent edits | before/after preview, list of operations (each toggleable), Accept all / Accept selected / Reject, "Open as new version" | pending, applied, rejected |
| S30 | Transcript / text-based editing | Captions tab > Transcript, or quick tool | edit video by editing words | word list synced to playhead, select words → delete/cut, filler-word and silence highlights, "Remove all fillers" | not transcribed, transcribing, ready |
| S31 | **Agent library** (new) | Agent panel > "Agents" | saved agents and recipes | cards for built-in agents (Captioner, Silence cutter, Ad-cut maker, Color matcher, Photo retoucher, Reframer), create custom agent (name, system prompt, allowed tools, model), import/export agent JSON | empty (built-ins only), filled |

## Flows

```
F01 Create a project and import media
    S01 -> S02 (optional) -> S03 -> S04 import -> drag to S20
    happy path clicks: 4 (CapCut ~4). Beat it: drop files on the Home screen to create a project and auto-place clips (2)
    edge: unsupported codec, very large/4K files (proxy prompt), media path later moved (relink), VFR phone footage

F02 Cut and trim
    S20: playhead -> Ctrl+B split -> select -> Delete, or Q/W ripple delete; edge-drag trim
    happy path clicks: 2
    edge: split on a linked A/V clip, ripple with magnet off, trim past source length, split inside a transition

F03 Add text / titles
    S06 "+" -> S19 type + style -> S17 animation
    happy path clicks: 3-4
    edge: missing font on reopen, emoji/RTL text, text off canvas

F04 Auto captions
    S11 Auto captions -> language -> Generate -> captions track -> S19 "apply to all" style
    happy path clicks: 3
    edge: no speech, music under speech, multiple speakers, long video (progress + cancel), re-generate after edit (keep styling)

F05 Add music and fix audio
    S05 -> "+" -> S15 fade / volume keyframes / ducking / noise reduction
    happy path clicks: 3
    edge: music longer than video (auto trim + fade), beat-snap markers, clipping peaks

F06 Transition between clips
    S09 -> drag between two clips -> duration
    happy path clicks: 2
    edge: gap between clips, clip shorter than transition, "apply to all"

F07 Keyframe animation
    select clip -> S14 Basic -> diamond -> move playhead -> change value (auto keyframe) -> S21 easing
    happy path clicks: ~5
    edge: keyframes after trim/speed change, copying keyframes between clips

F08 Remove background / chroma key
    select clip -> S14 Remove BG -> Auto  (or Chroma key -> eyedropper -> intensity)
    happy path clicks: 3
    edge: no person detected, long clip (background job, progress), hair edges, then re-trim

F09 Color correct
    select clip -> S18 -> Auto adjust or sliders / LUT -> Save preset -> apply to others
    happy path clicks: 3
    edge: adjustment layer over many clips, HDR/log footage

F10 Export
    S22 -> resolution/fps/format -> Export -> progress -> Open folder
    happy path clicks: 2
    edge: disk full, 4K from 1080p source (warn, don't block), cancel mid-render, export captions only

F11 Edit a photo
    S01 Photo editor -> open image -> S25 cutout / adjust / text -> export
    happy path clicks: 4
    edge: huge images, transparent PNG export, multi-layer save/reopen

F12 Ask an agent to edit   (new)
    S27 type "cut silences, add captions, punch-in on emphasis, 9:16" -> agent plans -> calls tools
    -> S29 review proposal -> Accept
    happy path clicks: 2 + prompt
    edge: agent proposes an invalid op (validator rejects), tool fails mid-batch (partial rollback),
          user edits timeline while agent runs (conflict -> rebase or abort), cost/time limits, offline (local-only tools)

F13 Plug in a new agent tool   (new)
    S28 -> Add MCP server (command or URL) -> tool list appears -> set permission -> available in S27
    happy path clicks: 3
    edge: server crashes, tool with huge outputs, tool asks for a file path outside project

F14 Run a saved agent recipe on many clips/photos   (new)
    S31 pick "Photo retoucher" -> select 20 photos in S04 -> Run -> S29 batch review
    edge: partial failures, cancel mid-batch

F15 Text-based edit
    S30 transcribe -> select words -> delete -> timeline ripples
    happy path clicks: 3
    edge: words spanning a cut, multi-track audio
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Button | primary (Export, Generate), secondary, ghost, icon, danger | default, hover, focus, active, disabled, loading | all |
| Icon toggle | timeline toggles (magnet, snap, linkage, preview axis), track lock/hide/mute | on, off, hover, disabled | S20 |
| Slider + numeric field | linear, bipolar (−100…100), dB, speed (log scale) | default, dragging, edited (reset arrow), disabled | S14–S19, S25 |
| Keyframe diamond | inspector button, on-clip marker, graph point | none, has keyframes (outline), keyframe at playhead (filled), selected | S14–S19, S20, S21 |
| Tab bar | top-level (asset panel), inspector tabs, sub-tabs (segmented) | active, inactive, hover, badge (processing) | S04–S19 |
| Category list | vertical sub-nav inside asset tabs | active, hover | S05–S12 |
| Asset card | media, effect/filter/transition preview, voice, agent | default, hover-preview, adding, added, missing-file, generating | S04–S12, S19, S31 |
| Dropdown / select | plain, with search (fonts, languages) | closed, open, disabled | S02, S11, S13, S22 |
| Color picker | swatch, HSV + hex, eyedropper from canvas | closed, open, picking | S14, S19, S25 |
| Curve editor | speed curve, color curves, keyframe easing | idle, dragging point | S16, S18, S21 |
| Color wheel | lift/gamma/gain | idle, dragging | S18 |
| Timeline clip | video, image, audio (waveform), text, sticker, effect, adjustment, caption, compound | default, hover, selected, trimming, dragging, disabled (V), missing media, processing | S20 |
| Track header | main, overlay, audio, text, effect | default, locked, hidden, muted | S20 |
| Playhead + ruler | timecode ruler, markers (colored) | idle, scrubbing | S20, S21 |
| Canvas transform box | handles, rotate, snap guides, safe area | idle, hover, dragging | S13, S25 |
| Modal | settings, export, project settings, review | open, busy, error | S02, S22, S23, S29 |
| Progress | inline bar, modal %, on-clip shimmer, background-job tray | indeterminate, %, done, failed | S04, S11, S14, S22, S27 |
| Toast | info, success, warning, error, with action (Undo) | entering, shown, leaving | all |
| Context menu | clip, track, media item, keyframe, project card | open | S01, S04, S20, S21 |
| Chat thread | user msg, agent msg, tool-call step (collapsible), proposal card, error | streaming, done, failed | S27 |
| Operation list | toggleable diff row (op + target + preview thumb) | included, excluded, applied, failed | S29 |
| Empty state | drop zone, illustration + action | default, drag-over | S01, S04, S20, S31 |

## Inferred data model

No user or account entities: it is a single-user local app. Projects are JSON files (plus a
media cache) on disk. The timeline document is the contract that both the UI and the
agents edit.

```
Project      id, name, created_at, updated_at, canvas {width, height, fps, ratio, bg},
             media_mode (copy | link), proxy_enabled, cover_frame, version
             evidence: S02 Modify dialog, draft folder com.lveditor.draft, source 35
             confidence: high

MediaAsset   id, project_id, kind (video | audio | image | gif | lottie), path, hash,
             duration_ms, width, height, fps, codec, has_audio, proxy_path, thumbs_path,
             waveform_path, transcript_id?, analysis {scenes[], beats[], faces[]?}
             evidence: S04 media grid, proxy mode (source 16), smart search (14)
             confidence: high (analysis fields: guess)

Track        id, project_id, kind (main | video | audio | text | effect | adjustment | caption),
             order, locked, hidden, muted, name
             evidence: S20 track headers (source 36)
             confidence: high

Clip         id, track_id, kind (video | image | audio | text | sticker | effect | filter |
             adjustment | caption | compound), asset_id?, start_ms (timeline), in_ms, out_ms (source),
             speed {mode: normal|curve, rate, curve_points[], keep_pitch, optical_flow},
             reversed, frozen_frame_ms?, transform {x, y, scale, rotation, opacity, flip_h, flip_v, crop},
             blend_mode, mask {shape, x, y, w, h, rotation, feather, invert}?,
             bg_removal {mode: auto|brush|chroma, params, matte_path}?,
             color {basic{}, hsl{}, curves{}, wheels{}, lut_id?, intensity},
             audio {volume_db, fade_in_ms, fade_out_ms, normalize, denoise, enhance, voice_fx, pitch},
             animations {in, out, combo}, effects[EffectInstance], enabled, group_id?, linked_clip_id?
             evidence: S14–S19 inspector fields, sources 16, 21, 23, 33
             confidence: high

TextContent  clip_id, text, rich_spans[], font_family, font_size, color, stroke, shadow,
             background, align, letter_spacing, line_height, preset_id?
             evidence: S19 · confidence: high

CaptionSeg   id, clip_id (caption track), start_ms, end_ms, text, words[{w, start, end, highlight}],
             translation?, style_ref
             evidence: S11, keyword highlight, bilingual (source 22) · confidence: high

Keyframe     id, clip_id, property (e.g. transform.scale, audio.volume_db, mask.x), time_ms,
             value, easing {preset | bezier[4]}
             evidence: sources 20, 14 (keyframe graphs) · confidence: high

Transition   id, track_id, from_clip_id, to_clip_id, type, duration_ms, params
             evidence: source 12 · confidence: high

EffectDef    id, name, category (video | body | filter | transition | animation | text-anim),
             shader/graph ref, params schema, thumbnail. These are OUR authored presets.
             evidence: S08–S10 · confidence: medium

EffectInstance  id, clip_id | track_id, effect_def_id, start_ms, duration_ms, params, keyframes[]
             confidence: medium

Marker       id, project_id, time_ms, color, label · evidence: shortcuts M/Alt+M · confidence: high

Group / Compound  id, clip_ids[] (compound = nested timeline doc) · evidence: Alt+G · confidence: medium

Transcript   id, asset_id, language, words[{w, start, end, speaker?, filler?}], model
             evidence: S30, remove filler words (15) · confidence: medium

ExportJob    id, project_id, settings {res, fps, codec, format, bitrate, audio_only, range},
             status (queued | running | done | failed | cancelled), progress, output_path, error
             evidence: S22 · confidence: high

Preset       id, kind (color | text | export | agent), name, payload · confidence: medium

PhotoDoc     id, name, width, height, layers[Layer], history · evidence: S25, source 28 · confidence: medium
Layer        id, photo_id, kind (image | text | sticker | shape | adjustment), z, transform,
             opacity, blend_mode, mask_path?, payload, locked, hidden

--- agent layer (new, not inferred from CapCut) ---
AgentDef     id, name, description, system_prompt, model, allowed_tools[], default_permission,
             builtin (bool)
ToolProvider id, kind (builtin | mcp_stdio | mcp_http | local_model), name, command/url,
             env (secrets kept in the OS keychain), enabled, tools[{name, schema, permission}]
AgentRun     id, project_id, agent_def_id, prompt, context {selection, playhead, range},
             status (thinking | running | awaiting_review | applied | rejected | failed),
             messages[], tool_calls[], cost_tokens, started_at, ended_at
EditOp       id, run_id, op (add_clip | split | trim | delete | move | set_prop | add_keyframe |
             add_caption | apply_effect | ...), target_ids, before, after, applied (bool)
             = the same op format as undo/redo, so agent edits are undoable like user edits
```

Relationships: Project 1-n MediaAsset, Project 1-n Track, Track 1-n Clip, Clip 1-n Keyframe,
Clip 1-n EffectInstance, Track 1-n Transition, Clip(caption) 1-n CaptionSeg, MediaAsset 0-1 Transcript,
Project 1-n Marker, Project 1-n ExportJob, Project 1-n AgentRun, AgentRun 1-n EditOp,
AgentDef n-n ToolProvider tools, PhotoDoc 1-n Layer.

## Feature matrix

See `features.csv`. 144 rows. Must: 61, should: 52, could: 22, skip: 9.
The `original` column is `no` for features CapCut lacks (the agent layer, auto ducking, batch).
The notes column records CapCut's gating ("CapCut: PRO" / credits). Every one of those is free here.

## Out of scope (cannot or should not be cloned)

- **CapCut's music, SFX, stock media, sticker packs, effect/filter/transition packs and text templates.**
  These are licensed platform materials (source 32). We author our own effects and presets,
  and plug in free libraries (Pixabay/Freesound/OpenMoji/Google Fonts) or user-supplied packs.
- **Fonts.** CapCut's fonts are licensed. We ship open fonts (OFL) and import local system fonts.
- **Hosted gen-AI models** (Seedance, Seedream, Veo, Kling, Sora, PixVerse). These are not ours to clone.
  The agent layer can call any model the user has access to (for example the Higgsfield MCP or the
  Claude API), using the user's own keys and billing.
- **Accounts, cloud Space, Teams, template marketplace, TikTok direct publishing.** Not needed for a
  single-user local tool. Later: "share to YouTube" via the user's own OAuth.
- **CapCut branding, UI artwork and copy.** We rebuild layout and behavior, not looks; replica-brand names it.

"All features free" means the features are free because they run locally (FFmpeg, open
models) or on the user's own API keys. Generative AI that needs a hosted model still
costs whatever that provider charges.

## Size

Screens 31, flows 15, entities 18.

Hard parts:
1. **Real-time multi-track preview compositor.** GPU compositing of video, text, masks, blend
   modes, effects and color at full fps with frame-accurate seeking. This is the make-or-break piece.
2. **One render graph shared by preview and export.** The export must look identical to the
   preview (FFmpeg filtergraph vs a WebGL/wgpu shader path).
3. **Timeline interaction model.** Magnet, snapping, ripple, linkage, transitions, keyframes
   that survive trims and speed changes, and undo/redo for all of it.
4. **Local AI pipeline.** Whisper captions, segmentation (rembg/SAM2/RVM) for video matting,
   ESRGAN upscale, RIFE interpolation, Demucs vocal isolation and TTS: packaging, GPU/CPU fallback,
   background jobs.
5. **Agent integration.** A typed edit-op API, a validator, a proposal/review UI, conflict
   handling while the user also edits, and MCP client plumbing.

Size: **L** (a quarter) for must + should with a solid compositor. A thin vertical slice
(import → cut → caption → export, plus an agent that can cut silences and caption) is about 2–3 weeks.
