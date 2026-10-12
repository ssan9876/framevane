# Brand: Framevane

Chosen 2026-10-11. Replaces the working name "reel", which collided with Instagram Reels in this exact category.

**Angle:** this came from the build, because replica-entrepreneur hasn't run and there is no `fixes.md`. Framevane is a free, local-first video editor that your AI agent can drive:
- every "Pro" feature without a subscription
- footage never leaves your PC
- Claude edits alongside you, live and undoable

**Name idea:** a frame is the unit of video. A vane is the thing that turns to show which way to go. You set the direction; the agent helps you get there.

## 1. Candidates

20 generated across five styles (descriptive, compound, invented, metaphor, verb), then cut by these filters:
- **Not confusable with the original:** no "Cap", no "-Cut" twin, nothing near its "EditPilot" feature.
- **Not confusable with apps in this category.**
- **Easy to say and spell.**
- **Fits the angle.**

| style | candidates | outcome |
| --- | --- | --- |
| descriptive | Clipdesk, Editbay, Splicework, Cutbench | cut: "Cut-" echoes the original; the rest are generic |
| compound | Takewise, Framewright, Cueboard, Clipsmith, Trimtide | Takewise and Cueboard clash in the App Store (a YouTube summarizer; "Creator Shot Lists") |
| invented | Vidora, Montra, Kliqo, Editra, **Framevane**, **Takevane** | Montaj/Montra exist as editors or brands; Framevane and Takevane are clean |
| metaphor | Kiln, Lathe, Rushes, Sprocket, Slate | Kiln clashes ("Kiln – AI App Builder"); the rest are taken in media or apps |
| verb | Splice, Trim, Assemble | Splice is a large audio brand; the others are too generic |

## 2. Screening checks

These are screening checks run on 2026-10-11, **not legal clearance**. Before spending money on the name, get a trademark search from a lawyer.

| check | Framevane | Takevane | Splicevane | Vitascope | Takeforge |
| --- | --- | --- | --- | --- | --- |
| .com (Verisign RDAP) | unregistered (404) | unregistered (404) | unregistered (404) | registered | registered |
| .app (Google RDAP) | unregistered (404) | unregistered (404) | unregistered (404) | unregistered (404) | unregistered (404) |
| GitHub handle | free | free | free | taken | to run |
| App Store exact name (iTunes Search API) | none | none | none | none ("VITA Video Editor" is close in sound) | none |
| Web "name + video editor" | no results | no results | to run | collides with VITA (SNOW, 100M+ users) | to run |
| US trademark (tmsearch.uspto.gov, classes 9 and 42) | **to run** | to run | to run | to run | to run |
| EU trademark (EUIPO eSearch / TMview) | **to run** | to run | to run | to run | to run |
| Canada (CIPO database) | **to run** | to run | to run | to run | to run |
| Global (WIPO Global Brand Database) | **to run** | to run | to run | to run | to run |
| Google Play exact name | **to run** | to run | to run | to run | to run |
| X / Instagram / TikTok handles | **to run** | to run | to run | to run | to run |

**Decision:** Framevane, chosen by the owner. Takevane is the fallback; its weakness is being misheard as "take vain". Splicevane was dropped because the "Splice" prefix is an established audio brand. Vitascope was dropped as too close to VITA in this category.

**To do before any spend:** register framevane.com and framevane.app, claim @framevane on GitHub/X/Instagram/TikTok, and run the four trademark searches.

## 3. Palette

Framevane uses **ember orange**, a warm, workshop feel. That is a different family from the original's black and white with bright cyan, and from the placeholder blue used during the build.

| role | value | note |
| --- | --- | --- |
| accent | `#ff7a3d` | primary buttons, active tabs, links, focus |
| accent-hover | `#ff9663` | |
| accent-soft | `#3a1f12` | selected rows, user chat bubbles |
| on-accent | `#1f0c03` | text on accent (7.29:1) |
| focus | `#ff7a3d` | 2px rings (≥6.4:1 on every surface) |
| warning | `#f2d04e` | moved toward yellow so it doesn't read as the accent |
| agent | `#c79bff` | unchanged: purple is reserved for "an agent did this" |

Neutrals, clip colours and markers are unchanged, except that marker-blue moved off the old placeholder hex. `python replica/design/contrast.py replica/design/tokens.json` reports **59 pairs, 0 failing AA**.

## 4. Logo brief

This is a brief for whoever draws it (you, a designer or an image model), not a logo.

- **Idea:** a weathervane arrow whose tail is a film frame: one mark that says "video" and "direction".
- **Mark type:** a symbol plus a wordmark. The symbol works alone as the app icon.
- **Must work at:**
  - 16 px favicon and Windows taskbar size: the arrow-frame silhouette, no inner detail.
  - 1024 px app icon.
- **Colour:** ember `#ff7a3d` on near-black `#0e0f11`, and a one-colour version for light backgrounds.
- **Wordmark:** "Framevane" in a geometric sans (Inter Display or similar, open licence), title case, no ligature tricks.
- **Deliverables:**
  - master SVG
  - Windows `.ico` (16–256)
  - 1024×1024 PNG app icon with no transparency (for a future macOS/iOS build)
  - favicon set
  - 1200×630 social image
- **Must not resemble the original's mark:**
  - no rounded black/white square with a cut or slash
  - no cyan
  - no stacked "C"-like letterforms
- Put the original's icon next to the drafts and check them side by side.

## 5. Voice

Three words, and what each does not mean:
- **Direct, not blunt:** say what happened and what to do next, kindly.
- **Warm, not cute:** a friend at the next desk, no mascots or exclamation spam.
- **Confident, not salesy:** state what it does ("never a watermark"), don't hype it.

| do | don't |
| --- | --- |
| "Your video is ready." | "Woohoo! Export complete!!" |
| "That file didn't come in." plus the reason | "Error 0x80070057" |
| "Nothing touches your project until you approve it." | "AI magic will transform your video ✨" |
| "Drop clips here, or press + on anything in Media." | "Drag and drop functionality is available." |
| "Never a watermark." | "Upgrade to remove the watermark" (or any upsell) |

### The 10 most-seen strings, rewritten (all fresh)

| where | before | after |
| --- | --- | --- |
| Home heading | Start something | What are we making? |
| New project card | Empty timeline · 1920×1080 · 30 fps | A blank 1080p timeline |
| Home drop zone | Drop clips here to start a project with them | Drop footage here and we'll set up a project around it |
| No projects | No projects yet / Make a new project, or drop a few clips… | Nothing here yet / Your projects will live here. Start one above, or drop in some footage. |
| Empty timeline | Drag media here, or press + on a clip in the media panel | Drop clips here, or press + on anything in Media |
| Media drop zone | Drop videos, photos or audio here | Drop video, photos or audio here |
| Export dialog | Rendered with the same engine as the preview, on your GPU. | Exactly what the preview shows, rendered on your GPU. Never a watermark. |
| Export done | Export finished | Your video is ready |
| Agent empty state | Ask for an edit / The agent edits a copy… | Tell me what to change / I work on a copy. Nothing touches your project until you approve it. |
| Import error | Import failed | That file didn't come in |

## 6. Sweep

`python sweep.py . --config replica/brand.json` came back **clean** on 2026-10-11. It checks names (CapCut, ByteDance, Jianying, EditPilot, Dreamina, Seedance, Seedream), domains, and the old placeholder colours.

**Renamed everywhere in shipped code:**
- the app name, window title and app-data folder (`%APPDATA%\Framevane`, Whisper models moved there)
- packages (`@framevane/*`) and CSS variables (`--fv-*`)
- the media protocol (`framevane-media://`) and environment variables (`FRAMEVANE_*`)
- the MCP server name (`framevane`) and the sidecar package (`framevane_sidecar`)

**Still to do by hand (outside the sweep's reach):**
- **Repo names:** the GitHub repo was renamed to `framevane` on 2026-10-12 (GitHub redirects the old URL). The local folder is still `capcut-clone-ai`; rename it when no editor or Claude Code session has it open.
- **App icon and favicon:** none exist yet; Electron's default icon is used. Make them from the brief above.
- **Claude Code entry:** anyone who added the old "reel" entry should click **Add to Claude Code** again; the server is now named "framevane".
- **Original's colours:** add the original's exact brand hex values to `brand.json` once confirmed from a primary source.
