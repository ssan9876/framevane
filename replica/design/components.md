# Components: framevane (working name)

Source of truth for the UI primitives. Code: `packages/ui/src/components/*`. Live gallery: `pnpm gallery`
(http://localhost:5199), with screenshot `replica/design/gallery.png`. Tokens: `tokens.json` → `node build-tokens.mjs`
→ `tokens.css` + `tailwind-theme.css`. Contrast: `python contrast.py tokens.json` (59 pairs, 0 AA failures).

## How this was derived

There were no screenshots of the original in `replica/screens/`. This system was rebuilt from the
recon component list (recon.md § Components) and the conventions shared by desktop NLEs:
- dark chrome only
- 12px default UI text
- 4px grid
- 3–10px radii
- colored clip kinds
- icon toolbars with shortcut tooltips

Nothing was measured from CapCut, and no CapCut asset, icon, font or copy is used. If CapCut
screenshots are added later, re-check density (track heights, panel widths) only. Do not chase their colors.

**Open-source parts:**
- **Lucide icons** (ISC).
- **Inter** and **JetBrains Mono** (OFL), bundled through `@fontsource-variable`, so they work offline.
- **Radix primitives** (MIT): dialog, popover, menus, tabs, select, slider, switch, checkbox, toggle group, toast and tooltip. They provide focus management, roving tabindex and ARIA.

## System rules

- **Colors are roles.** `--color-*` is cleared in the Tailwind theme, so only role utilities exist: `bg-surface`, `text-muted`, `border-border-input`, `bg-clip-audio` and so on. A raw palette class like `bg-blue-500` doesn't compile to anything.
- **Text color names:** `text-fg` is primary, `text-muted` secondary, `text-disabled` disabled.
- **Elevation is a surface step, not a shadow.** The scale is `bg` → `surface` (panels) → `surface-2` (inputs, cards, popovers) → `surface-3` (hover, selected). Shadows (`shadow-pop`, `shadow-modal`) are only for things that float.
- **Agent color (`agent`, `agent-soft`)** marks anything an agent did, is doing or proposes: chat, tool steps, processing bars on clips, and dashed outlines on proposed clips. Users must always be able to tell AI edits from their own.
- **Focus:** a global `:focus-visible` 2px `focus` outline. Inputs switch their border to `focus` instead. Never remove focus without a replacement.
- **Motion:** 100ms for hover and press, 160ms for popovers and dialogs, 240ms for panels. `prefers-reduced-motion` collapses all of it.
- **Density:** controls are 24px (sm) or 28px (md) high; 36px is used only for primary page actions. Hit targets below 24px (track toggles, keyframe diamonds) always have a tooltip and a keyboard path.
- **Copy:** every label and empty state is ours. Use sentence case. Say what to do next ("Import clips, photos or music to start editing").
- **Shortcuts:** every IconButton with a shortcut shows it in its tooltip. Shortcuts are rebindable (S24), so tooltips read them from the keymap, not from string literals (the gallery hardcodes them).

## Components

```
Button
  variants  primary (Export, Generate), secondary (default), ghost (Cancel, toolbar text), danger (destructive confirm), agent (Ask agent)
  sizes     sm 24px, md 28px, lg 36px
  states    default, hover, active, focus-visible (2px focus ring), disabled (45% opacity, no pointer events), loading (spinner replaces icon, label kept, aria-busy)
  tokens    primary: bg accent / text on-accent / hover accent-hover · secondary: surface-3 + border-strong · danger: danger-solid / on-danger · agent: agent-soft / agent · radius md (sm for size sm) · type sm, md weight 500
  a11y      real <button type=button>; loading keeps its accessible name; one primary button per surface
  used on   S01, S02, S11, S19, S22, S23, S25, S27, S28, S29, S31
```

```
IconButton
  variants  ghost (toolbars), secondary (floating controls on the player)
  sizes     sm 24px (icon 14), md 28px (icon 16)
  states    default (text-muted), hover (surface-3, text-fg), focus-visible, disabled (40%)
  tokens    text muted → fg, hover bg surface-3, radius sm
  a11y      `label` prop is required → aria-label + tooltip; `shortcut` shown in the tooltip
  used on   S03, S13, S20 toolbars, S04 tiles, panel headers everywhere
```

```
IconToggle
  variants  tone accent (modes: magnet, snapping, linkage, preview axis), tone warning (track lock, hide, mute: "something is off")
  states    off, on (accent: accent-soft bg + accent icon · warning: warning icon), hover, focus-visible, disabled
  a11y      aria-pressed; the label describes the action for the current state ("Lock Video 1" / "Unlock Video 1")
  used on   S20 toolbar, S20 track headers, S13 (safe-area guides)
```

```
TextField
  states    default, hover (border-strong), focus (border focus), error (border danger + message, aria-invalid, aria-describedby), disabled
  options   hideLabel (label stays for screen readers), leading icon, hint
  tokens    bg surface-2, border border-input (3.36:1 on surface-2), text md, placeholder muted, radius sm, height 28
  used on   S01 search/rename, S02, S22 file name, S23, S28 (MCP command/URL, env), S31
```

```
NumberField
  behavior  type and commit on Enter/blur; Esc reverts; ↑/↓ step (Shift ×10, Alt ×0.1); select-all on focus; optional unit suffix
  states    default, focus, invalid input (reverts on blur)
  a11y      role=spinbutton with valuenow/min/max
  used on   S14 position/rotation, S16 duration, S18, S22 bitrate, S25 resize
```

```
SliderField  (label · slider · number · reset · keyframe)
  variants  unipolar (fill from left), bipolar (fill from the default/center, e.g. temperature −100…100)
  states    default, dragging, modified (reset arrow appears), keyframed (diamond state), disabled
  behavior  drag the LABEL to scrub (pointer capture; Shift ×10, Alt fine); the slider has Radix keyboard support (arrows, PgUp/PgDn, Home/End)
  tokens    track border-strong 3px, range accent, thumb fg 12px, label sm muted, grid 88px | 1fr | 60px | 16px | 20px
  a11y      slider labelled by the label; number field has the same name; reset button "Reset <label>"
  used on   S14, S15, S16, S17, S18, S19, S25
```

```
KeyframeButton / Diamond
  states    none (muted outline: property not animated) · has (keyframe outline: animated, nothing at playhead) · on (keyframe fill: key at playhead)
  behavior  click toggles a key at the playhead; ‹ › jump to the previous/next key (shown only when animated)
  tokens    keyframe #f6c94e (≥5.1:1 on every clip fill, 10.6:1 on surface-2)
  a11y      aria-pressed = key at playhead; labels "Add/Remove <property> keyframe at playhead", "Previous/Next <property> keyframe"
  used on   S14–S19 next to every animatable property; S20 on clips (Diamond, decorative)
```

```
Switch
  states    off, on (accent track, on-accent thumb), focus-visible, disabled
  a11y      Radix switch (role=switch), label + optional description
  used on   S11 (bilingual, highlight keywords), S15, S16 (keep pitch, smooth slow-mo), S22, S23, S28 (provider enabled)
```

```
Checkbox
  states    unchecked, checked, indeterminate (bulk select), disabled, focus-visible
  used on   S11, S22 (export captions), S29 OpRow include, S04 multi-select
```

```
Select
  states    closed, open (popper), item highlighted, item disabled, disabled
  options   per-item hint (e.g. "free" next to 4K: everything is free, but the hint recalls CapCut's gate)
  a11y      Radix select: type-ahead, arrows, Esc; label linked via aria-labelledby
  later     a searchable variant (Combobox) for fonts and spoken languages: S19, S11
  used on   S02, S11, S13 (preview quality, ratio), S22, S23
```

```
PanelTabs  (asset panel top level)
  states    inactive (muted), hover (surface-3), active (accent text + 2px underline), disabled, with badge (e.g. processing dot)
  layout    icon over label, 48px high, scrolls horizontally when narrow
  a11y      Radix tabs: ←/→ roving focus, aria-selected, panels linked
  used on   S04–S12
```

```
UnderlineTabs  (inspector top level)
  states    inactive, hover, active (fg + accent underline), disabled (e.g. Speed on an image clip)
  used on   S14–S19, S22 (Video / Audio / Captions), S23 sections
```

```
Segmented
  states    off, on (surface-3 + shadow-card), disabled; sizes md 24px / sm 20px
  a11y      Radix toggle group type=single (never empty)
  used on   S14 (Basic | Remove BG | Mask | Retouch), S16 (Normal | Curve), S17 (In | Out | Combo), S18 (Basic | HSL | Curves | Wheels)
```

```
CategoryList
  states    inactive, hover, active (surface-3, aria-current)
  options   count per category
  used on   S05–S10, S12 (sub-categories inside asset tabs), S31
```

```
AssetCard
  states    ready, hover (ring border-strong + "+" reveals), selected (2px accent ring), generating (shimmer + progress), added (green check), missing (scrim + warning icon, warning title), used-in-project (green dot)
  layout    96×72 thumb, duration badge bottom-right (mono 10px on scrim), badge slot top-left (AI, Local), title under it
  behavior  body = select + hover preview; "+" = add at playhead; draggable to the timeline when ready
  a11y      two buttons, each with one job; body aria-label includes duration and "file missing"; "+" visible on keyboard focus
  used on   S04–S12, S19 (voices), S25 (filters), S31 (agents, larger variant)
```

```
TimelineClip
  kinds     video, image, audio, text, caption, sticker, effect, filter, adjustment → bg clip-<kind>; text fg ≥5.3:1 on all fills
  states    default (1px scrim outline), hover (trim handles 40%), selected (2px selection outline + handles 70%), disabled/V (hatched),
            missing ("Media offline" scrim), processing (agent progress line at the bottom), proposed by an agent (2px dashed agent outline),
            dragging/trimming (timeline controller; shows SnapGuide)
  content   label row (icon, name, speed badge), thumbnail strip (video), waveform (audio, clip-audio-wave), keyframe diamonds
  a11y      the timeline is role=grid with one row per track; a clip is a focusable gridcell announced as "<name>, <kind>, <start>–<end>[, selected][, disabled]"
            keys: ←/→ previous/next clip, ↑/↓ track, Enter opens in inspector, Space play, Ctrl+B split, Del delete, Q/W ripple delete
  used on   S20; mini variant in S29 (before/after) and S30
```

```
TrackHeader
  states    default, locked (warning lock icon, clips not editable), hidden (eye-off, track not rendered), muted (warning speaker)
  tokens    width 148, heights from layout.track-h (main 56, video 48, audio 40, text/caption 28, effect 24)
  a11y      role=rowheader; toggles are IconToggles named "<action> <track name>"
  used on   S20
```

```
Ruler / Playhead / SnapGuide
  ruler     mono 10px muted labels, major ticks chosen for ≥70px spacing, minor ticks = major/5; markers in marker-<color> (≥6.6:1 on timeline-bg)
  playhead  playhead color line + head; drag the head or click the ruler to seek; it does not take focus (the timeline grid owns seeking via keys)
  snap      1px snap-guide line while an edge snaps (playhead, clip edges, markers, beats)
  used on   S20, S21, S30
```

```
ColorPicker
  parts     swatch trigger (with hex) → popover: saturation/brightness square, hue strip, hex input, eyedropper (Chromium EyeDropper API: picks from the player for chroma key), swatches
  states    closed, open, dragging, invalid hex (reverts)
  a11y      square = slider (←/→ saturation, ↑/↓ brightness, Shift ×10) with aria-valuetext; hue = slider (←/→); hex input labelled
  later     opacity strip, recent colors, brand-kit colors (replica-brand)
  used on   S14 (canvas bg, chroma key), S19 (text, stroke, shadow, background), S25
```

```
CurveEditor
  behavior  drag points · double-click to add · select + Delete to remove · arrows nudge (Shift = 5%) · endpoints pinned to x=0/1 · x stays monotonic
  variants  luma / R / G / B channels (stroke color), speed curve (x = clip time, y = speed, log scale), keyframe easing (2 handles, S21)
  a11y      role=group, focusable; keyboard editing of the selected point; values mirrored in NumberFields for exact entry (S18)
  used on   S16, S18, S21
```

```
ColorWheel  (could-have, spec only; built with S18 Wheels in the should-have phase)
  parts     3 wheels (lift / gamma / gain) + a luminance slider each; drag the puck, double-click to reset
  a11y      each wheel = 2D slider like the ColorPicker square, plus NumberFields for R/G/B offsets
  used on   S18
```

```
CanvasTransformBox  (built with the player in M1; it needs the compositor's coordinate space)
  parts     bounding box, 8 resize handles, rotate handle, center snap guides (canvas center, edges, other layers), safe-area overlay
  states    idle, hover (thin outline), selected (handles), dragging (snap guides), multi-select
  behavior  Shift = keep aspect / snap rotation to 15°; Alt = scale from center; arrow keys nudge 1px (Shift 10px)
  a11y      the inspector NumberFields are the accessible equivalent; the box itself is pointer-only
  used on   S13, S25
```

```
Dialog
  states    open, busy (Esc/overlay/close disabled while exporting or applying), with footer actions
  tokens    surface bg, shadow-modal, radius lg, scrim 60% overlay, width 520 default (max 100vw−32)
  a11y      Radix dialog: focus trap, focus returns to the trigger, Esc closes, title + description wired
  used on   S02, S22, S23, S24, S29, S31 (edit agent), confirms
```

```
Popover / DropdownMenu / ContextMenu
  menu item states   default, highlighted (accent-soft), disabled (text-disabled), danger (text danger)
  item content       icon · label · shortcut (right, muted)
  a11y               Radix menus: arrows, type-ahead, Esc, submenus; a context menu also opens with Shift+F10 / the Menu key on a focused clip
  used on            S01 project card menu, S04 media menu, S20 clip/track menus, S21 keyframe menu, S03 menu bar
```

```
Tooltip + Kbd
  timing    500ms open delay, 200ms skip delay between neighbors
  content   short label + shortcut chip (Kbd: mono 10px, border-strong)
  a11y      supplements but never replaces an accessible name
```

```
Toast
  tones     info (accent), success, warning, error
  behavior  bottom-right stack; 4s auto-dismiss (paused on hover/focus) except error (sticky); optional single action (Undo, Show file)
  a11y      Radix toast: background tones announced politely, errors assertively; F8 jumps to the viewport
  used on   everywhere (Undo after delete, export done, AI job failed, agent applied N edits)
```

```
ProgressBar / Spinner / JobProgress
  states    determinate (0..1), indeterminate (sliding bar), tones accent / agent (AI work) / danger
  JobProgress  title · % · detail (ETA, encoder, device) · Cancel
  a11y      role=progressbar with valuenow (omitted when indeterminate) and a label
  used on   S04 import, S11 captions, S14 AI tools, S22 export, S23 model downloads, background-job tray in S03
```

```
Badge
  tones     neutral, accent, success, warning, danger, agent
  examples  "AI", "Local", "Uses paid credits", "Applied", "Conflict", "4K"
  used on   cards, op rows, tool steps, provider list (S28)
```

```
PanelHeader / EmptyState / DropZone
  PanelHeader  32px, title base/500, right-aligned IconButtons
  EmptyState   icon · title · one-line body · one action; copy says what to do next
  DropZone     idle (dashed border-input), drag-over (accent border + accent-soft + "Release to import"), disabled;
               always has a visible "browse your files" button (drag and drop is never the only path)
  used on      S01 (no projects), S04 (no media), S20 (empty timeline: "Drag media here or press Ctrl+I"), S27, S28, S31
```

### Agent layer (new; not in CapCut)

```
ChatMessage / AgentNote
  roles     user (accent-soft bubble, right), agent (surface-2 bubble, left, agent avatar)
  states    streaming (agent caret, aria-busy), done, with meta line (model · tokens · cost)
  AgentNote one-line italic muted progress note from the model's between-tool updates
  a11y      each message is an <article>; the transcript is a log region (aria-live=polite) that announces finished messages, not tokens
  used on   S27
```

```
ToolStep
  states    running (spinner, agent), done (check, success), error (alert, danger, starts expanded), awaiting permission (shield, warning), denied
  content   provider · tool (mono) · one-line summary · duration; expands to raw input/output (mono, selectable, max 192px)
  a11y      the header is a button with aria-expanded
  used on   S27, S29 (run log)
```

```
PermissionPrompt
  actions   Allow once (primary, autofocus) · Always allow (hidden when the tool costs money) · Deny
  content   provider.tool, why it is being called, "Uses paid credits" badge when costs_money
  a11y      role=alertdialog; focus moves to it; Esc = Deny
  used on   S27 (inline), S28 (permission defaults)
```

```
ProposalCard
  content   N edits ready · summary (cuts, tracks, keyframes) · cost · Review edits (primary) / Discard
  tokens    agent-soft bg, agent border
  used on   S27 end of run → opens S29
```

```
OpRow
  states    proposed (included / excluded: strikethrough + 55% opacity), applied (success badge), rejected, failed (danger), conflicted (warning; target changed since the run)
  content   include checkbox · thumb · label · target · time (mono) · status badge; clicking the label seeks the before/after preview to that op
  a11y      list of rows; checkbox named "Include: <label>"; bulk "Include all" checkbox in the S29 header (indeterminate when mixed)
  used on   S29, S14 history (later)
```

```
AgentComposer
  content   context chips (what the agent will see: selection, playhead, range) · textarea · Send (agent) / Stop (while running)
  keys      Enter sends, Shift+Enter new line, Esc stops a run (with focus in the panel), Ctrl+Space focuses the composer from anywhere
  used on   S27
```

## Layout tokens (from tokens.json → `--fv-*`)

| token | value | note |
| --- | --- | --- |
| window min | 1280 × 720 | below this, panels collapse to icons |
| title bar / panel header / toolbar | 36 / 32 / 36 | |
| asset panel | 380 (280–560) | resizable splitter, remembered per user |
| inspector | 320 (280–480) | |
| agent dock | 360 (300–560) | docks right of the inspector or replaces it (setting) |
| timeline | 38% (min 200) | |
| track header | 148 | |
| track heights | main 56 · video 48 · audio 40 · text/caption 28 · effect 24 | user can resize tracks later |
| asset card | 96 × 72, gap 8 | |
| z-index | timeline overlay 10 · dock 20 · popover 40 · modal 50 · toast 60 · tooltip 70 | |
