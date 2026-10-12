import { useRef, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { Button, Dialog, JobProgress, Select, TextField, useToast } from '@reel/ui'
import { formatUs, projectDurationUs } from '@reel/doc'
import { useApp } from '../app/store'
import { exportProject, type ExportProgress } from '../engine/export'

const RESOLUTIONS = [
  { value: '720', label: '720p' },
  { value: '1080', label: '1080p' },
  { value: '1440', label: '2K (1440p)' },
  { value: '2160', label: '4K (2160p)' },
]
const BITRATE_PER_PIXEL = { low: 0.07, recommended: 0.12, high: 0.2 }

/** S22 · Export. Everything is free: 4K, 60 fps, no watermark, no end card. */
export function ExportDialog() {
  const doc = useApp((s) => s.doc)!
  const [name, setName] = useState(doc.name.replace(/[\\/:*?"<>|]+/g, '').trim() || 'export')
  const [res, setRes] = useState(String(Math.min(2160, closest(doc.canvas.height, doc.canvas.width))))
  const [fps, setFps] = useState(String(Math.round(doc.canvas.fps.num / doc.canvas.fps.den)))
  const [quality, setQuality] = useState<keyof typeof BITRATE_PER_PIXEL>('recommended')
  const [codec, setCodec] = useState<'avc' | 'hevc'>('avc')
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)
  const toast = useToast()
  const busy = !!progress && !error
  const close = () => { if (!busy) useApp.getState().openDialog(null) }

  // keep the project's aspect ratio; resolution = the short side
  const short = Number(res)
  const portrait = doc.canvas.height > doc.canvas.width
  const ar = doc.canvas.width / doc.canvas.height
  const W = even(portrait ? short : short * ar)
  const H = even(portrait ? short / ar : short)
  const bitrate = Math.round(W * H * Number(fps) * BITRATE_PER_PIXEL[quality])
  const sizeMb = (bitrate / 8 / 1e6) * (projectDurationUs(doc) / 1e6)

  async function start() {
    const outputPath = await window.reel.app.pickSavePath({ defaultName: name, ext: 'mp4' })
    if (!outputPath) return
    setError(null)
    abort.current = new AbortController()
    setProgress({ phase: 'audio', progress: 0, frame: 0, frames: 0, fps: 0, etaSeconds: null })
    try {
      const r = await exportProject(doc, { projectId: doc.id, outputPath, width: W, height: H, fps: Number(fps), bitrate, codec }, setProgress, abort.current.signal)
      setProgress(null)
      useApp.getState().openDialog(null)
      toast({ tone: 'success', title: 'Export finished', description: `${r.path.split(/[\\/]/).pop()} · ${(r.bytes / 1e6).toFixed(1)} MB`, action: { label: 'Show file', onClick: () => void window.reel.app.showItemInFolder(r.path) } })
    } catch (e) {
      if ((e as Error).name === 'AbortError') { setProgress(null); return }
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && close()} title="Export video" description="Rendered with the same engine as the preview, on your GPU." busy={busy} width={480}
      footer={busy
        ? <Button variant="secondary" onClick={() => abort.current?.abort()}>Cancel export</Button>
        : <><Button variant="ghost" onClick={close}>Close</Button><Button variant="primary" icon={<FolderOpen className="size-3.5" />} onClick={() => void start()}>Export…</Button></>}>
      <div className="flex flex-col gap-3">
        <TextField label="File name" value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Resolution" value={res} onValueChange={setRes} options={RESOLUTIONS} disabled={busy} width={130} />
          <Select label="Frame rate" value={fps} onValueChange={setFps} options={['24', '25', '30', '50', '60'].map((v) => ({ value: v, label: `${v} fps` }))} disabled={busy} width={100} />
          <Select label="Quality" value={quality} onValueChange={(v) => setQuality(v as typeof quality)} options={[{ value: 'low', label: 'Smaller file' }, { value: 'recommended', label: 'Recommended' }, { value: 'high', label: 'Higher' }]} disabled={busy} width={130} />
          <Select label="Codec" value={codec} onValueChange={(v) => setCodec(v as typeof codec)} options={[{ value: 'avc', label: 'H.264' }, { value: 'hevc', label: 'HEVC (H.265)' }]} disabled={busy} width={100} />
        </div>
        <p className="text-sm text-muted">{W}×{H} · {(bitrate / 1e6).toFixed(1)} Mbps · about {sizeMb < 1 ? '<1' : sizeMb.toFixed(0)} MB · {formatUs(projectDurationUs(doc))} · MP4, no watermark</p>
        {progress && !error && (
          <JobProgress
            title={progress.phase === 'audio' ? 'Mixing audio' : progress.phase === 'finalizing' ? 'Finishing the file' : `Rendering frame ${progress.frame} of ${progress.frames}`}
            value={progress.phase === 'video' ? progress.progress : undefined}
            detail={progress.phase === 'video' ? `${progress.fps.toFixed(0)} fps · ${progress.etaSeconds !== null ? `${Math.ceil(progress.etaSeconds)} s left` : ''}` : undefined}
          />
        )}
        {error && <p role="alert" className="text-sm text-danger">Export failed: {error}</p>}
      </div>
    </Dialog>
  )
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)
function closest(h: number, w: number) {
  const s = Math.min(h, w)
  return [720, 1080, 1440, 2160].reduce((a, b) => (Math.abs(b - s) < Math.abs(a - s) ? b : a))
}
