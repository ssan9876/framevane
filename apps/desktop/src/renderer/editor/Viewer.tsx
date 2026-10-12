import { useCallback, useEffect, useRef, useState } from 'react'
import { Pause, Play, SkipBack, SkipForward, Maximize } from 'lucide-react'
import { IconButton, Select } from '@reel/ui'
import { projectDurationUs } from '@reel/doc'
import { useApp } from '../app/store'
import { useEditor } from './Editor'
import { frameUs } from './actions'

/** S13 · Player: the project canvas fitted into the panel, transport controls and timecode. */
export function Viewer() {
  const doc = useApp((s) => s.doc)!
  const playheadUs = useApp((s) => s.playheadUs)
  const playing = useApp((s) => s.playing)
  const { player, seek, togglePlay } = useEditor()
  const box = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [quality, setQuality] = useState('full')
  const [size, setSize] = useState({ w: 0, h: 0 })

  // fit the canvas into the panel at the project aspect ratio
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      const ar = doc.canvas.width / doc.canvas.height
      const w = Math.max(16, Math.min(r.width - 24, (r.height - 24) * ar))
      setSize({ w, h: w / ar })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [doc.canvas.width, doc.canvas.height])

  const scale = quality === 'full' ? devicePixelRatio : quality === 'half' ? 0.5 : 0.25
  const pw = Math.max(2, Math.round(Math.min(doc.canvas.width, size.w * scale)))
  const ph = Math.max(2, Math.round((pw * doc.canvas.height) / doc.canvas.width))
  // the canvas mounts only once the timeline has content, so attach on mount (callback ref) and redraw on resize
  const setCanvas = useCallback((el: HTMLCanvasElement | null) => { canvasRef.current = el; player.attach(el) }, [player])
  useEffect(() => { if (canvasRef.current) player.attach(canvasRef.current) }, [player, pw, ph])

  const dur = projectDurationUs(doc)
  const empty = dur === 0
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={box} className="relative grid min-h-0 flex-1 place-items-center overflow-hidden">
        {empty ? (
          <p className="text-sm text-muted">Add media to the timeline to see it here.</p>
        ) : (
          <canvas ref={setCanvas} width={pw} height={ph} style={{ width: size.w, height: size.h }} className="bg-scrim shadow-card" aria-label={`Preview at ${tc(playheadUs, doc)}`} role="img" onClick={togglePlay} />
        )}
      </div>
      <div className="flex h-10 shrink-0 items-center gap-2 border-t border-border px-3">
        <span className="font-mono text-xs tabular-nums">
          <span className="text-fg">{tc(playheadUs, doc)}</span>
          <span className="text-muted"> / {tc(dur, doc)}</span>
        </span>
        <div className="flex flex-1 items-center justify-center gap-1">
          <IconButton size="sm" label="Previous frame" shortcut="←" icon={<SkipBack />} onClick={() => seek(playheadUs - frameUs(doc))} />
          <IconButton label={playing ? 'Pause' : 'Play'} shortcut="Space" icon={playing ? <Pause /> : <Play />} onClick={togglePlay} disabled={empty} className="text-fg" />
          <IconButton size="sm" label="Next frame" shortcut="→" icon={<SkipForward />} onClick={() => seek(playheadUs + frameUs(doc))} />
        </div>
        <Select label="Preview quality" hideLabel width={96} value={quality} onValueChange={setQuality}
          options={[{ value: 'full', label: 'Full' }, { value: 'half', label: 'Half' }, { value: 'quarter', label: 'Quarter' }]} />
        <span className="text-xs text-muted">{doc.canvas.width}×{doc.canvas.height}</span>
        <IconButton size="sm" label="Fullscreen preview" icon={<Maximize />} onClick={() => void canvasRef.current?.requestFullscreen()} disabled={empty} />
      </div>
    </div>
  )
}

export function tc(us: number, doc: { canvas: { fps: { num: number; den: number } } }) {
  const fps = doc.canvas.fps.num / doc.canvas.fps.den
  const totalFrames = Math.floor((us / 1e6) * fps + 1e-6)
  const f = totalFrames % Math.round(fps)
  const s = Math.floor(us / 1e6)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}:${pad(f)}`
}
