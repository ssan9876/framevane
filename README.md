# Framevane

A free video and photo editor for Windows, with AI agents built in. Everything runs on your own computer: no account, no watermark, no paid tiers. Claude can edit alongside you, either in the app's agent panel or from Claude Code over MCP.

## Download

Get **Framevane-x.y.z-win-x64.zip** from [Releases](../../releases), unzip it anywhere, and run `Framevane.exe`. Nothing else needs installing.

- Windows 10 or 11, 64-bit. A graphics card is used when there is one (NVIDIA, AMD or Intel), but isn't required.
- The local AI (captions, voices, background removal, auto reframe) sets itself up the first time you use it. It downloads its Python packages (about 1.5 GB) and each model once. **Settings → AI models** shows and manages them.
- The app isn't code-signed yet, so Windows SmartScreen may warn on first launch: **More info → Run anyway**.

## What it does

**Video**
- Multi-track timeline: split, trim, ripple, magnet, snapping, linked audio, groups, markers, copy/paste, freeze frames, reverse, speed.
- Keyframes for position, scale, rotation, opacity and volume, with on-canvas handles.
- Text with fonts (system, imported, bundled), presets and animations.
- Word-timed captions from local Whisper; caption styles; SRT in and out; editing by transcript; filler-word removal.
- 22 effects, 16 transitions and 20 filters, all original shaders; .cube LUTs; 13 colour controls; chroma key.
- Background removal without a green screen, and auto reframe to 9:16, 1:1 or 4:5 that follows the speaker. Both run locally.
- Audio: fades, noise reduction, voice enhancement, loudness, ducking under speech, voiceover recording, text to speech (Kokoro and Windows voices).
- Export to MP4, MOV or WebM (H.264, HEVC, AV1, VP9) up to 4K60, plus GIF, audio only (MP3, M4A, WAV) and still frames, with ranges and custom bitrate.

**Photo**
- Layers: images, text, shapes and emoji stickers; reorder, hide, lock.
- Crop, resize, rotate and flip; filters and colour; background removal.
- Export to PNG or WebP with transparency, or JPG.

**Agents**
- An agent panel (your Anthropic API key) with a library of agents (silence cutter, captioner, short-form maker, look designer, reframer, photo retoucher and more), a review step before changes apply, and batch runs.
- Framevane is also an **MCP server**. Connect Claude Code from Settings → Agents & AI → "Add to Claude Code", and it can open projects and edit them live with the same tools.
- Add your own MCP servers (stdio or HTTP) as extra tools, with per-tool permissions.

## Build from source

Requirements: Node 24, pnpm 9, [uv](https://docs.astral.sh/uv/), and FFmpeg on `PATH` for development.

```bash
pnpm install
cd apps/desktop
node scripts/build.mjs        # build main, preload and renderer
pnpm start                    # run the app
npx playwright test           # end-to-end tests (Electron)
cd ../../packages/doc && npx vitest run   # unit tests
cd apps/desktop && node scripts/package.mjs   # release zip in apps/desktop/release/
```

Layout: `apps/desktop` (Electron app), `packages/doc` (the project document, ops, timeline maths), `packages/ui` (design system), `sidecar` (local AI over MCP, Python via uv), `replica/` (planning and test docs).

## Third-party software

- The release bundles **FFmpeg** (a GPL build; its licence and source pointers are in `resources/ffmpeg`) and **uv** (Apache-2.0 / MIT).
- AI models are downloaded on first use, not bundled: Whisper large-v3 turbo (MIT), Kokoro (Apache-2.0), BiRefNet (MIT), and Robust Video Matting (**GPL-3.0**).
- Fonts bundled from Fontsource are under the SIL Open Font License or Apache-2.0.
