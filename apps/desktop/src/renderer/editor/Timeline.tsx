import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type PointerEvent as RPointerEvent } from 'react'
import { ArrowLeftRight, Magnet, MousePointer2, Scissors, Trash2, ChevronsLeft, ChevronsRight, Maximize2, ZoomIn, ZoomOut } from 'lucide-react'
import { ContextMenu, IconButton, IconToggle, Ruler, SnapGuide, TimelineClip, TrackHeader, Playhead as PlayheadMark, type ClipKind } from '@reel/ui'
import { clipEnd, findClip, projectDurationUs, type Clip, type MediaClip, type OpInput, type Project, type Track } from '@reel/doc'
import { useApp } from '../app/store'
import { useEditor } from './Editor'
import { addAssetToTimeline, deleteSelection, newId, rippleDeleteSide, splitAtPlayhead } from './actions'

/** S20 · Timeline. */

const HEADER_W = 148
const RULER_H = 24
const SNAP_PX = 8
const trackH = (t: Track) => (t.main ? 56 : t.kind === 'video' ? 48 : t.kind === 'audio' ? 40 : 28)

type Drag =
  | { kind: 'scrub' }
  | { kind: 'move'; clipId: string; fromTrack: string; grabUs: number; startX: number; startY: number; moved: boolean; previewStart: number; previewTrack: string; insertIndex: number | null }
  | { kind: 'trim'; clipId: string; edge: 'l' | 'r'; startX: number; orig: Clip; previewStart: number; previewDur: number }

/** Visual order: overlays/text/captions above the main track (topmost first), audio below. */
function visualOrder(doc: Project): Track[] {
  const visual = doc.tracks.filter((t) => t.kind !== 'audio').slice().reverse()
  const audio = doc.tracks.filter((t) => t.kind === 'audio')
  return [...visual, ...audio]
}

export function Timeline() {
  const doc = useApp((s) => s.doc)!
  const pxPerSec = useApp((s) => s.pxPerSec)
  const selection = useApp((s) => s.selection)
  const magnet = useApp((s) => s.magnet)
  const snapping = useApp((s) => s.snapping)
  const media = useApp((s) => s.media)
  const { seek } = useEditor()
  const scroller = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [snapX, setSnapX] = useState<number | null>(null)
  const peaks = usePeaks(doc)

  const pxPerUs = pxPerSec / 1e6
  const durationUs = projectDurationUs(doc)
  const [viewW, setViewW] = useState(1000)
  const contentW = Math.max(viewW - HEADER_W, (durationUs / 1e6 + 30) * pxPerSec)
  const tracks = visualOrder(doc)
  const rowsH = tracks.reduce((h, t) => h + trackH(t), 0)

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const fit = useCallback(() => {
    const d = projectDurationUs(useApp.getState().doc!)
    if (d > 0) useApp.getState().setZoom(((scroller.current?.clientWidth ?? 1000) - HEADER_W - 40) / (d / 1e6))
  }, [])
  useEffect(() => {
    window.addEventListener('reel:fit-timeline', fit)
    return () => window.removeEventListener('reel:fit-timeline', fit)
  }, [fit])
  // fit once when a project opens with content
  useEffect(() => { if (durationUs > 0) fit() }, [doc.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const xToUs = (clientX: number) => {
    const el = scroller.current!
    const r = el.getBoundingClientRect()
    return Math.max(0, (clientX - r.left - HEADER_W + el.scrollLeft) / pxPerUs)
  }

  /** Snap a time to the playhead, clip edges and 0 (unless Alt is held or snapping is off). */
  const snap = (us: number, ignoreId: string | null, alt: boolean) => {
    if (!snapping || alt) return { us, x: null as number | null }
    const cands = [0, useApp.getState().playheadUs]
    for (const t of doc.tracks) for (const c of t.clips) if (c.id !== ignoreId) cands.push(c.startUs, clipEnd(c))
    let best = us
    let bestD = SNAP_PX / pxPerUs
    for (const c of cands) { const d = Math.abs(c - us); if (d < bestD) { bestD = d; best = c } }
    return { us: best, x: best !== us || cands.includes(us) ? best * pxPerUs : null }
  }

  /* ── pointer handling ── */
  const onLanePointerDown = (e: RPointerEvent, track: Track | null) => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    const clipEl = target.closest<HTMLElement>('[data-clip-id]')
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    if (!clipEl || !track) {
      if (!e.shiftKey) useApp.getState().select([])
      setDrag({ kind: 'scrub' })
      seek(xToUs(e.clientX))
      return
    }
    const clipId = clipEl.dataset.clipId!
    const f = findClip(doc, clipId)
    if (!f) return
    const sel = useApp.getState().selection
    if (e.shiftKey || e.ctrlKey) useApp.getState().select(sel.includes(clipId) ? sel.filter((x) => x !== clipId) : [...sel, clipId])
    else if (!sel.includes(clipId)) useApp.getState().select([clipId])
    if (f.track.locked) return
    const edge = target.closest<HTMLElement>('[data-edge]')?.dataset.edge as 'l' | 'r' | undefined
    if (edge) {
      setDrag({ kind: 'trim', clipId, edge, startX: e.clientX, orig: f.clip, previewStart: f.clip.startUs, previewDur: f.clip.durationUs })
    } else {
      setDrag({ kind: 'move', clipId, fromTrack: f.track.id, grabUs: xToUs(e.clientX) - f.clip.startUs, startX: e.clientX, startY: e.clientY, moved: false, previewStart: f.clip.startUs, previewTrack: f.track.id, insertIndex: null })
    }
  }

  const onPointerMove = (e: RPointerEvent) => {
    if (!drag) return
    if (drag.kind === 'scrub') { seek(xToUs(e.clientX)); return }
    if (drag.kind === 'move') {
      const moved = drag.moved || Math.abs(e.clientX - drag.startX) > 3 || Math.abs(e.clientY - drag.startY) > 3
      if (!moved) return
      const f = findClip(doc, drag.clipId)!
      const overTrack = trackAtY(e.clientY) ?? f.track
      const compatible = overTrack.kind === f.track.kind || (f.track.kind === 'video' && overTrack.kind === 'video')
      const target = compatible && !overTrack.locked ? overTrack : f.track
      let start = Math.max(0, xToUs(e.clientX) - drag.grabUs)
      let insertIndex: number | null = null
      if (target.main && magnet) {
        // magnet: drop position becomes an insertion index on the main track
        const others = target.clips.filter((c) => c.id !== drag.clipId)
        const x = xToUs(e.clientX)
        insertIndex = others.findIndex((c) => x < c.startUs + c.durationUs / 2)
        if (insertIndex < 0) insertIndex = others.length
        setSnapX((others[insertIndex]?.startUs ?? (others.length ? clipEnd(others[others.length - 1]!) : 0)) * pxPerUs)
      } else {
        const a = snap(start, drag.clipId, e.altKey)
        const b = snap(start + f.clip.durationUs, drag.clipId, e.altKey)
        if (a.x !== null && a.us !== start) start = a.us
        else if (b.x !== null && b.us !== start + f.clip.durationUs) start = b.us - f.clip.durationUs
        setSnapX(a.us === start && a.x !== null ? a.x : b.us === start + f.clip.durationUs && b.x !== null ? b.x : null)
      }
      setDrag({ ...drag, moved: true, previewStart: start, previewTrack: target.id, insertIndex })
      return
    }
    if (drag.kind === 'trim') {
      const c = drag.orig
      const dUs = (e.clientX - drag.startX) / pxPerUs
      const asset = 'assetId' in c ? doc.assets[c.assetId] : undefined
      const limited = c.kind === 'video' || c.kind === 'audio'
      const minDur = 1e6 / (doc.canvas.fps.num / doc.canvas.fps.den)
      if (drag.edge === 'r') {
        let end = clipEnd(c) + dUs
        const s = snap(end, c.id, e.altKey)
        end = s.us
        setSnapX(s.x)
        let dur = Math.max(minDur, end - c.startUs)
        if (limited && asset?.durationUs !== undefined) dur = Math.min(dur, (asset.durationUs - (c as MediaClip).inUs) / (c as MediaClip).speed)
        setDrag({ ...drag, previewDur: Math.round(dur), previewStart: c.startUs })
      } else {
        let start = c.startUs + dUs
        const s = snap(start, c.id, e.altKey)
        start = s.us
        setSnapX(s.x)
        let d = start - c.startUs
        if (limited) d = Math.max(d, -(c as MediaClip).inUs / (c as MediaClip).speed)
        d = Math.max(d, -c.startUs)
        d = Math.min(d, c.durationUs - minDur)
        setDrag({ ...drag, previewStart: Math.round(c.startUs + d), previewDur: Math.round(c.durationUs - d) })
      }
    }
  }

  const onPointerUp = () => {
    const d = drag
    setDrag(null)
    setSnapX(null)
    if (!d || d.kind === 'scrub') return
    if (d.kind === 'move' && d.moved) {
      const f = findClip(doc, d.clipId)!
      const to = doc.tracks.find((t) => t.id === d.previewTrack)!
      const ops: OpInput[] = []
      if (to.main && magnet && d.insertIndex !== null) {
        const others = to.clips.filter((c) => c.id !== d.clipId).map((c) => c.id)
        others.splice(d.insertIndex, 0, d.clipId)
        if (to.id !== f.track.id) ops.push({ type: 'move_clip', clipId: d.clipId, toTrackId: to.id, startUs: clipEnd(to.clips[to.clips.length - 1] ?? { startUs: 0, durationUs: 0 }) })
        ops.push({ type: 'pack_track', trackId: to.id, order: others })
      } else {
        ops.push({ type: 'move_clip', clipId: d.clipId, startUs: Math.round(d.previewStart), ...(to.id !== f.track.id ? { toTrackId: to.id } : {}) })
      }
      if (f.track.main && magnet && to.id !== f.track.id) ops.push({ type: 'pack_track', trackId: f.track.id })
      void useApp.getState().apply(ops).then((ok) => { if (!ok) useApp.getState().setError("Clips can't overlap on a track. Drop it on an empty spot or another track.") })
    }
    if (d.kind === 'trim') {
      const c = d.orig
      const f = findClip(doc, c.id)!
      const ripple = magnet && f.track.main
      if (d.previewStart === c.startUs && d.previewDur === c.durationUs) return
      const media = c.kind === 'video' || c.kind === 'audio' || c.kind === 'image'
      const op: OpInput = d.edge === 'r'
        ? { type: 'set_clip_timing', clipId: c.id, durationUs: d.previewDur, ripple }
        : ripple
          ? { type: 'set_clip_timing', clipId: c.id, durationUs: d.previewDur, ...(media ? { inUs: Math.round((c as MediaClip).inUs + (d.previewStart - c.startUs) * (c as MediaClip).speed) } : {}), ripple: true }
          : { type: 'set_clip_timing', clipId: c.id, startUs: d.previewStart, durationUs: d.previewDur, ...(media ? { inUs: Math.round((c as MediaClip).inUs + (d.previewStart - c.startUs) * (c as MediaClip).speed) } : {}) }
      void useApp.getState().apply([op]).then((ok) => { if (!ok) useApp.getState().setError("That trim would overlap the next clip.") })
    }
  }

  const trackAtY = (clientY: number): Track | null => {
    const el = scroller.current!
    const r = el.getBoundingClientRect()
    let y = clientY - r.top + el.scrollTop - RULER_H
    for (const t of tracks) { const h = trackH(t); if (y >= 0 && y < h) return t; y -= h }
    return null
  }

  /* ── drop from the media panel ── */
  const onDrop = (e: DragEvent) => {
    const assetId = e.dataTransfer.getData('application/x-reel-asset')
    if (!assetId) return
    e.preventDefault()
    const at = xToUs(e.clientX)
    const over = trackAtY(e.clientY)
    if ((!over || over.main) && magnet) {
      const main = doc.tracks.find((t) => t.main)!
      const idx = main.clips.findIndex((c) => at < c.startUs + c.durationUs / 2)
      void addAssetToTimeline(assetId).then(() => {
        if (idx < 0) return
        const d = useApp.getState().doc!
        const m = d.tracks.find((t) => t.main)!
        const ids = m.clips.map((c) => c.id)
        const added = ids.pop()!
        ids.splice(idx, 0, added)
        void useApp.getState().apply([{ type: 'pack_track', trackId: m.id, order: ids }])
      })
    } else {
      void addAssetToTimeline(assetId, Math.round(snap(at, null, e.altKey).us))
    }
  }

  /* ── keep the playhead in view while playing ── */
  useEffect(() => useApp.subscribe((s, prev) => {
    if (!s.playing || s.playheadUs === prev.playheadUs) return
    const el = scroller.current
    if (!el) return
    const x = s.playheadUs * (s.pxPerSec / 1e6)
    if (x > el.scrollLeft + el.clientWidth - HEADER_W - 60 || x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 80)
  }), [])

  const preview = (c: Clip, track: Track): { start: number; dur: number; trackId: string } => {
    if (drag?.kind === 'trim' && drag.clipId === c.id) return { start: drag.previewStart, dur: drag.previewDur, trackId: track.id }
    if (drag?.kind === 'move' && drag.moved && drag.clipId === c.id) return { start: drag.previewStart, dur: c.durationUs, trackId: drag.previewTrack }
    return { start: c.startUs, dur: c.durationUs, trackId: track.id }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar onFit={fit} />
      <div
        ref={scroller}
        role="grid"
        aria-label="Timeline tracks"
        className="relative min-h-0 flex-1 overflow-auto"
        onWheel={(e) => { if (e.ctrlKey) { e.preventDefault(); useApp.getState().setZoom(pxPerSec * (e.deltaY < 0 ? 1.15 : 1 / 1.15)) } }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-reel-asset')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' } }}
        onDrop={onDrop}
      >
        <div style={{ width: HEADER_W + contentW }} className="relative">
          {/* ruler */}
          <div className="sticky top-0 z-[var(--reel-z-timeline-overlay)] flex" style={{ height: RULER_H }}>
            <div className="sticky left-0 z-[calc(var(--reel-z-timeline-overlay)+2)] shrink-0 border-r border-b border-border bg-surface" style={{ width: HEADER_W }} />
            <div className="cursor-pointer border-b border-border" onPointerDown={(e) => onLanePointerDown(e, null)}>
              <Ruler width={contentW} pxPerSec={pxPerSec} markers={doc.markers.map((m) => ({ at: m.atUs / 1e6, color: m.color, label: m.label }))} />
            </div>
          </div>
          {/* tracks */}
          {tracks.map((track) => (
            <div key={track.id} role="row" className="flex" style={{ height: trackH(track) }}>
              <div className="sticky left-0 z-[calc(var(--reel-z-timeline-overlay)+1)] border-r border-border">
                <TrackHeader
                  name={track.name} kind={(track.kind === 'caption' ? 'caption' : track.kind) as ClipKind} height={trackH(track)} main={track.main}
                  locked={track.locked} onLocked={(v) => void useApp.getState().apply([{ type: 'set_track_flags', trackId: track.id, locked: v }])}
                  hidden={track.kind !== 'audio' ? track.hidden : undefined} onHidden={track.kind !== 'audio' ? (v) => void useApp.getState().apply([{ type: 'set_track_flags', trackId: track.id, hidden: v }]) : undefined}
                  muted={track.kind === 'audio' || track.kind === 'video' ? track.muted : undefined} onMuted={track.kind === 'audio' || track.kind === 'video' ? (v) => void useApp.getState().apply([{ type: 'set_track_flags', trackId: track.id, muted: v }]) : undefined}
                />
              </div>
              <div className={`relative border-b border-border ${track.main ? 'bg-surface/40' : ''}`} style={{ width: contentW }} onPointerDown={(e) => onLanePointerDown(e, track)}>
                {track.main && track.clips.length === 0 && (
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted">Drag media here, or press + on a clip in the media panel</span>
                )}
                {track.clips.map((c) => {
                  const p = preview(c, track)
                  if (p.trackId !== track.id) return null
                  return <ClipView key={c.id} doc={doc} clip={c} track={track} start={p.start} dur={p.dur} pxPerUs={pxPerUs} selected={selection.includes(c.id)} peaks={peaks} mediaReady={media} />
                })}
                {/* a clip dragged onto this track from another one */}
                {drag?.kind === 'move' && drag.moved && drag.previewTrack === track.id && drag.fromTrack !== track.id && (() => {
                  const f = findClip(doc, drag.clipId)
                  return f ? <ClipView doc={doc} clip={f.clip} track={track} start={drag.previewStart} dur={f.clip.durationUs} pxPerUs={pxPerUs} selected peaks={peaks} mediaReady={media} /> : null
                })()}
              </div>
            </div>
          ))}
          <div className="pointer-events-none absolute top-0" style={{ left: HEADER_W, height: RULER_H + rowsH }}>
            {snapX !== null && <SnapGuide x={snapX} height={RULER_H + rowsH} />}
            <TimelinePlayhead pxPerUs={pxPerUs} height={RULER_H + rowsH} />
          </div>
        </div>
      </div>
    </div>
  )
}

function TimelinePlayhead({ pxPerUs, height }: { pxPerUs: number; height: number }) {
  const us = useApp((s) => s.playheadUs)
  return <PlayheadMark x={us * pxPerUs} height={height} />
}

function ClipView({ doc, clip, track, start, dur, pxPerUs, selected, peaks, mediaReady }: { doc: Project; clip: Clip; track: Track; start: number; dur: number; pxPerUs: number; selected: boolean; peaks: Map<string, Uint8Array>; mediaReady: unknown }) {
  const width = Math.max(4, dur * pxPerUs)
  const h = trackH(track)
  const media = clip.kind === 'video' || clip.kind === 'audio' || clip.kind === 'image' ? (clip as MediaClip) : null
  const asset = media ? doc.assets[media.assetId] : undefined
  const label = clip.kind === 'caption' || clip.kind === 'text' ? clip.text : asset?.name ?? 'Missing media'
  // filmstrip: the sprite spans the whole asset; position it so the clip shows its own source range
  let stripStyle: CSSProperties | undefined
  const info = (mediaReady as { asset: { id: string }; status: string; urls: { filmstrip: string | null; thumb: string | null } }[]).find((m) => m.asset.id === asset?.id)
  if (media && media.kind === 'video' && asset?.durationUs && info?.urls.filmstrip) {
    const assetW = (asset.durationUs / media.speed) * pxPerUs
    stripStyle = { backgroundImage: `url("${info.urls.filmstrip}")`, backgroundSize: `${assetW}px 100%`, backgroundPositionX: `${-(media.inUs / media.speed) * pxPerUs}px`, backgroundRepeat: 'no-repeat' }
  } else if (media && media.kind === 'image' && asset && info?.urls.thumb) {
    stripStyle = { backgroundImage: `url("reel-media://thumb/${asset.id}")`, backgroundSize: 'auto 100%', backgroundRepeat: 'repeat-x' }
  }
  let waveform: number[] | undefined
  const p = media && asset?.hasAudio ? peaks.get(asset.id) : undefined
  if (p && media) {
    const a = Math.floor((media.inUs / 1e6) * 100)
    const b = Math.min(p.length, Math.ceil(((media.inUs + dur * media.speed) / 1e6) * 100))
    waveform = Array.from(p.subarray(a, Math.max(a + 1, b)), (v) => v / 255)
  }
  const items = [
    { label: 'Split at playhead', shortcut: 'Ctrl+B', icon: <Scissors />, onSelect: splitAtPlayhead },
    { label: 'Delete', shortcut: 'Del', icon: <Trash2 />, danger: true, separatorBefore: true, onSelect: deleteSelection },
  ]
  return (
    <ContextMenu items={items}>
      <div data-clip-id={clip.id} className="absolute top-0.5" style={{ left: start * pxPerUs, width }}>
        <TimelineClip
          kind={(clip.kind === 'caption' ? 'caption' : clip.kind) as ClipKind}
          label={label}
          width={width}
          height={h - 4}
          selected={selected}
          disabled={!clip.enabled}
          missing={!!media && (!asset || info?.status === 'missing')}
          stripStyle={stripStyle}
          waveform={waveform}
          speedLabel={media && media.speed !== 1 ? `${+media.speed.toFixed(2)}×` : undefined}
        />
        <span data-edge="l" className="absolute inset-y-0 left-0 w-2 cursor-ew-resize" aria-hidden />
        <span data-edge="r" className="absolute inset-y-0 right-0 w-2 cursor-ew-resize" aria-hidden />
      </div>
    </ContextMenu>
  )
}

function Toolbar({ onFit }: { onFit: () => void }) {
  const magnet = useApp((s) => s.magnet)
  const snapping = useApp((s) => s.snapping)
  const pxPerSec = useApp((s) => s.pxPerSec)
  const hasSel = useApp((s) => s.selection.length > 0)
  return (
    <div role="toolbar" aria-label="Timeline tools" className="flex h-[var(--reel-toolbar-h)] shrink-0 items-center gap-0.5 border-b border-border bg-surface px-2">
      <IconButton label="Select" shortcut="A" icon={<MousePointer2 />} className="bg-surface-3 text-fg" />
      <span className="mx-1 h-4 w-px bg-border" />
      <IconButton label="Split at playhead" shortcut="Ctrl+B" icon={<Scissors />} onClick={splitAtPlayhead} />
      <IconButton label="Delete left of playhead" shortcut="Q" icon={<ChevronsLeft />} onClick={() => rippleDeleteSide('left')} />
      <IconButton label="Delete right of playhead" shortcut="W" icon={<ChevronsRight />} onClick={() => rippleDeleteSide('right')} />
      <IconButton label="Delete selected" shortcut="Del" icon={<Trash2 />} onClick={deleteSelection} disabled={!hasSel} />
      <div className="flex-1" />
      <IconToggle label="Main track magnet" shortcut="P" icon={<Magnet />} pressed={magnet} onPressedChange={(v) => useApp.setState({ magnet: v })} />
      <IconToggle label="Snapping" shortcut="N" icon={<ArrowLeftRight />} pressed={snapping} onPressedChange={(v) => useApp.setState({ snapping: v })} />
      <span className="mx-1 h-4 w-px bg-border" />
      <IconButton label="Zoom out" shortcut="Ctrl+-" icon={<ZoomOut />} onClick={() => useApp.getState().setZoom(pxPerSec / 1.25)} />
      <input type="range" aria-label="Timeline zoom" min={Math.log(2)} max={Math.log(600)} step={0.01} value={Math.log(pxPerSec)} onChange={(e) => useApp.getState().setZoom(Math.exp(Number(e.target.value)))} className="w-28 accent-[var(--reel-color-accent)]" />
      <IconButton label="Zoom in" shortcut="Ctrl+=" icon={<ZoomIn />} onClick={() => useApp.getState().setZoom(pxPerSec * 1.25)} />
      <IconButton label="Fit to window" shortcut="Shift+Z" icon={<Maximize2 />} onClick={onFit} />
    </div>
  )
}

/** Waveform peaks per asset (100 per second, 0–255), fetched once. */
function usePeaks(doc: Project) {
  const [peaks, setPeaks] = useState(new Map<string, Uint8Array>())
  const media = useApp((s) => s.media)
  const wanted = useMemo(() => [...new Set(doc.tracks.flatMap((t) => t.clips.flatMap((c) => ('assetId' in c && doc.assets[c.assetId]?.hasAudio ? [c.assetId] : []))))], [doc])
  useEffect(() => {
    let alive = true
    for (const id of wanted) {
      if (peaks.has(id)) continue
      const m = media.find((x) => x.asset.id === id)
      if (!m?.urls.peaks) continue
      void fetch(m.urls.peaks).then((r) => (r.ok ? r.arrayBuffer() : null)).then((b) => {
        if (b && alive) setPeaks((p) => new Map(p).set(id, new Uint8Array(b)))
      })
    }
    return () => { alive = false }
  }, [wanted, media]) // eslint-disable-line react-hooks/exhaustive-deps
  return peaks
}

export { newId }
