import { Fragment, useEffect, useRef, useState } from 'react'
import { Trash2, Construction } from 'lucide-react'
import { Button, ColorPicker, EmptyState, PanelHeader, Segmented, Select, SliderField, Switch, TabPanel, UnderlineTabs, useToast } from '@framevane/ui'
import {
  BLEND_MODES, EASINGS, findClip, formatUs, projectDurationUs, valueAt,
  type AnimatableClip, type AnimProp, type BlendMode, type Easing, type MediaClip, type OpInput, type Project,
} from '@framevane/doc'
import { useApp } from '../app/store'
import { deleteSelection } from './actions'
import { detachAudio, localPlayhead, setAnimProp } from './actions-m1'
import { useEditor } from './Editor'
import { CaptionInspector, TextInspector } from './TextInspector'
import { cleanUpAudio, duckUnderSpeech } from './actions-m3'
import type { AudioPreset } from '../../shared/api'

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
  if (clip.kind === 'text') return <TextInspector key={clip.id} clip={clip} track={track} />
  return <MediaInspector key={clip.id} clip={clip as MediaClip} doc={doc} locked={track.locked} main={track.main} />
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
      <BackgroundTools doc={doc} />
      <p className="px-3 pt-4 text-sm text-muted">Select a clip on the timeline to change it.</p>
    </>
  )
}

/** Canvas background: a colour, or a blurred fill of the main video (for vertical edits of landscape footage). */
function BackgroundTools({ doc }: { doc: Project }) {
  const bg = doc.canvas.background
  const set = (b: Project['canvas']['background']) => void useApp.getState().apply([{ type: 'set_canvas', canvas: { background: b } }])
  const [amount, setAmount] = useCommitted(Math.round((bg.kind === 'blur' ? bg.amount : 0.5) * 100), (v) => set({ kind: 'blur', amount: v / 100 }))
  const [color, setColor] = useCommitted(bg.kind === 'color' ? bg.color : '#000000', (c) => set({ kind: 'color', color: c }), 400)
  return (
    <div className="flex flex-col gap-2 px-3 pt-4">
      <h3 className="text-sm text-muted">Background</h3>
      <Segmented label="Background" value={bg.kind} onValueChange={(k) => set(k === 'blur' ? { kind: 'blur', amount: amount / 100 } : { kind: 'color', color })}
        options={[{ value: 'color', label: 'Colour' }, { value: 'blur', label: 'Blur' }]} />
      {bg.kind === 'color'
        ? <ColorPicker label="Background colour" value={color} onChange={setColor} />
        : <SliderField label="Blur" value={amount} onChange={setAmount} min={0} max={100} unit="%" defaultValue={50} />}
    </div>
  )
}

/** Live value while dragging; one op (one undo step) shortly after the last change. */
export function useCommitted<T>(value: T, commit: (v: T) => void, delay = 250): [T, (v: T) => void] {
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

function MediaInspector({ clip, doc, locked, main }: { clip: MediaClip; doc: Project; locked: boolean; main: boolean }) {
  const isAudio = clip.kind === 'audio'
  const [tab, setTab] = useState(isAudio ? 'audio' : 'video')
  const [sub, setSub] = useState('basic')
  const asset = doc.assets[clip.assetId]
  const playheadUs = useApp((s) => s.playheadUs)
  const apply = (op: Omit<Extract<OpInput, { type: 'set_clip_props' }>, 'type' | 'clipId'>) => void useApp.getState().apply([{ type: 'set_clip_props', clipId: clip.id, ...op }])
  const [speed, setSpeed] = useCommitted(clip.speed, (v) => apply({ speed: v }))
  const maxSpeedForSource = asset?.durationUs ? Math.max(0.1, ((asset.durationUs - clip.inUs) / clip.durationUs) * clip.speed) : 100
  const local = localPlayhead(clip, playheadUs)
  const keysHere = (Object.entries(clip.keyframes) as [AnimProp, { tUs: number; value: number; easing: Easing }[] | undefined][])
    .flatMap(([prop, kfs]) => (kfs ?? []).filter((k) => Math.abs(k.tUs - local) <= 16_666).map((k) => ({ prop, ...k })))
  const animated = Object.values(clip.keyframes).some((k) => k?.length)

  const tabs = [
    ...(!isAudio ? [{ value: 'video', label: 'Video' }] : []),
    { value: 'audio', label: 'Audio', disabled: !asset?.hasAudio || clip.freezeAtUs !== undefined },
    { value: 'speed', label: 'Speed', disabled: clip.kind === 'image' || clip.freezeAtUs !== undefined },
    ...(!isAudio ? [{ value: 'animation', label: 'Animation' }, { value: 'adjust', label: 'Adjust' }] : []),
  ]
  const title = `${asset?.name ?? 'Clip'}${clip.freezeAtUs !== undefined ? ' · freeze frame' : ''}${clip.reversed ? ' · reversed' : ''}`
  return (
    <div className={locked ? 'pointer-events-none opacity-60' : ''}>
      <PanelHeader title={<span className="truncate" title={title}>{title}</span>} />
      <UnderlineTabs tabs={tabs} value={tab} onValueChange={setTab}>
      <div className="flex flex-col gap-2 p-3">
        {locked && <p className="text-sm text-warning">This track is locked.</p>}
        <TabPanel value="video" className="flex flex-col gap-2">
          <Segmented label="Video tools" value={sub} onValueChange={setSub} options={[{ value: 'basic', label: 'Basic' }, { value: 'crop', label: 'Crop' }, { value: 'bg', label: 'Remove BG' }, { value: 'mask', label: 'Mask' }]} />
          {sub === 'basic' && (
            <div className="mt-2 flex flex-col gap-1.5">
              <AnimSlider clip={clip} prop="scale" label="Scale" min={5} max={400} unit="%" toUi={(v) => Math.round(v * 100)} fromUi={(v) => v / 100} defaultValue={100} />
              <AnimSlider clip={clip} prop="x" label="Position X" min={-doc.canvas.width} max={doc.canvas.width} unit="px" defaultValue={0} bipolar />
              <AnimSlider clip={clip} prop="y" label="Position Y" min={-doc.canvas.height} max={doc.canvas.height} unit="px" defaultValue={0} bipolar />
              <AnimSlider clip={clip} prop="rotation" label="Rotation" min={-180} max={180} unit="°" defaultValue={0} bipolar />
              <AnimSlider clip={clip} prop="opacity" label="Opacity" min={0} max={100} unit="%" toUi={(v) => Math.round(v * 100)} fromUi={(v) => v / 100} defaultValue={100} />
              <div className="flex items-center justify-between gap-2 pt-1">
                <Select label="Blend" value={clip.blend} width={150} onValueChange={(v) => apply({ blend: v as BlendMode })}
                  options={BLEND_MODES.map((b) => ({ value: b, label: b === 'normal' ? 'Normal' : b.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()) }))} />
                <Switch label="Mirror" checked={clip.transform.flipH} onCheckedChange={(v) => apply({ transform: { flipH: v } })} />
              </div>
              <KeyframeTools clip={clip} keysHere={keysHere} animated={animated} local={local} />
            </div>
          )}
          {sub === 'crop' && <CropTools clip={clip} />}
          {(sub === 'bg' || sub === 'mask') && (
            <EmptyState icon={<Construction />} title={sub === 'bg' ? 'Background removal comes in M5' : 'Masks come as a should-have'} body="It will run locally on your GPU, free." />
          )}
        </TabPanel>
        <TabPanel value="audio">
          <div className="flex flex-col gap-1.5">
            <AnimSlider clip={clip} prop="volumeDb" label="Volume" min={-60} max={20} step={0.5} precision={1} unit="dB" defaultValue={0} bipolar />
            {!clip.audioEnabled && <p className="text-sm text-muted">This clip's sound was detached to a linked audio clip.</p>}
            {clip.kind === 'video' && clip.audioEnabled && <Button size="sm" onClick={() => void detachAudio()}>Detach audio</Button>}
            {isAudio && <KeyframeTools clip={clip} keysHere={keysHere} animated={animated} local={local} />}
            {clip.audioEnabled && <AudioTools clip={clip} isMain={main} />}
          </div>
        </TabPanel>
        <TabPanel value="speed">
          <div className="flex flex-col gap-1.5">
            <SliderField label="Speed" value={speed} onChange={setSpeed} min={0.1} max={Math.min(10, Math.floor(maxSpeedForSource * 10) / 10 || 10)} step={0.1} precision={1} unit="×" defaultValue={1} />
            <p className="text-xs text-muted">Duration {formatUs(clip.durationUs)}. Keyframes stretch with the speed. Curves and smooth slow motion come later.</p>
          </div>
        </TabPanel>
        <TabPanel value="animation"><EmptyState icon={<Construction />} title="Animations come as a should-have" body="For now, key Position, Scale or Opacity on the Video tab." /></TabPanel>
        <TabPanel value="adjust"><EmptyState icon={<Construction />} title="Color adjustments come in M4" /></TabPanel>
      </div>
      </UnderlineTabs>
    </div>
  )
}

/** A slider bound to an animatable property: shows the value at the playhead, keys it if the property is animated. */
export function AnimSlider({ clip, prop, label, toUi = (v) => Math.round(v), fromUi = (v) => v, ...rest }: {
  clip: AnimatableClip; prop: AnimProp; label: string; min: number; max: number; step?: number; precision?: number; unit?: string; defaultValue?: number; bipolar?: boolean
  toUi?: (v: number) => number; fromUi?: (v: number) => number
}) {
  const playheadUs = useApp((s) => s.playheadUs)
  const { seek } = useEditor()
  const local = localPlayhead(clip, playheadUs)
  const shown = toUi(valueAt(clip, prop, local))
  const [v, setV] = useCommitted(shown, (x) => void useApp.getState().apply([setAnimProp(clip, prop, fromUi(x))]))
  const kfs = clip.keyframes[prop] ?? []
  const here = kfs.find((k) => Math.abs(k.tUs - local) <= 16_666)
  const state = !kfs.length ? 'none' : here ? 'on' : 'has'
  const prev = [...kfs].reverse().find((k) => k.tUs < local - 16_666)
  const next = kfs.find((k) => k.tUs > local + 16_666)
  return (
    <SliderField label={label} value={v} onChange={setV} {...rest}
      keyframe={{
        state,
        onToggle: () => void useApp.getState().apply([here
          ? { type: 'remove_keyframe', clipId: clip.id, prop, tUs: here.tUs }
          : { type: 'set_keyframe', clipId: clip.id, prop, tUs: local, value: fromUi(v) }]),
        onPrev: prev ? () => seek(clip.startUs + prev.tUs) : undefined,
        onNext: next ? () => seek(clip.startUs + next.tUs) : undefined,
      }} />
  )
}

export function KeyframeTools({ clip, keysHere, animated, local }: { clip: AnimatableClip; keysHere: { prop: AnimProp; tUs: number; value: number; easing: Easing }[]; animated: boolean; local: number }) {
  if (!animated) return <p className="pt-2 text-xs text-muted">Tap a ◇ to key a value at the playhead, move the playhead, then change the value.</p>
  const easing = keysHere[0]?.easing
  return (
    <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
      {keysHere.length ? (
        <Select label="Easing" value={easing ?? 'ease-in-out'} width={130} onValueChange={(e) => void useApp.getState().apply(keysHere.map((k) => ({ type: 'set_keyframe', clipId: clip.id, prop: k.prop, tUs: k.tUs, value: k.value, easing: e as Easing })))}
          options={EASINGS.map((e) => ({ value: e, label: EASING_LABELS[e] }))} />
      ) : <span className="text-xs text-muted">Move to a ◆ to change its easing.</span>}
      <Button size="sm" variant="ghost" onClick={() => void useApp.getState().apply([{ type: 'clear_keyframes', clipId: clip.id, atUs: local }])}>Clear keyframes</Button>
    </div>
  )
}
const EASING_LABELS: Record<Easing, string> = { linear: 'Linear', 'ease-in': 'Ease in', 'ease-out': 'Ease out', 'ease-in-out': 'Smooth', hold: 'Hold' }

function CropTools({ clip }: { clip: MediaClip }) {
  const c = clip.transform.crop
  const set = (side: keyof typeof c, pct: number) => {
    const next = { ...c, [side]: Math.min(0.9, pct / 100) }
    if (next.left + next.right > 0.95 || next.top + next.bottom > 0.95) return
    void useApp.getState().apply([{ type: 'set_clip_props', clipId: clip.id, transform: { crop: next } }])
  }
  const [l, setL] = useCommitted(Math.round(c.left * 100), (v) => set('left', v))
  const [t, setT] = useCommitted(Math.round(c.top * 100), (v) => set('top', v))
  const [r, setR] = useCommitted(Math.round(c.right * 100), (v) => set('right', v))
  const [b, setB] = useCommitted(Math.round(c.bottom * 100), (v) => set('bottom', v))
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <SliderField label="Left" value={l} onChange={setL} min={0} max={90} unit="%" defaultValue={0} />
      <SliderField label="Top" value={t} onChange={setT} min={0} max={90} unit="%" defaultValue={0} />
      <SliderField label="Right" value={r} onChange={setR} min={0} max={90} unit="%" defaultValue={0} />
      <SliderField label="Bottom" value={b} onChange={setB} min={0} max={90} unit="%" defaultValue={0} />
      <p className="text-xs text-muted">Cropping hides edges without zooming. Use Scale to fill the frame again.</p>
    </div>
  )
}

const CLEANUP: { value: AudioPreset; label: string; hint: string }[] = [
  { value: 'denoise', label: 'Reduce noise', hint: 'hum, hiss, room' },
  { value: 'denoise-light', label: 'Reduce noise (light)', hint: 'gentle' },
  { value: 'denoise-strong', label: 'Reduce noise (strong)', hint: 'noisy places' },
  { value: 'enhance', label: 'Enhance voice', hint: 'clearer, even' },
  { value: 'normalize', label: 'Normalize loudness', hint: '−14 LUFS' },
]

/** Fades, local clean-up (FFmpeg filters → a new audio file), and ducking music under speech. */
function AudioTools({ clip, isMain }: { clip: MediaClip; isMain: boolean }) {
  const maxFade = Math.max(0.1, Math.floor(clip.durationUs / 2 / 1e5) / 10)
  const [fin, setFin] = useCommitted(Math.round(clip.fadeInUs / 1e5) / 10, (v) => void useApp.getState().apply([{ type: 'set_clip_props', clipId: clip.id, fadeInUs: Math.round(v * 1e6) }]))
  const [fout, setFout] = useCommitted(Math.round(clip.fadeOutUs / 1e5) / 10, (v) => void useApp.getState().apply([{ type: 'set_clip_props', clipId: clip.id, fadeOutUs: Math.round(v * 1e6) }]))
  const [preset, setPreset] = useState<AudioPreset>('denoise')
  const [busy, setBusy] = useState<'clean' | 'duck' | null>(null)
  const toast = useToast()
  const msg = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <SliderField label="Fade in" value={fin} onChange={setFin} min={0} max={Math.min(10, maxFade)} step={0.1} precision={1} unit="s" defaultValue={0} />
      <SliderField label="Fade out" value={fout} onChange={setFout} min={0} max={Math.min(10, maxFade)} step={0.1} precision={1} unit="s" defaultValue={0} />
      <h3 className="pt-2 text-sm text-muted">Clean up</h3>
      <div className="flex items-center gap-2">
        <Select label="Clean-up" hideLabel value={preset} width={190} onValueChange={(v) => setPreset(v as AudioPreset)} options={CLEANUP} />
        <Button size="sm" loading={busy === 'clean'} onClick={async () => {
          setBusy('clean')
          try {
            if (await cleanUpAudio(clip.id, preset)) toast({ tone: 'success', title: `${CLEANUP.find((c) => c.value === preset)!.label}: done`, description: clip.kind === 'video' ? 'The cleaned sound is on a linked audio clip. Ctrl+Z undoes it.' : 'Ctrl+Z undoes it.' })
          } catch (e) { toast({ tone: 'error', title: "The sound couldn't be cleaned up", description: msg(e) }) } finally { setBusy(null) }
        }}>Apply</Button>
      </div>
      <p className="text-xs text-muted">Runs on your computer and makes a new audio file; the original is kept.</p>
      {clip.kind === 'audio' && !isMain && (
        <>
          <h3 className="pt-2 text-sm text-muted">Music under speech</h3>
          <Button size="sm" loading={busy === 'duck'} onClick={async () => {
            setBusy('duck')
            try {
              const n = await duckUnderSpeech(clip.id)
              if (n) toast({ tone: 'success', title: 'Music lowered under speech', description: `${n} stretch${n === 1 ? '' : 'es'} of talking. Adjust the curve with the volume keyframes.` })
            } catch (e) { toast({ tone: 'error', title: "Couldn't find the speech", description: msg(e) }) } finally { setBusy(null) }
          }}>Lower under speech</Button>
        </>
      )}
    </div>
  )
}

