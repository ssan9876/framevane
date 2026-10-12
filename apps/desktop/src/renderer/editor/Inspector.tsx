import { Fragment, useEffect, useRef, useState } from 'react'
import { Trash2, Captions, Construction } from 'lucide-react'
import { Button, ColorPicker, EmptyState, PanelHeader, Segmented, SliderField, Switch, UnderlineTabs } from '@reel/ui'
import { DEFAULT_CAPTION_STYLE, findClip, formatUs, projectDurationUs, type CaptionClip, type MediaClip, type OpInput, type Project, type Track } from '@reel/doc'
import { useApp } from '../app/store'
import { deleteSelection } from './actions'

/** S14–S19 · Inspector: properties of the selection, or project details (with S02 Modify) when nothing is selected. */
export function Inspector() {
  const doc = useApp((s) => s.doc)!
  const selection = useApp((s) => s.selection)
  const found = selection.length === 1 ? findClip(doc, selection[0]!) : null

  if (selection.length > 1) {
    return (
      <>
        <PanelHeader title={`${selection.length} clips selected`} />
        <div className="p-3"><Button variant="danger" size="sm" icon={<Trash2 className="size-3.5" />} onClick={deleteSelection}>Delete clips</Button></div>
      </>
    )
  }
  if (!found) return <ProjectDetails doc={doc} />
  const { clip, track } = found
  if (clip.kind === 'caption') return <CaptionInspector key={clip.id} clip={clip} track={track} />
  if (clip.kind === 'text') return <><PanelHeader title="Text" /><EmptyState icon={<Construction />} title="Text clips arrive in M3" /></>
  return <MediaInspector key={clip.id} clip={clip as MediaClip} doc={doc} locked={track.locked} />
}

function ProjectDetails({ doc }: { doc: Project }) {
  const rows: [string, string][] = [
    ['Name', doc.name],
    ['Canvas', `${doc.canvas.width} × ${doc.canvas.height}`],
    ['Frame rate', `${+(doc.canvas.fps.num / doc.canvas.fps.den).toFixed(3)} fps`],
    ['Duration', formatUs(projectDurationUs(doc))],
    ['Media', `${Object.keys(doc.assets).length} files`],
    ['Tracks', String(doc.tracks.length)],
  ]
  return (
    <>
      <PanelHeader title="Project" />
      <dl className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-2 p-3 text-sm">
        {rows.map(([k, v]) => <Fragment key={k}><dt className="text-muted">{k}</dt><dd className="truncate" title={v}>{v}</dd></Fragment>)}
      </dl>
      <div className="px-3"><Button size="sm" onClick={() => useApp.getState().openDialog('project-settings')}>Modify canvas…</Button></div>
      <p className="px-3 pt-4 text-sm text-muted">Select a clip on the timeline to change it.</p>
    </>
  )
}

/** Live value while dragging; one op (one undo step) shortly after the last change. */
function useCommitted<T>(value: T, commit: (v: T) => void, delay = 250): [T, (v: T) => void] {
  const [local, setLocal] = useState(value)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef(false)
  useEffect(() => { if (!pending.current) setLocal(value) }, [value])
  const set = (v: T) => {
    setLocal(v)
    pending.current = true
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { pending.current = false; commit(v) }, delay)
  }
  return [local, set]
}

function MediaInspector({ clip, doc, locked }: { clip: MediaClip; doc: Project; locked: boolean }) {
  const isAudio = clip.kind === 'audio'
  const [tab, setTab] = useState(isAudio ? 'audio' : 'video')
  const [sub, setSub] = useState('basic')
  const asset = doc.assets[clip.assetId]
  const apply = (op: Omit<Extract<OpInput, { type: 'set_clip_props' }>, 'type' | 'clipId'>) => void useApp.getState().apply([{ type: 'set_clip_props', clipId: clip.id, ...op }])
  const [scale, setScale] = useCommitted(Math.round(clip.transform.scale * 100), (v) => apply({ transform: { scale: v / 100 } }))
  const [x, setX] = useCommitted(Math.round(clip.transform.x), (v) => apply({ transform: { x: v } }))
  const [y, setY] = useCommitted(Math.round(clip.transform.y), (v) => apply({ transform: { y: v } }))
  const [rot, setRot] = useCommitted(Math.round(clip.transform.rotation), (v) => apply({ transform: { rotation: v } }))
  const [op, setOp] = useCommitted(Math.round(clip.transform.opacity * 100), (v) => apply({ transform: { opacity: v / 100 } }))
  const [vol, setVol] = useCommitted(clip.volumeDb, (v) => apply({ volumeDb: v }))
  const [speed, setSpeed] = useCommitted(clip.speed, (v) => apply({ speed: v }))
  const maxSpeedForSource = asset?.durationUs ? Math.max(0.1, ((asset.durationUs - clip.inUs) / clip.durationUs) * clip.speed) : 100

  const tabs = [
    ...(!isAudio ? [{ value: 'video', label: 'Video' }] : []),
    { value: 'audio', label: 'Audio', disabled: !asset?.hasAudio },
    { value: 'speed', label: 'Speed', disabled: clip.kind === 'image' },
    ...(!isAudio ? [{ value: 'animation', label: 'Animation' }, { value: 'adjust', label: 'Adjust' }] : []),
  ]
  return (
    <div className={locked ? 'pointer-events-none opacity-60' : ''}>
      <PanelHeader title={<span className="truncate" title={asset?.name}>{asset?.name ?? 'Clip'}</span>} />
      <UnderlineTabs tabs={tabs} value={tab} onValueChange={setTab} />
      <div className="flex flex-col gap-2 p-3">
        {locked && <p className="text-sm text-warning">This track is locked.</p>}
        {tab === 'video' && (
          <>
            <Segmented label="Video tools" value={sub} onValueChange={setSub} options={[{ value: 'basic', label: 'Basic' }, { value: 'bg', label: 'Remove BG' }, { value: 'mask', label: 'Mask' }, { value: 'retouch', label: 'Retouch' }]} />
            {sub === 'basic' ? (
              <div className="mt-2 flex flex-col gap-1.5">
                <SliderField label="Scale" value={scale} onChange={setScale} min={5} max={400} unit="%" defaultValue={100} />
                <SliderField label="Position X" value={x} onChange={setX} min={-doc.canvas.width} max={doc.canvas.width} unit="px" defaultValue={0} bipolar />
                <SliderField label="Position Y" value={y} onChange={setY} min={-doc.canvas.height} max={doc.canvas.height} unit="px" defaultValue={0} bipolar />
                <SliderField label="Rotation" value={rot} onChange={setRot} min={-180} max={180} unit="°" defaultValue={0} bipolar />
                <SliderField label="Opacity" value={op} onChange={setOp} min={0} max={100} unit="%" defaultValue={100} />
                <Switch label="Mirror" checked={clip.transform.flipH} onCheckedChange={(v) => apply({ transform: { flipH: v } })} />
                <p className="pt-2 text-xs text-muted">Keyframes for these values arrive in M1.</p>
              </div>
            ) : (
              <EmptyState icon={<Construction />} title={sub === 'bg' ? 'Background removal comes in M5' : sub === 'mask' ? 'Masks come as a should-have' : 'Retouch comes as a could-have'} body="It will run locally on your GPU, free." />
            )}
          </>
        )}
        {tab === 'audio' && (
          <div className="flex flex-col gap-1.5">
            <SliderField label="Volume" value={vol} onChange={setVol} min={-60} max={20} step={0.5} precision={1} unit="dB" defaultValue={0} bipolar />
            <p className="pt-2 text-xs text-muted">Fades, noise reduction and voice enhancement come in M3.</p>
          </div>
        )}
        {tab === 'speed' && (
          <div className="flex flex-col gap-1.5">
            <SliderField label="Speed" value={speed} onChange={setSpeed} min={0.1} max={Math.min(10, Math.floor(maxSpeedForSource * 10) / 10 || 10)} step={0.1} precision={1} unit="×" defaultValue={1} />
            <p className="text-xs text-muted">Duration {formatUs(clip.durationUs)}. Curves and smooth slow motion come later.</p>
          </div>
        )}
        {(tab === 'animation' || tab === 'adjust') && <EmptyState icon={<Construction />} title={tab === 'animation' ? 'Animations come as a should-have' : 'Color adjustments come in M4'} />}
      </div>
    </div>
  )
}

function CaptionInspector({ clip, track }: { clip: CaptionClip; track: Track }) {
  const style = track.style ?? DEFAULT_CAPTION_STYLE
  const [text, setText] = useState(clip.text)
  useEffect(() => setText(clip.text), [clip.text])
  const commitText = () => { if (text.trim() && text !== clip.text) void useApp.getState().apply([{ type: 'set_caption_text', clipId: clip.id, text: text.trim() }]) }
  const styleOp = (s: Partial<typeof style>) => void useApp.getState().apply([{ type: 'set_track_style', trackId: track.id, style: s }])
  const [size, setSize] = useCommitted(style.fontSize, (v) => styleOp({ fontSize: v }))
  const [pos, setPos] = useCommitted(Math.round(style.y * 100), (v) => styleOp({ y: v / 100 }))
  const [stroke, setStroke] = useCommitted(style.strokeWidth, (v) => styleOp({ strokeWidth: v }))
  const [color, setColor] = useCommitted(style.color, (v) => styleOp({ color: v }), 400)
  const [strokeColor, setStrokeColor] = useCommitted(style.strokeColor, (v) => styleOp({ strokeColor: v }), 400)
  return (
    <>
      <PanelHeader title={<span className="flex items-center gap-1.5"><Captions className="size-3.5 text-muted" />Caption</span>} />
      <div className="flex flex-col gap-3 p-3">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-muted">Text ({formatUs(clip.startUs)}–{formatUs(clip.startUs + clip.durationUs)})</span>
          <textarea value={text} onChange={(e) => setText(e.target.value)} onBlur={commitText} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitText() } }}
            rows={3} maxLength={500} className="resize-none rounded-sm border border-border-input bg-surface-2 p-2 text-md focus-visible:border-focus focus-visible:outline-none" />
        </label>
        <h3 className="pt-1 text-sm text-muted">Style · applies to all captions</h3>
        <SliderField label="Size" value={size} onChange={setSize} min={16} max={200} unit="px" defaultValue={DEFAULT_CAPTION_STYLE.fontSize} />
        <SliderField label="Height" value={pos} onChange={setPos} min={5} max={95} unit="%" defaultValue={Math.round(DEFAULT_CAPTION_STYLE.y * 100)} />
        <SliderField label="Outline" value={stroke} onChange={setStroke} min={0} max={20} unit="px" defaultValue={DEFAULT_CAPTION_STYLE.strokeWidth} />
        <div className="flex items-center gap-3"><span className="w-[88px] text-sm text-muted">Color</span><ColorPicker label="Caption color" value={color} onChange={setColor} /></div>
        <div className="flex items-center gap-3"><span className="w-[88px] text-sm text-muted">Outline color</span><ColorPicker label="Outline color" value={strokeColor} onChange={setStrokeColor} /></div>
      </div>
    </>
  )
}
