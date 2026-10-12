import { useEffect, useRef, useState } from 'react'
import { FileUp, Trash2 } from 'lucide-react'
import { Button, SliderField, useToast } from '@framevane/ui'
import {
  EFFECTS, effectParams, FILTERS, findClip, nextAdjacent, NO_COLOR, NO_LOOK, transitionDef, TRANSITIONS,
  type Lut3D, type MediaClip, type Project,
} from '@framevane/doc'
import { useApp } from '../app/store'
import { LookRenderer } from '../engine/gl'
import { load as loadLut } from '../engine/luts'
import { addEffect, applyFilter, applyLut, applyTransitionToAll, cutsOn, importLuts, selectedVisuals, setTransition } from './actions-m4'
import { useCommitted } from './Inspector'

const errText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
const TW = 320
const TH = 180

/* ───────────── sample pictures for the tiles (drawn, not photos) ───────────── */

let scenes: [OffscreenCanvas, OffscreenCanvas] | null = null
function sampleScenes(): [OffscreenCanvas, OffscreenCanvas] {
  if (scenes) return scenes
  const day = new OffscreenCanvas(TW, TH)
  const d = day.getContext('2d')!
  const sky = d.createLinearGradient(0, 0, 0, TH)
  sky.addColorStop(0, '#3d7fd6')
  sky.addColorStop(0.65, '#f4c77d')
  d.fillStyle = sky
  d.fillRect(0, 0, TW, TH)
  d.fillStyle = '#ffd34d'
  d.beginPath(); d.arc(236, 70, 26, 0, Math.PI * 2); d.fill()
  d.fillStyle = '#5b4a8c'
  d.beginPath(); d.moveTo(0, 130); d.lineTo(70, 70); d.lineTo(150, 130); d.fill()
  d.fillStyle = '#2f7a4b'
  d.beginPath(); d.moveTo(90, 140); d.lineTo(190, 80); d.lineTo(320, 140); d.lineTo(320, 180); d.lineTo(90, 180); d.fill()
  d.fillStyle = '#3c9d5d'
  d.fillRect(0, 140, TW, 40)
  // a person: skin, red top, dark hair
  d.fillStyle = '#d63c3c'; d.fillRect(52, 118, 34, 50)
  d.fillStyle = '#e8b58f'; d.beginPath(); d.arc(69, 104, 14, 0, Math.PI * 2); d.fill()
  d.fillStyle = '#2b1d16'; d.beginPath(); d.arc(69, 99, 14, Math.PI, Math.PI * 2); d.fill()
  const night = new OffscreenCanvas(TW, TH)
  const n = night.getContext('2d')!
  const ns = n.createLinearGradient(0, 0, 0, TH)
  ns.addColorStop(0, '#0d1030')
  ns.addColorStop(1, '#40275e')
  n.fillStyle = ns
  n.fillRect(0, 0, TW, TH)
  n.fillStyle = '#f2efe0'
  n.beginPath(); n.arc(70, 46, 16, 0, Math.PI * 2); n.fill()
  const towers = [[150, 70, 34], [190, 40, 30], [226, 90, 26], [258, 56, 40], [104, 100, 36]] as const
  for (const [x, top, w] of towers) {
    n.fillStyle = '#1b1838'
    n.fillRect(x, top, w, TH - top)
    n.fillStyle = '#ffcf5a'
    for (let y = top + 8; y < TH - 6; y += 12) for (let wx = x + 5; wx < x + w - 6; wx += 9) if ((wx * 7 + y * 3) % 5 < 3) n.fillRect(wx, y, 4, 5)
  }
  scenes = [day, night]
  return scenes
}

const tileClip = (look: Partial<MediaClip>) => ({ ...NO_LOOK, color: NO_COLOR, kind: 'video', ...look }) as MediaClip

function useTile(draw: (fx: LookRenderer, a: OffscreenCanvas, b: OffscreenCanvas) => ReturnType<LookRenderer['look']> | null, deps: unknown[]) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const ctx = c.getContext('2d')!
    const [a, b] = sampleScenes()
    const fx = LookRenderer.get()
    const out = fx ? draw(fx, a, b) : null
    ctx.clearRect(0, 0, c.width, c.height)
    if (out) ctx.drawImage(out.canvas, out.sx, out.sy, out.w, out.h, 0, 0, c.width, c.height)
    else ctx.drawImage(a, 0, 0, c.width, c.height)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return ref
}

function Tile({ label, title, active, onClick, children }: { label: string; title: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <li>
      <button type="button" aria-label={label} aria-pressed={active} title={title} onClick={onClick}
        className={`flex w-full flex-col items-stretch gap-1 overflow-hidden rounded-md border bg-bg p-1 text-left hover:border-accent ${active ? 'border-accent' : 'border-border'}`}>
        {children}
        <span className="truncate px-0.5 text-xs text-muted">{title}</span>
      </button>
    </li>
  )
}

function LookPreview({ look, t = 0 }: { look: Partial<MediaClip>; t?: number }) {
  const ref = useTile((fx, a) => fx.look(a, TW, TH, tileClip(look), t, null, null), [JSON.stringify(look), t])
  return <canvas ref={ref} width={TW} height={TH} aria-hidden className="aspect-video w-full rounded-sm" />
}

function LutPreview({ lut, file }: { lut: Lut3D; file: string }) {
  const ref = useTile((fx, a) => fx.look(a, TW, TH, tileClip({ lut: { id: 'x', intensity: 1 } }), 0, lut, file), [file])
  return <canvas ref={ref} width={TW} height={TH} aria-hidden className="aspect-video w-full rounded-sm" />
}

function TransitionPreview({ kind }: { kind: string }) {
  const ref = useTile((fx, a, b) => fx.transition(a, b, TW, TH, kind, 0.42), [kind])
  return <canvas ref={ref} width={TW} height={TH} aria-hidden className="aspect-video w-full rounded-sm" />
}

const grid = 'grid grid-cols-2 gap-2'

function useSelectedVisuals() {
  const doc = useApp((s) => s.doc)!
  const selection = useApp((s) => s.selection)
  return { doc, clips: selectedVisuals(doc, selection) }
}

function Target({ clips, doc, none }: { clips: MediaClip[]; doc: Project; none: string }) {
  if (!clips.length) return <p className="text-sm text-muted">{none}</p>
  const name = clips.length === 1 ? doc.assets[clips[0]!.assetId]?.name ?? 'the clip' : `${clips.length} clips`
  return <p className="truncate text-sm text-muted" title={name}>Applies to <span className="text-fg">{name}</span></p>
}

/* ───────────── S08 · Effects ───────────── */

const EFFECT_GROUPS: [string, string][] = [['basic', 'Basic'], ['light', 'Light'], ['retro', 'Retro'], ['distort', 'Distort'], ['stylize', 'Stylize']]

export function EffectsTab() {
  const { doc, clips } = useSelectedVisuals()
  const toast = useToast()
  const add = async (kind: string, name: string) => {
    if (!clips.length) { toast({ tone: 'warning', title: 'Select a video or photo first', description: 'Effects go on the clips you select on the timeline.' }); return }
    try {
      if (await addEffect(clips.map((c) => c.id), kind)) toast({ tone: 'success', title: `${name} added`, description: 'Change it under Effects in the inspector. Ctrl+Z undoes it.' })
    } catch (e) { toast({ tone: 'error', title: "The effect wasn't added", description: errText(e) }) }
  }
  return (
    <div className="scroll-y flex h-full flex-col gap-3 p-3">
      <Target clips={clips} doc={doc} none="Select a video or photo on the timeline, then pick an effect." />
      {EFFECT_GROUPS.map(([cat, title]) => (
        <section key={cat} className="flex flex-col gap-2">
          <h3 className="text-sm text-muted">{title}</h3>
          <ul aria-label={`${title} effects`} className={grid}>
            {EFFECTS.filter((e) => e.category === cat).map((e) => (
              <Tile key={e.kind} label={`Add ${e.name} effect`} title={e.name} onClick={() => void add(e.kind, e.name)}>
                <LookPreview look={{ effects: [{ id: 'p', kind: e.kind, params: effectParams({ kind: e.kind, params: {} }) }] }} t={e.animated ? 0.37 : 0} />
              </Tile>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

/* ───────────── S10 · Filters and LUTs ───────────── */

const FILTER_GROUPS: [string, string][] = [['natural', 'Natural'], ['warm', 'Warm'], ['cool', 'Cool'], ['vivid', 'Vivid'], ['film', 'Film'], ['mono', 'Black & white']]

export function FiltersTab() {
  const { doc, clips } = useSelectedVisuals()
  const toast = useToast()
  const current = clips.length === 1 ? clips[0]!.filter?.id ?? null : null
  const currentLut = clips.length === 1 ? clips[0]!.lut?.id ?? null : null
  const [luts, setLuts] = useState<Record<string, Lut3D>>({})
  const [importing, setImporting] = useState(false)
  useEffect(() => {
    let alive = true
    for (const r of Object.values(doc.luts)) void loadLut(r.file).then((l) => { if (alive && l) setLuts((m) => (m[r.file] ? m : { ...m, [r.file]: l })) })
    return () => { alive = false }
  }, [doc.luts])
  const need = () => { toast({ tone: 'warning', title: 'Select a video or photo first', description: 'Filters go on the clips you select on the timeline.' }); return false }
  const pick = async (id: string | null) => { if (clips.length || need()) await applyFilter(clips.map((c) => c.id), id) }
  const pickLut = async (id: string | null) => { if (clips.length || need()) await applyLut(clips.map((c) => c.id), id) }
  return (
    <div className="scroll-y flex h-full flex-col gap-3 p-3">
      <Target clips={clips} doc={doc} none="Select a video or photo on the timeline, then pick a filter." />
      {clips.length === 1 && clips[0]!.filter && <FilterStrength clip={clips[0]!} />}
      <ul aria-label="No filter" className={grid}>
        <Tile label="No filter" title="None" active={clips.length === 1 && !current} onClick={() => void pick(null)}>
          <LookPreview look={{}} />
        </Tile>
      </ul>
      {FILTER_GROUPS.map(([cat, title]) => (
        <section key={cat} className="flex flex-col gap-2">
          <h3 className="text-sm text-muted">{title}</h3>
          <ul aria-label={`${title} filters`} className={grid}>
            {FILTERS.filter((f) => f.category === cat).map((f) => (
              <Tile key={f.id} label={`${f.name} filter`} title={f.name} active={current === f.id} onClick={() => void pick(f.id)}>
                <LookPreview look={{ filter: { id: f.id, intensity: 1 } }} />
              </Tile>
            ))}
          </ul>
        </section>
      ))}
      <section className="flex flex-col gap-2 border-t border-border pt-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm text-muted">LUTs</h3>
          <Button size="sm" icon={<FileUp className="size-3.5" />} loading={importing} onClick={async () => {
            setImporting(true)
            try {
              const ids = await importLuts()
              if (ids.length && clips.length) await applyLut(clips.map((c) => c.id), ids[0]!)
              if (ids.length) toast({ tone: 'success', title: `${ids.length} LUT${ids.length === 1 ? '' : 's'} imported`, description: clips.length ? 'Applied to the selection.' : 'Select a clip and pick it below.' })
            } catch (e) { toast({ tone: 'error', title: "That LUT didn't come in", description: errText(e) }) } finally { setImporting(false) }
          }}>Import .cube</Button>
        </div>
        {Object.values(doc.luts).length ? (
          <ul aria-label="LUTs" className={grid}>
            {currentLut && <Tile label="No LUT" title="No LUT" onClick={() => void pickLut(null)}><LookPreview look={{}} /></Tile>}
            {Object.values(doc.luts).map((r) => (
              <Tile key={r.id} label={`${r.name} LUT`} title={r.name} active={currentLut === r.id} onClick={() => void pickLut(r.id)}>
                {luts[r.file] ? <LutPreview lut={luts[r.file]!} file={r.file} /> : <div className="aspect-video w-full rounded-sm bg-surface-3" />}
              </Tile>
            ))}
          </ul>
        ) : <p className="text-xs text-muted">Bring in colour grades as 3D .cube files (from Resolve, Premiere, or LUT packs).</p>}
      </section>
    </div>
  )
}

function FilterStrength({ clip }: { clip: MediaClip }) {
  const [v, setV] = useCommitted(Math.round((clip.filter?.intensity ?? 0.8) * 100), (x) => void applyFilter([clip.id], clip.filter!.id, x / 100))
  return <SliderField label="Filter strength" value={v} onChange={setV} min={0} max={100} unit="%" defaultValue={80} />
}

/* ───────────── S09 · Transitions ───────────── */

export function TransitionsTab() {
  const doc = useApp((s) => s.doc)!
  const selection = useApp((s) => s.selection)
  const toast = useToast()
  const f = selection.length === 1 ? findClip(doc, selection[0]!) : null
  const clip = f && (f.clip.kind === 'video' || f.clip.kind === 'image') ? (f.clip as MediaClip) : null
  const next = f && clip ? nextAdjacent(f.track, clip.id) : null
  const tr = clip?.transition ?? null
  const [dur, setDur] = useCommitted(Math.round((tr?.durationUs ?? 500_000) / 1e5) / 10, (s) => { if (clip && tr) void setTransition(clip.id, tr.kind, Math.round(s * 1e6)) })
  const name = (c: MediaClip) => doc.assets[c.assetId]?.name ?? 'clip'
  const pick = async (kind: string) => {
    if (!clip) { toast({ tone: 'warning', title: 'Select a clip first', description: 'A transition goes on the cut after the clip you select.' }); return }
    if (!next) { toast({ tone: 'warning', title: 'Nothing comes right after this clip', description: 'Transitions need another clip that starts where this one ends, on the same track.' }); return }
    await setTransition(clip.id, kind, Math.round(dur * 1e6))
  }
  return (
    <div className="scroll-y flex h-full flex-col gap-3 p-3">
      {clip && next ? (
        <div className="flex flex-col gap-2 rounded-md border border-border p-2">
          <p className="truncate text-sm text-muted" title={`${name(clip)} → ${name(next)}`}>
            Cut after <span className="text-fg">{name(clip)}</span>
          </p>
          {tr ? (
            <>
              <p className="text-sm">{transitionDef(tr.kind)?.name ?? tr.kind}</p>
              <SliderField label="Duration" value={dur} onChange={setDur} min={0.1} max={Math.min(5, Math.max(0.2, Math.floor(Math.min(clip.durationUs, next.durationUs) / 1e5) / 10))} step={0.1} precision={1} unit="s" defaultValue={0.5} />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={async () => {
                  const n = await applyTransitionToAll(f!.track.id, tr.kind, tr.durationUs)
                  if (n) toast({ tone: 'success', title: `Applied to ${n} cut${n === 1 ? '' : 's'}`, description: 'Ctrl+Z undoes it.' })
                }}>Apply to all cuts</Button>
                <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => void setTransition(clip.id, null)}>Remove</Button>
              </div>
            </>
          ) : <p className="text-xs text-muted">Pick a transition below for this cut.</p>}
        </div>
      ) : (
        <p className="text-sm text-muted">
          {clip ? 'Nothing starts right where this clip ends, so there is no cut to put a transition on.' : `Select the clip before a cut, then pick a transition.${f ? '' : ` This project has ${doc.tracks.reduce((n, t) => n + cutsOn(t).length, 0)} cuts.`}`}
        </p>
      )}
      <ul aria-label="Transitions" className={grid}>
        {TRANSITIONS.map((t) => (
          <Tile key={t.kind} label={`${t.name} transition`} title={t.name} active={tr?.kind === t.kind} onClick={() => void pick(t.kind)}>
            <TransitionPreview kind={t.kind} />
          </Tile>
        ))}
      </ul>
    </div>
  )
}
