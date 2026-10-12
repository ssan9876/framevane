import { ArrowDown, ArrowUp, FileUp, Pipette, Trash2 } from 'lucide-react'
import { Button, ColorPicker, Select, SliderField, Switch, useToast } from '@framevane/ui'
import {
  effectDef, effectParams, filterDef, findClip, NO_COLOR,
  type ColorAdjust, type Effect, type MediaClip, type OpInput, type Project,
} from '@framevane/doc'
import { useApp } from '../app/store'
import { applyFilter, applyLut, importLuts, pickScreenColor, setEffects } from './actions-m4'
import { useCommitted } from './Inspector'

/** S14/S18 inspector parts for a clip's look: colour, filter, LUT, effects, chroma key. */

const errText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
const look = (clipId: string, patch: Omit<Extract<OpInput, { type: 'set_look' }>, 'type' | 'clipId'>) => useApp.getState().apply([{ type: 'set_look', clipId, ...patch }])
/** The clip as it is in the store right now (commits fire after a delay; the props may be stale by then). */
const live = (id: string) => findClip(useApp.getState().doc!, id)?.clip as MediaClip | undefined

const COLOR_GROUPS: { title: string; rows: { key: keyof ColorAdjust; label: string; bipolar: boolean }[] }[] = [
  { title: 'Light', rows: [
    { key: 'exposure', label: 'Exposure', bipolar: true }, { key: 'brightness', label: 'Brightness', bipolar: true }, { key: 'contrast', label: 'Contrast', bipolar: true },
    { key: 'highlights', label: 'Highlights', bipolar: true }, { key: 'shadows', label: 'Shadows', bipolar: true },
  ] },
  { title: 'Colour', rows: [
    { key: 'saturation', label: 'Saturation', bipolar: true }, { key: 'vibrance', label: 'Vibrance', bipolar: true },
    { key: 'temperature', label: 'Temperature', bipolar: true }, { key: 'tint', label: 'Tint', bipolar: true },
  ] },
  { title: 'Finish', rows: [
    { key: 'fade', label: 'Fade', bipolar: false }, { key: 'sharpen', label: 'Sharpen', bipolar: false },
    { key: 'vignette', label: 'Vignette', bipolar: false }, { key: 'grain', label: 'Grain', bipolar: false },
  ] },
]

function ColorSlider({ clip, k, label, bipolar }: { clip: MediaClip; k: keyof ColorAdjust; label: string; bipolar: boolean }) {
  const [v, setV] = useCommitted(clip.color[k], (x) => void look(clip.id, { color: { [k]: x } }))
  return <SliderField label={label} value={v} onChange={setV} min={bipolar ? -100 : 0} max={100} defaultValue={0} bipolar={bipolar} />
}

/** Adjust tab: filter strength, LUT, and basic colour. */
export function AdjustPanel({ clip, doc }: { clip: MediaClip; doc: Project }) {
  const toast = useToast()
  const f = clip.filter ? filterDef(clip.filter.id) : undefined
  const [strength, setStrength] = useCommitted(Math.round((clip.filter?.intensity ?? 0.8) * 100), (x) => { const c = live(clip.id); if (c?.filter) void applyFilter([clip.id], c.filter.id, x / 100) })
  const [lutMix, setLutMix] = useCommitted(Math.round((clip.lut?.intensity ?? 1) * 100), (x) => { const c = live(clip.id); if (c?.lut) void applyLut([clip.id], c.lut.id, x / 100) })
  const changed = (Object.keys(NO_COLOR) as (keyof ColorAdjust)[]).some((k) => clip.color[k] !== NO_COLOR[k])
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm text-muted">Filter</h3>
      {f ? (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm">{f.name}</span>
            <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => void applyFilter([clip.id], null)}>Remove</Button>
          </div>
          <SliderField label="Strength" value={strength} onChange={setStrength} min={0} max={100} unit="%" defaultValue={80} />
        </>
      ) : <p className="text-xs text-muted">None. Pick one in the Filters tab.</p>}

      <h3 className="pt-2 text-sm text-muted">LUT</h3>
      <div className="flex items-center gap-2">
        <Select label="LUT" hideLabel value={clip.lut?.id ?? 'none'} width={170} onValueChange={(id) => void applyLut([clip.id], id === 'none' ? null : id, clip.lut?.intensity ?? 1)}
          options={[{ value: 'none', label: 'None' }, ...Object.values(doc.luts).map((l) => ({ value: l.id, label: l.name }))]} />
        <Button size="sm" icon={<FileUp className="size-3.5" />} onClick={async () => {
          try {
            const ids = await importLuts()
            if (ids.length) await applyLut([clip.id], ids[0]!)
          } catch (e) { toast({ tone: 'error', title: "That LUT didn't come in", description: errText(e) }) }
        }}>Import .cube</Button>
      </div>
      {clip.lut && <SliderField label="LUT strength" value={lutMix} onChange={setLutMix} min={0} max={100} unit="%" defaultValue={100} />}

      {COLOR_GROUPS.map((g) => (
        <div key={g.title} className="flex flex-col gap-1.5">
          <h3 className="pt-2 text-sm text-muted">{g.title}</h3>
          {g.rows.map((r) => <ColorSlider key={r.key} clip={clip} k={r.key} label={r.label} bipolar={r.bipolar} />)}
        </div>
      ))}
      <div className="flex justify-end pt-1">
        <Button size="sm" variant="ghost" disabled={!changed} onClick={() => void look(clip.id, { color: NO_COLOR })}>Reset colour</Button>
      </div>
    </div>
  )
}

/* ───────────── effects ───────────── */

function EffectParam({ clipId, effectId, k, label, min, max, step, unit, value, def }: { clipId: string; effectId: string; k: string; label: string; min: number; max: number; step?: number; unit?: string; value: number; def: number }) {
  const [v, setV] = useCommitted(value, (x) => {
    const c = live(clipId)
    if (!c) return
    void setEffects(clipId, c.effects.map((e) => (e.id === effectId ? { ...e, params: { ...e.params, [k]: x } } : e)))
  })
  return <SliderField label={label} value={v} onChange={setV} min={min} max={max} step={step} unit={unit} defaultValue={def} bipolar={min < 0} />
}

export function EffectsPanel({ clip }: { clip: MediaClip }) {
  const move = (i: number, d: -1 | 1) => {
    const list = [...clip.effects]
    const [e] = list.splice(i, 1)
    list.splice(i + d, 0, e!)
    void setEffects(clip.id, list)
  }
  if (!clip.effects.length) return <p className="text-sm text-muted">No effects yet. Pick one in the Effects tab; they run top to bottom.</p>
  return (
    <ol aria-label="Effects on this clip" className="flex flex-col gap-3">
      {clip.effects.map((e: Effect, i) => {
        const def = effectDef(e.kind)
        const params = effectParams(e)
        const name = def?.name ?? e.kind
        return (
          <li key={e.id} className="flex flex-col gap-1.5 rounded-md border border-border p-2">
            <div className="flex items-center justify-between gap-1">
              <span className="text-sm">{name}</span>
              <span className="flex gap-0.5">
                <Button size="sm" variant="ghost" aria-label={`Move ${name} up`} disabled={i === 0} icon={<ArrowUp className="size-3.5" />} onClick={() => move(i, -1)} />
                <Button size="sm" variant="ghost" aria-label={`Move ${name} down`} disabled={i === clip.effects.length - 1} icon={<ArrowDown className="size-3.5" />} onClick={() => move(i, 1)} />
                <Button size="sm" variant="ghost" aria-label={`Remove ${name}`} icon={<Trash2 className="size-3.5" />} onClick={() => void setEffects(clip.id, clip.effects.filter((x) => x.id !== e.id))} />
              </span>
            </div>
            {def?.params.map((p) => (
              <EffectParam key={p.key} clipId={clip.id} effectId={e.id} k={p.key} label={p.label} min={p.min} max={p.max} step={p.step} unit={p.unit} value={params[p.key] ?? p.default} def={p.default} />
            ))}
          </li>
        )
      })}
    </ol>
  )
}

/* ───────────── chroma key ───────────── */

const KEY_SWATCHES = ['#00ff00', '#00b140', '#3fae49', '#0047bb', '#0000ff', '#1f5bd6']

export function ChromaPanel({ clip }: { clip: MediaClip }) {
  const toast = useToast()
  const k = clip.chroma
  const [intensity, setIntensity] = useCommitted(Math.round((k?.intensity ?? 0.4) * 100), (x) => void look(clip.id, { chroma: { intensity: x / 100 } }))
  const [edge, setEdge] = useCommitted(Math.round((k?.edge ?? 0.2) * 100), (x) => void look(clip.id, { chroma: { edge: x / 100 } }))
  const [shadow, setShadow] = useCommitted(Math.round((k?.shadow ?? 0) * 100), (x) => void look(clip.id, { chroma: { shadow: x / 100 } }))
  const [spill, setSpill] = useCommitted(Math.round((k?.spill ?? 0.5) * 100), (x) => void look(clip.id, { chroma: { spill: x / 100 } }))
  const [color, setColor] = useCommitted(k?.color ?? '#00ff00', (c) => void look(clip.id, { chroma: { color: c } }), 300)
  return (
    <div className="flex flex-col gap-2">
      <Switch label="Chroma key" description="Make a green or blue screen see-through" checked={!!k} onCheckedChange={(on) => void look(clip.id, { chroma: on ? {} : null })} />
      {k && (
        <>
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1"><ColorPicker label="Key colour" value={color} onChange={setColor} swatches={KEY_SWATCHES} /></div>
            <Button size="sm" icon={<Pipette className="size-3.5" />} onClick={async () => {
              const c = await pickScreenColor()
              if (c) setColor(c)
              else if (!('EyeDropper' in window)) toast({ tone: 'warning', title: "Picking from the screen isn't available", description: 'Type the colour or pick a swatch.' })
            }}>Pick</Button>
          </div>
          <SliderField label="Intensity" value={intensity} onChange={setIntensity} min={0} max={100} unit="%" defaultValue={40} />
          <SliderField label="Edge softness" value={edge} onChange={setEdge} min={0} max={100} unit="%" defaultValue={20} />
          <SliderField label="Keep shadows" value={shadow} onChange={setShadow} min={0} max={100} unit="%" defaultValue={0} />
          <SliderField label="Remove spill" value={spill} onChange={setSpill} min={0} max={100} unit="%" defaultValue={50} />
          <p className="text-xs text-muted">Put the clip on a track above its new background. Raise Intensity until the screen is gone, then soften the edge.</p>
        </>
      )}
    </div>
  )
}
