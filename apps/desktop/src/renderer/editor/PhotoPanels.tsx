import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import {
  ArrowDown, ArrowRight, ArrowUp, Circle, Crop, Eye, EyeOff, FlipHorizontal2, FlipVertical2, ImagePlus, Layers, Lock, LockOpen, Minus, Palette, Plus,
  RotateCcw, RotateCw, Shapes, Sparkles, Square, Star, Trash2, Triangle, Type,
} from 'lucide-react'
import { Button, ColorPicker, Dialog, IconButton, NumberField, PanelHeader, PanelTabs, Segmented, Select, SliderField, Switch, TabPanel, useToast } from '@framevane/ui'
import { SHAPES, type ShapeClip, type ShapeKind, type Track } from '@framevane/doc'
import { useApp } from '../app/store'
import { runExport } from '../engine/export'
import { PresetPreview } from './AssetTabsM3'
import { AnimSlider, BackgroundTools } from './Inspector'
import { EffectsTab, FiltersTab } from './LookTabs'
import { TEXT_PRESETS } from './textPresets'
import {
  addEmojiLayer, addImageLayers, addShapeLayer, addTextLayer, cropPhoto, deleteLayer, flipPhoto, layerClip, layerName, moveLayer, resizePhoto, rotatePhoto, setLayerFlags,
} from './actions-m7'

/** S25 · Photo editor panels: layers, adding layers, the canvas tools, the shape inspector, crop overlay and export. */

const errText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))

export function PhotoSidebar() {
  const [tab, setTab] = useState('layers')
  return (
    <PanelTabs value={tab} onValueChange={setTab} className="h-full"
      tabs={[
        { value: 'layers', label: 'Layers', icon: <Layers /> },
        { value: 'add', label: 'Add', icon: <Plus /> },
        { value: 'canvas', label: 'Canvas', icon: <Crop /> },
        { value: 'filters', label: 'Filters', icon: <Palette /> },
        { value: 'effects', label: 'Effects', icon: <Sparkles /> },
      ]}>
      <TabPanel value="layers" className="scroll-y flex min-h-0 flex-col"><LayersPanel /></TabPanel>
      <TabPanel value="add" className="scroll-y flex min-h-0 flex-col"><AddPanel /></TabPanel>
      <TabPanel value="canvas" className="scroll-y flex min-h-0 flex-col"><CanvasPanel /></TabPanel>
      <TabPanel value="filters" className="flex min-h-0 flex-col"><FiltersTab /></TabPanel>
      <TabPanel value="effects" className="flex min-h-0 flex-col"><EffectsTab /></TabPanel>
    </PanelTabs>
  )
}

/* ───────────── layers ───────────── */

const kindIcon = (t: Track) => {
  const c = layerClip(t)
  if (c?.kind === 'shape') return <Shapes className="size-3.5" aria-hidden />
  if (c?.kind === 'text') return <Type className="size-3.5" aria-hidden />
  return <ImagePlus className="size-3.5" aria-hidden />
}

function LayersPanel() {
  const doc = useApp((s) => s.doc)!
  const selection = useApp((s) => s.selection)
  const layers = doc.tracks.map((t, i) => ({ t, i })).filter(({ t }) => t.clips.length).reverse() // top first
  if (!layers.length) return <p className="p-3 text-sm text-muted">No layers yet. Add an image, text or a shape.</p>
  return (
    <ol aria-label="Layers" className="flex flex-col gap-1 p-2">
      {layers.map(({ t, i }) => {
        const c = layerClip(t)!
        const name = layerName(doc, t)
        const selected = selection.includes(c.id)
        return (
          <li key={t.id} className={`flex items-center gap-1 rounded-md border px-1.5 py-1 ${selected ? 'border-accent bg-accent-soft' : 'border-transparent hover:bg-surface-3'} ${t.hidden ? 'opacity-60' : ''}`}>
            <button type="button" className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left text-sm" aria-pressed={selected} onClick={() => useApp.getState().select([c.id])}>
              {kindIcon(t)}<span className="truncate" title={name}>{name}</span>
            </button>
            <IconButton size="sm" label={t.hidden ? `Show ${name}` : `Hide ${name}`} icon={t.hidden ? <EyeOff /> : <Eye />} onClick={() => void setLayerFlags(t.id, { hidden: !t.hidden })} />
            <IconButton size="sm" label={t.locked ? `Unlock ${name}` : `Lock ${name}`} icon={t.locked ? <Lock /> : <LockOpen />} onClick={() => void setLayerFlags(t.id, { locked: !t.locked })} />
            <IconButton size="sm" label={`Move ${name} up`} icon={<ArrowUp />} disabled={i === doc.tracks.length - 1} onClick={() => void moveLayer(t.id, 1)} />
            <IconButton size="sm" label={`Move ${name} down`} icon={<ArrowDown />} disabled={i === 0} onClick={() => void moveLayer(t.id, -1)} />
            <IconButton size="sm" label={`Delete ${name}`} icon={<Trash2 />} disabled={t.locked} onClick={() => void deleteLayer(t.id)} />
          </li>
        )
      })}
    </ol>
  )
}

/* ───────────── add ───────────── */

const SHAPE_ICONS: Record<ShapeKind, { icon: React.ReactNode; name: string }> = {
  rect: { icon: <Square />, name: 'Rectangle' }, ellipse: { icon: <Circle />, name: 'Ellipse' }, triangle: { icon: <Triangle />, name: 'Triangle' },
  star: { icon: <Star />, name: 'Star' }, line: { icon: <Minus />, name: 'Line' }, arrow: { icon: <ArrowRight />, name: 'Arrow' },
}

/** Emoji stickers, drawn with Windows' colour emoji font. */
const EMOJI: [string, string][] = [
  ['😀', 'grinning face'], ['😂', 'tears of joy'], ['😍', 'heart eyes'], ['😎', 'sunglasses'], ['🤩', 'star-struck'], ['🥳', 'party face'], ['😮', 'surprised'], ['🤔', 'thinking'],
  ['👍', 'thumbs up'], ['👏', 'clapping'], ['🙌', 'raised hands'], ['👀', 'eyes'], ['💪', 'flexed arm'], ['🙏', 'folded hands'], ['👉', 'pointing right'], ['✌️', 'victory hand'],
  ['❤️', 'red heart'], ['🔥', 'fire'], ['✨', 'sparkles'], ['⭐', 'star'], ['💯', 'hundred points'], ['✅', 'check mark'], ['❌', 'cross mark'], ['⚡', 'lightning'],
  ['🎉', 'party popper'], ['🎁', 'gift'], ['💰', 'money bag'], ['🛒', 'shopping cart'], ['📦', 'package'], ['🏷️', 'label'], ['📣', 'megaphone'], ['🆕', 'new'],
]

function AddPanel() {
  const toast = useToast()
  return (
    <div className="flex flex-col gap-4 p-3">
      <Button variant="primary" icon={<ImagePlus className="size-3.5" />} onClick={async () => {
        try { await addImageLayers() } catch (e) { toast({ tone: 'error', title: "The image didn't come in", description: errText(e) }) }
      }}>Add image…</Button>
      <section className="flex flex-col gap-2">
        <h3 className="text-sm text-muted">Text</h3>
        <Button icon={<Type className="size-3.5" />} onClick={() => void addTextLayer()}>Add text</Button>
        <ul aria-label="Text styles" className="grid grid-cols-2 gap-2">
          {TEXT_PRESETS.slice(0, 8).map((p) => (
            <li key={p.id}>
              <button type="button" aria-label={`Add ${p.name} text`} onClick={() => void addTextLayer(p)} className="flex w-full flex-col items-center gap-1 overflow-hidden rounded-md border border-border bg-bg p-1.5 hover:border-accent">
                <PresetPreview preset={p} /><span className="text-xs text-muted">{p.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-sm text-muted">Shapes</h3>
        <ul aria-label="Shapes" className="grid grid-cols-3 gap-2">
          {SHAPES.map((s) => (
            <li key={s}>
              <button type="button" aria-label={`Add ${SHAPE_ICONS[s].name}`} onClick={() => void addShapeLayer(s)} className="flex h-14 w-full flex-col items-center justify-center gap-1 rounded-md border border-border bg-bg text-xs text-muted hover:border-accent [&_svg]:size-5 [&_svg]:text-accent">
                {SHAPE_ICONS[s].icon}{SHAPE_ICONS[s].name}
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-sm text-muted">Stickers</h3>
        <ul aria-label="Stickers" className="grid grid-cols-6 gap-1">
          {EMOJI.map(([e, name]) => (
            <li key={e}>
              <button type="button" aria-label={`Add ${name} sticker`} title={name} onClick={() => void addEmojiLayer(e)} className="grid size-9 place-items-center rounded-md text-xl hover:bg-surface-3">{e}</button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

/* ───────────── canvas: crop, resize, rotate, flip, background ───────────── */

const CROP_RATIOS: { value: string; label: string; r: number | null | 'original' }[] = [
  { value: 'free', label: 'Free', r: null }, { value: 'original', label: 'Original', r: 'original' }, { value: '1:1', label: '1:1', r: 1 }, { value: '4:5', label: '4:5', r: 4 / 5 },
  { value: '9:16', label: '9:16', r: 9 / 16 }, { value: '16:9', label: '16:9', r: 16 / 9 }, { value: '3:2', label: '3:2', r: 3 / 2 },
]

/** The largest rectangle of a ratio that fits in (and is centred on) another. */
function fitRatio(box: { x: number; y: number; w: number; h: number }, r: number) {
  const w = Math.min(box.w, box.h * r)
  const h = w / r
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h }
}

function CanvasPanel() {
  const doc = useApp((s) => s.doc)!
  const crop = useApp((s) => s.photoCrop)
  const toast = useToast()
  const W = doc.canvas.width
  const H = doc.canvas.height
  const [ratioKey, setRatioKey] = useState('free')
  const [w, setW] = useState(W)
  const [h, setH] = useState(H)
  const [lock, setLock] = useState(true)
  const [scale, setScale] = useState(true)
  // the size fields follow the canvas after a crop, turn or resize (and undo)
  useEffect(() => { setW(W); setH(H) }, [W, H])
  const startCrop = () => { setRatioKey('free'); useApp.setState({ photoCrop: { x: 0, y: 0, w: W, h: H, ratio: null } }) }
  const pickRatio = (key: string) => {
    setRatioKey(key)
    const def = CROP_RATIOS.find((r) => r.value === key)!
    const r = def.r === 'original' ? W / H : def.r
    const cur = useApp.getState().photoCrop ?? { x: 0, y: 0, w: W, h: H, ratio: null }
    useApp.setState({ photoCrop: r ? { ...fitRatio({ x: 0, y: 0, w: W, h: H }, r), ratio: r } : { ...cur, ratio: null } })
  }
  return (
    <div className="flex flex-col gap-5 p-3">
      <section className="flex flex-col gap-2">
        <h3 className="text-sm text-muted">Crop</h3>
        {!crop ? <Button icon={<Crop className="size-3.5" />} onClick={startCrop}>Crop…</Button> : (
          <>
            <Select label="Shape" value={ratioKey} onValueChange={pickRatio} options={CROP_RATIOS} width={140} />
            <p className="text-sm">{Math.round(crop.w)} × {Math.round(crop.h)} px · drag the box or its corners on the picture</p>
            <div className="flex gap-2">
              <Button variant="primary" onClick={async () => {
                await cropPhoto({ x: crop.x, y: crop.y, width: crop.w, height: crop.h })
                useApp.setState({ photoCrop: null })
              }}>Apply crop</Button>
              <Button variant="ghost" onClick={() => useApp.setState({ photoCrop: null })}>Cancel</Button>
            </div>
          </>
        )}
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-sm text-muted">Size</h3>
        <div className="flex items-center gap-2 text-sm">
          <label className="flex items-center gap-1.5">W <NumberField ariaLabel="Width" value={w} onChange={(v) => { setW(v); if (lock) setH(Math.round((v * H) / W)) }} min={16} max={8192} unit="px" width={104} /></label>
          <label className="flex items-center gap-1.5">H <NumberField ariaLabel="Height" value={h} onChange={(v) => { setH(v); if (lock) setW(Math.round((v * W) / H)) }} min={16} max={8192} unit="px" width={104} /></label>
        </div>
        <Switch label="Keep the shape" checked={lock} onCheckedChange={(v) => { setLock(v); if (v) setH(Math.round((w * H) / W)) }} />
        <Switch label="Scale the picture" description="Off: change the canvas around the picture" checked={scale} onCheckedChange={setScale} />
        <Button disabled={w === W && h === H} onClick={async () => {
          try { await resizePhoto(w, h, scale) } catch (e) { toast({ tone: 'error', title: "The size didn't change", description: errText(e) }) }
        }}>Apply size</Button>
        <p className="text-xs text-muted">Now {W} × {H} px.</p>
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-sm text-muted">Turn and flip</h3>
        <div className="flex flex-wrap gap-1">
          <Button size="sm" icon={<RotateCcw className="size-3.5" />} onClick={() => void rotatePhoto(false)}>Left</Button>
          <Button size="sm" icon={<RotateCw className="size-3.5" />} onClick={() => void rotatePhoto(true)}>Right</Button>
          <Button size="sm" icon={<FlipHorizontal2 className="size-3.5" />} onClick={() => void flipPhoto('horizontal')}>Mirror</Button>
          <Button size="sm" icon={<FlipVertical2 className="size-3.5" />} onClick={() => void flipPhoto('vertical')}>Upside down</Button>
        </div>
      </section>
      <div className="-mx-3"><BackgroundTools doc={doc} /></div>
    </div>
  )
}

/** S25 crop box over the picture (canvas px ↔ css px by k). */
export function CropOverlay({ cssW, cssH }: { cssW: number; cssH: number }) {
  const doc = useApp((s) => s.doc)!
  const crop = useApp((s) => s.photoCrop)
  const drag = useRef<{ mode: 'move' | 'nw' | 'ne' | 'sw' | 'se'; px: number; py: number; start: NonNullable<typeof crop> } | null>(null)
  if (!crop) return null
  const W = doc.canvas.width
  const H = doc.canvas.height
  const k = cssW / W
  const down = (mode: NonNullable<typeof drag.current>['mode']) => (e: RPointerEvent) => {
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { mode, px: e.clientX, py: e.clientY, start: crop }
  }
  const move = (e: RPointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = (e.clientX - d.px) / k
    const dy = (e.clientY - d.py) / k
    const s = d.start
    let { x, y, w, h } = s
    if (d.mode === 'move') { x = Math.max(0, Math.min(W - w, s.x + dx)); y = Math.max(0, Math.min(H - h, s.y + dy)) } else {
      const left = d.mode === 'nw' || d.mode === 'sw'
      const top = d.mode === 'nw' || d.mode === 'ne'
      w = Math.max(32, s.w + (left ? -dx : dx))
      h = Math.max(32, s.h + (top ? -dy : dy))
      if (s.ratio) h = w / s.ratio
      // keep the opposite corner still, and inside the picture
      const right = s.x + s.w
      const bottom = s.y + s.h
      w = Math.min(w, left ? right : W - s.x)
      h = Math.min(h, top ? bottom : H - s.y)
      if (s.ratio) { w = Math.min(w, h * s.ratio); h = w / s.ratio }
      x = left ? right - w : s.x
      y = top ? bottom - h : s.y
    }
    useApp.setState({ photoCrop: { ...s, x, y, w, h } })
  }
  const up = () => { drag.current = null }
  const corner = (mode: 'nw' | 'ne' | 'sw' | 'se', style: React.CSSProperties) => (
    <span role="presentation" onPointerDown={down(mode)} onPointerMove={move} onPointerUp={up} className="absolute size-3 rounded-xs border-2 border-accent bg-bg" style={{ ...style, cursor: mode === 'nw' || mode === 'se' ? 'nwse-resize' : 'nesw-resize' }} />
  )
  return (
    <div className="absolute inset-0" style={{ width: cssW, height: cssH }}>
      {/* dim what will be cut away */}
      <div className="absolute inset-x-0 top-0 bg-scrim/60" style={{ height: crop.y * k }} />
      <div className="absolute inset-x-0 bottom-0 bg-scrim/60" style={{ height: (H - crop.y - crop.h) * k }} />
      <div className="absolute left-0 bg-scrim/60" style={{ top: crop.y * k, height: crop.h * k, width: crop.x * k }} />
      <div className="absolute right-0 bg-scrim/60" style={{ top: crop.y * k, height: crop.h * k, width: (W - crop.x - crop.w) * k }} />
      <div role="group" aria-label={`Crop box ${Math.round(crop.w)} by ${Math.round(crop.h)}`} className="absolute cursor-move border-2 border-accent"
        style={{ left: crop.x * k, top: crop.y * k, width: crop.w * k, height: crop.h * k }}
        onPointerDown={down('move')} onPointerMove={move} onPointerUp={up}>
        {corner('nw', { left: -7, top: -7 })}{corner('ne', { right: -7, top: -7 })}{corner('sw', { left: -7, bottom: -7 })}{corner('se', { right: -7, bottom: -7 })}
      </div>
    </div>
  )
}

/* ───────────── shape inspector ───────────── */

export function ShapeInspector({ clip, track }: { clip: ShapeClip; track: Track }) {
  const doc = useApp((s) => s.doc)!
  const set = (shape: Partial<Pick<ShapeClip, 'shape' | 'width' | 'height' | 'fill' | 'stroke' | 'strokeWidth' | 'radius'>>) => void useApp.getState().apply([{ type: 'set_shape', clipId: clip.id, shape }])
  const [fill, setFill] = useState(clip.fill ?? '#ff7a3d')
  return (
    <div className={track.locked ? 'pointer-events-none opacity-60' : ''}>
      <PanelHeader title={<span className="flex items-center gap-1.5"><Shapes className="size-3.5 text-muted" />Shape</span>} />
      <div className="flex flex-col gap-2 p-3">
        <Select label="Shape" value={clip.shape} width={150} onValueChange={(v) => set({ shape: v as ShapeKind })} options={SHAPES.map((s) => ({ value: s, label: SHAPE_ICONS[s].name }))} />
        <div className="flex items-center gap-2 text-sm">
          <label className="flex items-center gap-1.5">W <NumberField ariaLabel="Shape width" value={Math.round(clip.width)} onChange={(v) => set({ width: v })} min={1} max={8192} unit="px" width={100} /></label>
          <label className="flex items-center gap-1.5">H <NumberField ariaLabel="Shape height" value={Math.round(clip.height)} onChange={(v) => set({ height: v })} min={1} max={8192} unit="px" width={100} /></label>
        </div>
        <Switch label="Fill" checked={clip.fill !== null} onCheckedChange={(on) => set({ fill: on ? fill : null })} />
        {clip.fill !== null && <ColorPicker label="Fill colour" value={clip.fill.slice(0, 7)} onChange={(c) => { setFill(c); set({ fill: c }) }} />}
        <SliderField label="Outline" value={clip.strokeWidth} onChange={(v) => set({ strokeWidth: v })} min={0} max={60} unit="px" defaultValue={0} />
        {clip.strokeWidth > 0 && <ColorPicker label="Outline colour" value={clip.stroke.slice(0, 7)} onChange={(c) => set({ stroke: c })} />}
        {clip.shape === 'rect' && <SliderField label="Corners" value={Math.round(clip.radius * 200)} onChange={(v) => set({ radius: v / 200 })} min={0} max={100} unit="%" defaultValue={0} />}
        <h3 className="pt-2 text-sm text-muted">Position</h3>
        <AnimSlider clip={clip} prop="x" label="Position X" min={-doc.canvas.width} max={doc.canvas.width} unit="px" defaultValue={0} bipolar />
        <AnimSlider clip={clip} prop="y" label="Position Y" min={-doc.canvas.height} max={doc.canvas.height} unit="px" defaultValue={0} bipolar />
        <AnimSlider clip={clip} prop="scale" label="Scale" min={5} max={400} unit="%" toUi={(v) => Math.round(v * 100)} fromUi={(v) => v / 100} defaultValue={100} />
        <AnimSlider clip={clip} prop="rotation" label="Rotation" min={-180} max={180} unit="°" defaultValue={0} bipolar />
        <AnimSlider clip={clip} prop="opacity" label="Opacity" min={0} max={100} unit="%" toUi={(v) => Math.round(v * 100)} fromUi={(v) => v / 100} defaultValue={100} />
      </div>
    </div>
  )
}

/* ───────────── export ───────────── */

/** S25 export: PNG and WebP keep transparency; JPG is flattened on white. */
export function PhotoExportDialog() {
  const doc = useApp((s) => s.doc)!
  const [name, setName] = useState(doc.name.replace(/[\\/:*?"<>|]+/g, '').trim() || 'photo')
  const [format, setFormat] = useState<'png' | 'jpg' | 'webp'>('png')
  const [size, setSize] = useState('100')
  const [quality, setQuality] = useState(92)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const toast = useToast()
  const close = () => { if (!busy) useApp.getState().openDialog(null) }
  const width = Math.max(1, Math.round((doc.canvas.width * Number(size)) / 100))
  const height = Math.max(1, Math.round((doc.canvas.height * Number(size)) / 100))
  const transparent = doc.canvas.background.kind === 'transparent'
  async function start() {
    const outputPath = await window.framevane.app.pickSavePath({ defaultName: name, ext: format })
    if (!outputPath) return
    setBusy(true)
    setError(null)
    try {
      const r = await runExport(doc, { outputPath, format, height: 0, fps: 30, width, imageQuality: quality / 100, atUs: 0 }, () => {}, new AbortController().signal, (id) => !!useApp.getState().mattes[id])
      useApp.getState().openDialog(null)
      toast({ tone: 'success', title: 'Photo saved', description: `${r.path.split(/[\\/]/).pop()} · ${(r.bytes / 1e6).toFixed(2)} MB`, action: { label: 'Show file', onClick: () => void window.framevane.app.showItemInFolder(r.path) } })
    } catch (e) { setError(errText(e)) } finally { setBusy(false) }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && close()} title="Export photo" description="Saved at full quality on your computer. Never a watermark." busy={busy} width={440}
      footer={<><Button variant="ghost" onClick={close} disabled={busy}>Close</Button><Button variant="primary" loading={busy} onClick={() => void start()}>Export…</Button></>}>
      <div className="flex flex-col gap-3">
        <TextFieldName value={name} onChange={setName} />
        <Segmented label="Format" value={format} onValueChange={(v) => setFormat(v as typeof format)} options={[{ value: 'png', label: 'PNG' }, { value: 'jpg', label: 'JPG' }, { value: 'webp', label: 'WebP' }]} />
        <Select label="Size" value={size} onValueChange={setSize} width={160} options={[{ value: '100', label: 'Full size' }, { value: '50', label: 'Half' }, { value: '25', label: 'Quarter' }, { value: '200', label: 'Double' }]} />
        {format !== 'png' && <SliderField label="Quality" value={quality} onChange={setQuality} min={30} max={100} unit="%" defaultValue={92} />}
        <p className="text-sm text-muted">{width} × {height} px · {transparent ? (format === 'jpg' ? 'see-through areas become white' : 'see-through areas stay see-through') : 'with its background'}</p>
        {error && <p role="alert" className="text-sm text-danger">Export failed: {error}</p>}
      </div>
    </Dialog>
  )
}

function TextFieldName({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      File name
      <input value={value} onChange={(e) => onChange(e.target.value)} className="h-8 rounded-md border border-border-input bg-bg px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-focus" />
    </label>
  )
}
