# Framevane

A free video and photo editor for Windows and macOS, with AI agents built in. Everything runs on your own computer: no account, no watermark, no paid tiers. Claude can edit alongside you, either in the app's agent panel or from Claude Code over MCP.

## Download

**Windows:** get **Framevane-x.y.z-win-x64.zip** from [Releases](../../releases), unzip it anywhere, and run `Framevane.exe`. Nothing else needs installing.

**macOS:** get **Framevane-x.y.z-mac-arm64.dmg**, open it and drag Framevane into Applications. It's signed with a Developer ID and notarized by Apple, so it opens like any other app.

- Windows 10 or 11, 64-bit. A graphics card is used when there is one (NVIDIA, AMD or Intel), but isn't required.
- macOS 14 (Sonoma) or later on Apple Silicon (M1 or newer). Intel Macs aren't supported: the local AI's runtime has no Intel Mac build. On a Mac the local AI runs on the CPU.
- The local AI (captions, voices, background removal, auto reframe) sets itself up the first time you use it. It downloads its Python packages (about 1.5 GB) and each model once. **Settings → AI models** shows and manages them.
- The app isn't code-signed yet, so Windows SmartScreen may warn on first launch: **More info → Run anyway**.
- Shortcuts are listed the Windows way in places; on a Mac, Ctrl is ⌘.

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

**Templates (copy an edit)**
- Drop in a TikTok, Reel or Short you saved, or paste its link (Framevane fetches public posts with [yt-dlp](https://github.com/yt-dlp/yt-dlp); for posts that need an account it can use your browser's sign-in).
- Framevane finds every cut, so each shot becomes a slot with the same timing. It reads the on-screen text with local OCR (position, size, colour, text boxes) and keeps the sound.
- Templates stay in a library on the home screen. **Use** one, drop your clips in, and you get a normal project: your clips are cut to the original's timing and scaled to fill the frame, with the template's sound and editable text. Clips that are too short are slowed down to fit, and fewer clips than slots repeat.
- Claude Code can do the same over MCP: `make_template`, `list_templates`, `use_template`.
- Only use videos you have permission to reuse.

**Photo**
- Layers: images, text, shapes and emoji stickers; reorder, hide, lock.
- Crop, resize, rotate and flip; filters and colour; background removal.
- Export to PNG or WebP with transparency, or JPG.

**Agents**
- An agent panel (your Anthropic API key) with a library of agents (silence cutter, captioner, short-form maker, look designer, reframer, photo retoucher and more), a review step before changes apply, and batch runs.
- Framevane is also an **MCP server**. Connect Claude Code from Settings → Agents & AI → "Add to Claude Code", and it can open projects and edit them live with the same tools.
- Add your own MCP servers (stdio or HTTP) as extra tools, with per-tool permissions.

## Build from source

Requirements: Node 24, pnpm 9, [uv](https://docs.astral.sh/uv/), and FFmpeg on `PATH` for development (on a Mac: `brew install node pnpm uv ffmpeg`).

```bash
pnpm install
cd apps/desktop
node scripts/build.mjs        # build main, preload and renderer
pnpm start                    # run the app
npx playwright test           # end-to-end tests (Electron)
cd ../../packages/doc && npx vitest run   # unit tests
cd apps/desktop && node scripts/package.mjs   # release for this OS in apps/desktop/release/ (Windows zip, or Mac .dmg + .zip)
```

CI: `.github/workflows/macos.yml` runs the unit tests, the e2e suite and the Mac packaging on GitHub's Apple Silicon runners, and uploads the .dmg; `.github/workflows/windows.yml` runs the unit tests and the e2e suite on Windows.

Mac signing: with the repository secrets `MAC_CERT_P12` / `MAC_CERT_PASSWORD` (a Developer ID Application certificate as base64 .p12) and `ASC_KEY_P8` / `ASC_KEY_ID` / `ASC_ISSUER_ID` (an App Store Connect API key), the Mac release is signed with that Developer ID (hardened runtime, `build/entitlements.mac.plist`), notarized and stapled. Without them, as on pull requests from forks, it's ad-hoc signed and Gatekeeper asks users to approve it once (System Settings → Privacy & Security → Open Anyway). Locally, `package.mjs` reads `MAC_SIGN_IDENTITY` and `ASC_KEY_PATH` / `ASC_KEY_ID` / `ASC_ISSUER_ID` instead.

Layout: `apps/desktop` (Electron app), `packages/doc` (the project document, ops, timeline maths), `packages/ui` (design system), `sidecar` (local AI over MCP, Python via uv), `replica/` (planning and test docs).

## Third-party software

- The release bundles **FFmpeg** (GPL v3 builds: [Gyan](https://www.gyan.dev/ffmpeg/builds/) on Windows, [Martin Riedl](https://ffmpeg.martin-riedl.de) on macOS; licence and source pointers are in `resources/ffmpeg`) and **uv** (Apache-2.0 / MIT).
- Templates read on-screen text with [RapidOCR](https://github.com/RapidAI/RapidOCR) (Apache-2.0; PaddleOCR models) and fetch links with yt-dlp (Unlicense), both installed by uv when first used.
- AI models are downloaded on first use, not bundled: Whisper large-v3 turbo (MIT), Kokoro (Apache-2.0), BiRefNet (MIT), and Robust Video Matting (**GPL-3.0**).
- Fonts bundled from Fontsource are under the SIL Open Font License or Apache-2.0.
