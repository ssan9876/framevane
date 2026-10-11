import { useState, type ReactNode } from 'react'
import {
  Scissors, Trash2, Undo2, Redo2, Magnet, Link2, MousePointer2, Snowflake, FlipHorizontal, Crop, Plus, Download,
  Film, Music, Type, Sticker, Sparkles, ArrowLeftRight, Palette, Captions, SlidersHorizontal, Bot, Copy, Group, Settings, FolderOpen,
} from 'lucide-react'
import {
  Button, IconButton, IconToggle, TextField, NumberField, SliderField, Switch, Checkbox, Select, KeyframeButton,
  PanelTabs, TabPanel, UnderlineTabs, Segmented, CategoryList, AssetCard, ProgressBar, Spinner, JobProgress,
  Dialog, Tooltip, TooltipProvider, ToastProvider, useToast, ContextMenu, DropdownMenu, Kbd, Badge, PanelHeader,
  EmptyState, DropZone, ColorPicker, CurveEditor, TimelineClip, TrackHeader, Ruler, Playhead, SnapGuide,
  ChatMessage, AgentNote, ToolStep, PermissionPrompt, ProposalCard, OpRow, AgentComposer, type CurvePoint, type KeyframeState,
} from '../src'

const g = (a: string, b: string) => `linear-gradient(135deg, ${a}, ${b})`
const THUMBS = [g('#3b5b7a', '#1d2b3a'), g('#7a5b3b', '#2b1d12'), g('#3b7a5b', '#122b1d'), g('#6b3b7a', '#22122b')]

function Section({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="border-b border-border px-8 py-6">
      <h2 id={`${id}-h`} className="text-xl">{title}</h2>
      {note && <p className="mt-1 max-w-3xl text-sm text-muted">{note}</p>}
      <div className="mt-4 flex flex-wrap items-start gap-6">{children}</div>
    </section>
  )
}

function Cell({ label, children, w }: { label: string; children: ReactNode; w?: number }) {
  return (
    <div className="flex flex-col gap-2" style={w ? { width: w } : undefined}>
      <span className="text-xs uppercase tracking-wide text-muted">{label}</span>
      {children}
    </div>
  )
}

function Swatches() {
  const roles = ['bg', 'surface', 'surface-2', 'surface-3', 'timeline-bg', 'border', 'border-strong', 'border-input', 'text', 'text-muted', 'text-disabled', 'accent', 'accent-soft', 'on-accent', 'danger', 'danger-solid', 'success', 'warning', 'agent', 'agent-soft', 'playhead', 'keyframe', 'snap-guide',
    'clip-video', 'clip-image', 'clip-audio', 'clip-text', 'clip-caption', 'clip-sticker', 'clip-effect', 'clip-filter', 'clip-adjustment']
  return (
    <div className="grid grid-cols-8 gap-2">
      {roles.map((r) => (
        <div key={r} className="flex flex-col gap-1">
          <div className="h-10 rounded-sm ring-1 ring-border" style={{ background: `var(--reel-color-${r})` }} />
          <span className="font-mono text-[10px] text-muted">{r}</span>
        </div>
      ))}
    </div>
  )
}

function ToastDemo() {
  const toast = useToast()
  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => toast({ tone: 'success', title: 'Export finished', description: 'promo_v3.mp4 · 1080p · 42 MB', action: { label: 'Show file', onClick: () => {} } })}>Success toast</Button>
      <Button onClick={() => toast({ tone: 'info', title: '3 clips deleted', action: { label: 'Undo', onClick: () => {} } })}>Info + Undo</Button>
      <Button onClick={() => toast({ tone: 'warning', title: 'Using proxy for preview', description: 'Export will use the full-quality originals.' })}>Warning</Button>
      <Button onClick={() => toast({ tone: 'error', title: 'Background removal failed', description: 'The local AI service stopped. Restart it in Settings → AI.' })}>Error (sticky)</Button>
    </div>
  )
}

export function Gallery() {
  const [magnet, setMagnet] = useState(true)
  const [snap, setSnap] = useState(true)
  const [link, setLink] = useState(false)
  const [lock, setLock] = useState(false)
  const [hide, setHide] = useState(false)
  const [mute, setMute] = useState(true)
  const [scale, setScale] = useState(100)
  const [temp, setTemp] = useState(18)
  const [opacity, setOpacity] = useState(100)
  const [kf, setKf] = useState<KeyframeState>('has')
  const [speed, setSpeed] = useState(1.5)
  const [sw, setSw] = useState(true)
  const [cb, setCb] = useState(true)
  const [res, setRes] = useState('1080')
  const [tab, setTab] = useState('media')
  const [itab, setItab] = useState('video')
  const [seg, setSeg] = useState('basic')
  const [cat, setCat] = useState('local')
  const [color, setColor] = useState('#4da3ff')
  const [curve, setCurve] = useState<CurvePoint[]>([{ x: 0, y: 0 }, { x: 0.3, y: 0.22 }, { x: 0.7, y: 0.8 }, { x: 1, y: 1 }])
  const [dialog, setDialog] = useState(false)
  const [ops, setOps] = useState([true, true, false, true])
  const [msg, setMsg] = useState('')

  return (
    <TooltipProvider>
      <ToastProvider>
        <div className="scroll-y h-full">
          <header className="flex items-center justify-between border-b border-border bg-surface px-8 py-5">
            <div>
              <h1 className="text-display">reel · design system</h1>
              <p className="mt-1 text-sm text-muted">Primitives from replica/design/components.md, every state. Tokens: replica/design/tokens.json (0 WCAG AA failures).</p>
            </div>
            <Badge tone="accent">placeholder accent: replica-brand sets the real one</Badge>
          </header>

          <Section id="color" title="Color roles" note="Roles, not colors. Only these exist as Tailwind utilities (the default palette is cleared), so components can't reach for raw hex.">
            <Swatches />
          </Section>

          <Section id="type" title="Type scale" note="Inter (OFL) for UI, JetBrains Mono (OFL) for timecodes and values. Default UI text is sm/12px.">
            <div className="flex flex-col gap-2">
              <span className="text-display">Display 28 · New project</span>
              <span className="text-xl">XL 20 · Export video</span>
              <span className="text-lg">LG 16 · Panel title</span>
              <span className="text-base">Base 14 · Section heading</span>
              <span className="text-md">MD 13 · Inputs and chat text</span>
              <span className="text-sm">SM 12 · Default UI text, labels, menus</span>
              <span className="text-xs text-muted">XS 11 · Ruler, badges, captions under cards</span>
              <span className="font-mono text-sm">00:01:23:14 · 1920×1080 · 29.97 fps</span>
            </div>
          </Section>

          <Section id="buttons" title="Buttons & toggles">
            <Cell label="variants">
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" icon={<Download className="size-3.5" />}>Export</Button>
                <Button>Import</Button>
                <Button variant="ghost">Cancel</Button>
                <Button variant="danger" icon={<Trash2 className="size-3.5" />}>Delete project</Button>
                <Button variant="agent" icon={<Bot className="size-3.5" />}>Ask agent</Button>
              </div>
            </Cell>
            <Cell label="sizes / states">
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm">Small</Button>
                <Button size="md">Medium</Button>
                <Button size="lg" variant="primary">Large</Button>
                <Button variant="primary" loading>Exporting</Button>
                <Button disabled>Disabled</Button>
              </div>
            </Cell>
            <Cell label="timeline toolbar (icon buttons + toggles)">
              <div className="flex items-center gap-0.5 rounded-md bg-surface p-1">
                <IconButton label="Select" shortcut="A" icon={<MousePointer2 />} />
                <IconButton label="Split" shortcut="Ctrl+B" icon={<Scissors />} />
                <IconButton label="Delete" shortcut="Del" icon={<Trash2 />} />
                <IconButton label="Undo" shortcut="Ctrl+Z" icon={<Undo2 />} />
                <IconButton label="Redo" shortcut="Ctrl+Shift+Z" icon={<Redo2 />} disabled />
                <IconButton label="Freeze frame" icon={<Snowflake />} />
                <IconButton label="Mirror" icon={<FlipHorizontal />} />
                <IconButton label="Crop" icon={<Crop />} />
                <span className="mx-1 h-4 w-px bg-border" />
                <IconToggle label="Main track magnet" shortcut="P" icon={<Magnet />} pressed={magnet} onPressedChange={setMagnet} />
                <IconToggle label="Auto snapping" shortcut="N" icon={<ArrowLeftRight />} pressed={snap} onPressedChange={setSnap} />
                <IconToggle label="Linkage" shortcut="`" icon={<Link2 />} pressed={link} onPressedChange={setLink} />
              </div>
            </Cell>
            <Cell label="tooltip + kbd">
              <Tooltip content="Split at playhead" shortcut="Ctrl+B"><Button size="sm">Hover me</Button></Tooltip>
              <div className="flex gap-1"><Kbd>Ctrl</Kbd><Kbd>Shift</Kbd><Kbd>S</Kbd></div>
            </Cell>
          </Section>

          <Section id="fields" title="Fields" note="Slider fields: drag the label to scrub (Shift ×10, Alt fine), type in the box, arrows step. The reset arrow appears when the value differs from its default. The diamond keys the value at the playhead.">
            <Cell label="slider fields (inspector)" w={420}>
              <div className="flex flex-col gap-1.5 rounded-md bg-surface p-3">
                <SliderField label="Scale" value={scale} onChange={setScale} min={0} max={400} unit="%" defaultValue={100} keyframe={{ state: kf, onToggle: () => setKf(kf === 'on' ? 'has' : 'on'), onPrev: () => {}, onNext: () => {} }} />
                <SliderField label="Opacity" value={opacity} onChange={setOpacity} min={0} max={100} unit="%" defaultValue={100} keyframe={{ state: 'none', onToggle: () => {} }} />
                <SliderField label="Temperature" value={temp} onChange={setTemp} min={-100} max={100} defaultValue={0} bipolar />
                <SliderField label="Speed" value={speed} onChange={setSpeed} min={0.1} max={10} step={0.1} precision={1} unit="×" defaultValue={1} />
                <SliderField label="Disabled" value={50} onChange={() => {}} min={0} max={100} disabled />
              </div>
            </Cell>
            <Cell label="text / number / select" w={260}>
              <TextField label="Project name" defaultValue="Spring promo" />
              <TextField label="Search media" hideLabel placeholder="Search media" leading={<FolderOpen />} />
              <TextField label="Bitrate (kbps)" defaultValue="abc" error="Enter a number between 1,000 and 200,000." />
              <div className="flex items-center gap-2"><span className="text-sm text-muted">X</span><NumberField ariaLabel="Position X" value={-120} onChange={() => {}} unit="px" width={84} /></div>
              <Select label="Resolution" value={res} onValueChange={setRes} options={[{ value: '720', label: '720p' }, { value: '1080', label: '1080p' }, { value: '1440', label: '2K' }, { value: '2160', label: '4K', hint: 'free' }]} />
            </Cell>
            <Cell label="switch / checkbox" w={260}>
              <Switch label="Hardware encoding" description="Use the GPU encoder (NVENC)." checked={sw} onCheckedChange={setSw} />
              <Switch label="Keep pitch" checked={false} onCheckedChange={() => {}} />
              <Switch label="Disabled" checked onCheckedChange={() => {}} disabled />
              <Checkbox label="Bilingual captions" checked={cb} onCheckedChange={setCb} />
              <Checkbox label="Some selected" checked="indeterminate" onCheckedChange={() => {}} />
            </Cell>
            <Cell label="keyframe button states">
              <div className="flex items-center gap-3">
                <KeyframeButton property="Scale" state="none" onToggle={() => {}} />
                <KeyframeButton property="Scale" state="has" onToggle={() => {}} onPrev={() => {}} onNext={() => {}} />
                <KeyframeButton property="Scale" state="on" onToggle={() => {}} onPrev={() => {}} onNext={() => {}} />
              </div>
            </Cell>
          </Section>

          <Section id="tabs" title="Tabs, segmented, categories">
            <Cell label="asset panel (S04–S12)" w={560}>
              <div className="h-56 rounded-md bg-surface">
                <PanelTabs
                  value={tab}
                  onValueChange={setTab}
                  tabs={[
                    { value: 'media', label: 'Media', icon: <Film /> }, { value: 'audio', label: 'Audio', icon: <Music /> },
                    { value: 'text', label: 'Text', icon: <Type /> }, { value: 'stickers', label: 'Stickers', icon: <Sticker /> },
                    { value: 'effects', label: 'Effects', icon: <Sparkles /> }, { value: 'transitions', label: 'Transitions', icon: <ArrowLeftRight /> },
                    { value: 'filters', label: 'Filters', icon: <Palette /> }, { value: 'captions', label: 'Captions', icon: <Captions /> },
                    { value: 'adjust', label: 'Adjust', icon: <SlidersHorizontal /> },
                  ]}
                >
                  <TabPanel value="media" className="flex">
                    <EmptyState icon={<Film />} title="No media yet" body="Import clips, photos or music to start editing." action={<Button variant="primary" size="sm" icon={<Plus className="size-3.5" />}>Import</Button>} className="flex-1" />
                  </TabPanel>
                  <TabPanel value="audio" className="flex">
                    <CategoryList label="Audio categories" value={cat} onValueChange={setCat} items={[{ value: 'local', label: 'Your music', count: 4 }, { value: 'sfx', label: 'Sound effects', count: 0 }, { value: 'extracted', label: 'Extracted', count: 2 }, { value: 'free', label: 'Free library' }]} />
                    <p className="p-3 text-sm text-muted">Category: {cat}</p>
                  </TabPanel>
                </PanelTabs>
              </div>
            </Cell>
            <Cell label="inspector tabs + segmented (S14–S18)" w={340}>
              <div className="rounded-md bg-surface pb-3">
                <UnderlineTabs value={itab} onValueChange={setItab} tabs={[{ value: 'video', label: 'Video' }, { value: 'audio', label: 'Audio' }, { value: 'speed', label: 'Speed' }, { value: 'anim', label: 'Animation' }, { value: 'adjust', label: 'Adjust' }]} />
                <div className="px-3 pt-3"><Segmented label="Video tools" value={seg} onValueChange={setSeg} options={[{ value: 'basic', label: 'Basic' }, { value: 'bg', label: 'Remove BG' }, { value: 'mask', label: 'Mask' }, { value: 'retouch', label: 'Retouch' }]} /></div>
              </div>
            </Cell>
          </Section>

          <Section id="cards" title="Asset cards" note="Card body selects/previews; the + adds at the playhead (two controls, one job each). States: ready, hover, selected, generating, added, missing.">
            <AssetCard title="beach_intro.mp4" kind="video" thumb={THUMBS[0]} duration="00:12" onAdd={() => {}} onSelect={() => {}} usedInProject />
            <AssetCard title="product_closeup.mov" kind="video" thumb={THUMBS[1]} duration="00:07" selected onAdd={() => {}} />
            <AssetCard title="Matte (AI)" kind="video" thumb={THUMBS[2]} state="generating" progress={0.42} badge={<Badge tone="agent">AI</Badge>} />
            <AssetCard title="logo_sting.wav" kind="audio" duration="00:03" state="added" onAdd={() => {}} />
            <AssetCard title="old_take.mp4" kind="video" duration="00:31" state="missing" />
            <AssetCard title="Glitch" kind="effect" thumb={THUMBS[3]} onAdd={() => {}} />
          </Section>

          <Section id="timeline" title="Timeline" note="Clip colors by kind; label text is ≥5.3:1 on every fill. Keyframes, waveforms, disabled (V), offline media, AI processing, and agent-proposed (dashed) states.">
            <div className="relative w-full overflow-hidden rounded-md border border-border bg-timeline-bg">
              <div className="flex"><div className="w-[var(--reel-track-header-w)] shrink-0 border-r border-border bg-surface" /><Ruler width={900} pxPerSec={60} markers={[{ at: 3.2, color: 'red', label: 'Hook' }, { at: 9, color: 'green' }]} /></div>
              {[
                { name: 'Text', kind: 'text' as const, h: 28, clips: [<TimelineClip key="t" kind="text" label="SPRING SALE" width={180} height={28} keyframes={[{ at: 0.2 }, { at: 0.8, on: true }]} />, <TimelineClip key="c" kind="caption" label="Captions (42)" width={320} height={28} selected />] },
                { name: 'Overlay', kind: 'video' as const, h: 48, clips: [<TimelineClip key="o" kind="sticker" label="badge.png" width={120} height={48} />, <TimelineClip key="e" kind="effect" label="Film grain" width={200} height={48} processing={0.6} />] },
                { name: 'Video 1', kind: 'video' as const, h: 56, main: true, clips: [<TimelineClip key="v1" kind="video" label="beach_intro.mp4" width={260} height={56} thumbs={THUMBS} selected keyframes={[{ at: 0.1 }, { at: 0.6 }]} />, <TimelineClip key="v2" kind="video" label="product_closeup.mov" width={180} height={56} thumbs={THUMBS.slice(1)} speedLabel="1.5×" />, <TimelineClip key="v3" kind="video" label="old_take.mp4" width={140} height={56} missing />, <TimelineClip key="v4" kind="image" label="still.jpg" width={110} height={56} disabled />, <TimelineClip key="v5" kind="video" label="punch-in (proposed)" width={120} height={56} thumbs={THUMBS.slice(2)} proposed />] },
                { name: 'Audio 1', kind: 'audio' as const, h: 40, clips: [<TimelineClip key="a" kind="audio" label="lofi_beat.mp3" width={620} height={40} waveformSeed={3} />] },
              ].map((t) => (
                <div key={t.name} role="row" className="flex">
                  <TrackHeader name={t.name} kind={t.kind} height={t.h} main={t.main} locked={t.name === 'Audio 1' ? lock : false} onLocked={setLock} hidden={t.kind !== 'audio' ? hide : undefined} onHidden={t.kind !== 'audio' ? setHide : undefined} muted={t.kind === 'audio' || t.kind === 'video' ? mute : undefined} onMuted={t.kind === 'audio' || t.kind === 'video' ? setMute : undefined} />
                  <div className="flex items-center gap-0.5 border-b border-border px-1" style={{ height: t.h }}>{t.clips}</div>
                </div>
              ))}
              <Playhead x={148 + 210} height={24 + 28 + 48 + 56 + 40 + 4} />
              <SnapGuide x={148 + 446} height={200} />
            </div>
          </Section>

          <Section id="color-tools" title="Color tools">
            <Cell label="color picker (popover)"><ColorPicker label="Text color" value={color} onChange={setColor} /></Cell>
            <Cell label="curve editor (drag · dbl-click add · Del remove)"><CurveEditor label="Luma curve" points={curve} onChange={setCurve} /></Cell>
            <Cell label="curve editor channel"><CurveEditor label="Red curve" points={[{ x: 0, y: 0.05 }, { x: 0.5, y: 0.55 }, { x: 1, y: 0.95 }]} onChange={() => {}} color="var(--reel-color-marker-red)" size={140} /></Cell>
          </Section>

          <Section id="overlays" title="Menus, dialogs, toasts, progress">
            <Cell label="context menu (right-click)">
              <ContextMenu items={[
                { label: 'Split', shortcut: 'Ctrl+B', icon: <Scissors /> }, { label: 'Copy', shortcut: 'Ctrl+C', icon: <Copy /> },
                { label: 'Group', shortcut: 'Ctrl+G', icon: <Group /> }, { label: 'Detach audio', shortcut: 'Ctrl+Shift+S', icon: <Music /> },
                { label: 'Ask agent about this clip', icon: <Bot />, separatorBefore: true }, { label: 'Delete', shortcut: 'Del', icon: <Trash2 />, danger: true, separatorBefore: true },
              ]}>
                <div className="grid h-16 w-48 place-items-center rounded-md border border-dashed border-border-input text-sm text-muted">Right-click here</div>
              </ContextMenu>
            </Cell>
            <Cell label="dropdown menu">
              <DropdownMenu trigger={<Button icon={<Settings className="size-3.5" />}>Project</Button>} items={[{ label: 'Project settings…' }, { label: 'Relink media…' }, { label: 'Export captions (SRT)' }, { label: 'Close project', separatorBefore: true }]} />
            </Cell>
            <Cell label="dialog">
              <Button onClick={() => setDialog(true)}>Open export dialog</Button>
              <Dialog open={dialog} onOpenChange={setDialog} title="Export video" description="Renders with the same engine as the preview." footer={<><Button variant="ghost" onClick={() => setDialog(false)}>Cancel</Button><Button variant="primary">Export</Button></>}>
                <div className="flex flex-col gap-3">
                  <TextField label="File name" defaultValue="spring_promo" />
                  <Select label="Resolution" value={res} onValueChange={setRes} options={[{ value: '1080', label: '1080p' }, { value: '2160', label: '4K' }]} />
                  <JobProgress title="Rendering" value={0.37} detail="00:41 left · NVENC H.264" onCancel={() => {}} />
                </div>
              </Dialog>
            </Cell>
            <Cell label="toasts"><ToastDemo /></Cell>
            <Cell label="progress" w={240}>
              <ProgressBar value={0.62} label="Export" />
              <ProgressBar label="Transcribing" tone="agent" />
              <JobProgress title="Removing background · beach_intro" value={0.18} detail="Local · RTX 4060" onCancel={() => {}} />
              <Spinner />
            </Cell>
          </Section>

          <Section id="empty" title="Empty states & drop zone">
            <Cell label="drop zone idle" w={300}><DropZone onFiles={() => {}} onBrowse={() => {}} /></Cell>
            <Cell label="drop zone drag-over" w={300}><DropZone onFiles={() => {}} onBrowse={() => {}} forceDragOver /></Cell>
            <Cell label="panel header + empty" w={300}>
              <div className="rounded-md bg-surface">
                <PanelHeader title="Agents" actions={<IconButton size="sm" label="New agent" icon={<Plus />} />} />
                <EmptyState icon={<Bot />} title="No custom agents yet" body="Built-in agents are always available. Make your own to save a prompt and its tools." />
              </div>
            </Cell>
          </Section>

          <Section id="agent" title="Agent panel (S27) & review (S29)" note="Agent color marks everything an agent did or proposes. Tool steps collapse; errors start open. Paid tools always ask and never offer 'Always allow'.">
            <Cell label="transcript" w={420}>
              <div className="flex flex-col gap-2.5 rounded-md bg-surface p-3">
                <ChatMessage role="user">Cut the silences, add captions, and punch in when I say “free shipping”.</ChatMessage>
                <AgentNote>Reading the transcript and finding pauses longer than 0.6 s…</AgentNote>
                <ToolStep provider="local" tool="transcribe" summary="beach_intro.mp4 · 214 words" status="done" durationMs={8400} detail={'{"assetId":"a1","model":"large-v3-turbo"}'} />
                <ToolStep provider="editor" tool="cut_ranges" summary="11 ranges · 9.4 s removed" status="done" durationMs={30} />
                <ToolStep provider="local" tool="matte_video" summary="product_closeup.mov" status="error" detail="CUDA out of memory (6.1 GB requested). Retry with lower resolution?" />
                <ToolStep provider="higgsfield" tool="generate_video" summary="b-roll: sunny beach, 5 s" status="awaiting" />
                <PermissionPrompt provider="higgsfield" tool="generate_video" reason="Generates a 5-second b-roll clip on your Higgsfield account." costsMoney onAllowOnce={() => {}} onAlwaysAllow={() => {}} onDeny={() => {}} />
                <ChatMessage role="agent" streaming meta="Opus 5.5 · 12.4k tokens · $0.08">I removed 11 pauses and captioned the whole clip. The punch-in is at 0:07.2.</ChatMessage>
                <ProposalCard opCount={14} summary="11 cuts · 1 caption track (42 lines) · 2 zoom keyframes" cost="$0.08" onReview={() => {}} onDiscard={() => {}} />
              </div>
            </Cell>
            <Cell label="composer" w={380}>
              <div className="rounded-md bg-surface"><AgentComposer value={msg} onChange={setMsg} onSend={() => setMsg('')} onStop={() => {}} chips={['2 clips selected', 'Playhead 00:07.2']} /></div>
              <div className="rounded-md bg-surface"><AgentComposer value="Make it 9:16" onChange={() => {}} onSend={() => {}} onStop={() => {}} running /></div>
            </Cell>
            <Cell label="edit review list" w={420}>
              <ul className="rounded-md bg-surface" aria-label="Proposed edits">
                {[
                  { label: 'Cut silence', target: 'beach_intro.mp4', time: '00:02.1–00:02.9' },
                  { label: 'Add captions', target: 'New caption track · 42 lines', time: '00:00.0' },
                  { label: 'Zoom to 120%', target: 'product_closeup.mov · 2 keyframes', time: '00:07.2' },
                  { label: 'Cut silence', target: 'beach_intro.mp4', time: '00:11.0–00:11.7' },
                ].map((o, i) => (
                  <OpRow key={i} {...o} thumb={THUMBS[i % 4]} included={ops[i]!} onIncludedChange={(v) => setOps(ops.map((x, j) => (j === i ? v : x)))} />
                ))}
                <OpRow label="Trim clip" target="still.jpg (deleted since)" time="00:14.0" included={false} onIncludedChange={() => {}} status="conflicted" />
                <OpRow label="Cut silence" target="beach_intro.mp4" time="00:00.4" included onIncludedChange={() => {}} status="applied" />
              </ul>
            </Cell>
          </Section>
        </div>
      </ToastProvider>
    </TooltipProvider>
  )
}
