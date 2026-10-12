import { useEffect, useRef, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { Button, Dialog, JobProgress, NumberField, Segmented, Select, TextField, useToast } from '@framevane/ui'
import { clipEnd, findClip, formatUs, projectDurationUs } from '@framevane/doc'
import type { ExportFormat, VideoCodecId } from '../../shared/api'
import { useApp } from '../app/store'
import { bitrateFor, CODEC_LABEL, CONTAINER_CODECS, encodableCodecs, outputSize, runExport, type ExportProgress } from '../engine/export'

const FORMATS: { value: ExportFormat; label: string }[] = [
  { value: 'mp4', label: 'Video · MP4' },
  { value: 'mov', label: 'Video · MOV' },
  { value: 'webm', label: 'Video · WebM' },
  { value: 'gif', label: 'Animated GIF' },
  { value: 'mp3', label: 'Audio only · MP3' },
  { value: 'm4a', label: 'Audio only · M4A (AAC)' },
  { value: 'wav', label: 'Audio only · WAV' },
  { value: 'png', label: 'This frame · PNG' },
  { value: 'jpg', label: 'This frame · JPG' },
]
const RESOLUTIONS = [
  { value: '720', label: '720p' },
  { value: '1080', label: '1080p' },
  { value: '1440', label: '2K (1440p)' },
  { value: '2160', label: '4K (2160p)' },
]
const kindOf = (f: ExportFormat) => (f === 'gif' ? 'gif' : f === 'wav' || f === 'mp3' || f === 'm4a' ? 'audio' : f === 'png' || f === 'jpg' ? 'image' : 'video')

/** S22 · Export. Everything is free: 4K, 60 fps, every codec the PC can encode, no watermark, no end card. */
export function ExportDialog() {
  const doc = useApp((s) => s.doc)!
  const selection = useApp((s) => s.selection)
  const playheadUs = useApp((s) => s.playheadUs)
  const [name, setName] = useState(doc.name.replace(/[\\/:*?"<>|]+/g, '').trim() || 'export')
  const [format, setFormat] = useState<ExportFormat>('mp4')
  const [res, setRes] = useState(String(Math.min(2160, closest(doc.canvas.height, doc.canvas.width))))
  const [fps, setFps] = useState(String(Math.round(doc.canvas.fps.num / doc.canvas.fps.den)))
  const [quality, setQuality] = useState<'low' | 'recommended' | 'high' | 'custom'>('recommended')
  const [mbps, setMbps] = useState(12)
  const [codec, setCodec] = useState<VideoCodecId>('avc')
  const [gifWidth, setGifWidth] = useState('480')
  const [gifFps, setGifFps] = useState('15')
  const [rangeMode, setRangeMode] = useState<'all' | 'selection' | 'custom'>('all')
  const total = projectDurationUs(doc)
  const [from, setFrom] = useState(0)
  const [to, setTo] = useState(Math.round(total / 1e5) / 10)
  const [available, setAvailable] = useState<Set<VideoCodecId> | null>(null)
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)
  const toast = useToast()
  const busy = !!progress && !error
  const close = () => { if (!busy) useApp.getState().openDialog(null) }
  const kind = kindOf(format)

  const { width: W, height: H } = outputSize(doc, Number(res))
  useEffect(() => { void encodableCodecs(W, H, 8e6).then(setAvailable) }, [W, H])
  const codecs = kind === 'video' ? CONTAINER_CODECS[format as 'mp4' | 'mov' | 'webm'] : []
  // keep the codec valid for the container and this PC
  useEffect(() => {
    if (kind !== 'video') return
    if (!codecs.includes(codec) || (available && !available.has(codec))) setCodec(codecs.find((c) => !available || available.has(c)) ?? codecs[0]!)
  }, [format, available]) // eslint-disable-line react-hooks/exhaustive-deps

  const sel = selection.map((id) => findClip(doc, id)?.clip).filter((c): c is NonNullable<typeof c> => !!c)
  const range = rangeMode === 'all' ? undefined
    : rangeMode === 'selection' ? (sel.length ? { startUs: Math.min(...sel.map((c) => c.startUs)), endUs: Math.max(...sel.map(clipEnd)) } : undefined)
    : { startUs: Math.round(from * 1e6), endUs: Math.round(to * 1e6) }
  const spanUs = range ? Math.max(0, range.endUs - range.startUs) : total
  const bitrate = bitrateFor(W, H, Number(fps), codec, quality === 'custom' ? 'recommended' : quality, quality === 'custom' ? mbps : undefined)
  const sizeMb = kind === 'video' ? (bitrate / 8 / 1e6) * (spanUs / 1e6) : kind === 'audio' ? (format === 'wav' ? 0.192 : 0.024) * (spanUs / 1e6) : 0
  const rangeBad = rangeMode === 'custom' ? !(to > from && from >= 0) : rangeMode === 'selection' && !sel.length

  async function start() {
    const outputPath = await window.framevane.app.pickSavePath({ defaultName: name, ext: format })
    if (!outputPath) return
    setError(null)
    abort.current = new AbortController()
    setProgress({ phase: kind === 'image' ? 'finalizing' : 'audio', progress: 0, frame: 0, frames: 0, fps: 0, etaSeconds: null })
    try {
      const r = await runExport(doc, {
        outputPath, format, fps: kind === 'gif' ? Number(gifFps) : Number(fps), height: kind === 'gif' ? Number(gifWidth) : Number(res),
        codec, ...(quality === 'custom' ? { bitrateMbps: mbps } : { quality }), ...(range && kind !== 'image' ? { range } : {}), atUs: playheadUs,
      }, setProgress, abort.current.signal, (id) => !!useApp.getState().mattes[id])
      setProgress(null)
      useApp.getState().openDialog(null)
      toast({ tone: 'success', title: kind === 'image' ? 'Frame saved' : kind === 'audio' ? 'Your audio is ready' : 'Your video is ready', description: `${r.path.split(/[\\/]/).pop()} · ${(r.bytes / 1e6).toFixed(1)} MB`, action: { label: 'Show file', onClick: () => void window.framevane.app.showItemInFolder(r.path) } })
    } catch (e) {
      if ((e as Error).name === 'AbortError') { setProgress(null); return }
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && close()} title="Export" description="Exactly what the preview shows, rendered on your GPU. Never a watermark." busy={busy} width={520}
      footer={busy
        ? <Button variant="secondary" onClick={() => abort.current?.abort()} disabled={kind === 'image' || kind === 'audio'}>Cancel export</Button>
        : <><Button variant="ghost" onClick={close}>Close</Button><Button variant="primary" icon={<FolderOpen className="size-3.5" />} disabled={rangeBad} onClick={() => void start()}>Export…</Button></>}>
      <div className="flex flex-col gap-3">
        <TextField label="File name" value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
        <Select label="Format" value={format} onValueChange={(v) => setFormat(v as ExportFormat)} options={FORMATS} disabled={busy} width={260} />
        {(kind === 'video' || kind === 'image') && (
          <div className="grid grid-cols-2 gap-3">
            <Select label="Resolution" value={res} onValueChange={setRes} options={RESOLUTIONS} disabled={busy} width={130} />
            {kind === 'video' && <Select label="Frame rate" value={fps} onValueChange={setFps} options={['24', '25', '30', '50', '60'].map((v) => ({ value: v, label: `${v} fps` }))} disabled={busy} width={100} />}
            {kind === 'video' && (
              <Select label="Codec" value={codec} onValueChange={(v) => setCodec(v as VideoCodecId)} disabled={busy} width={150}
                options={codecs.map((c) => ({ value: c, label: CODEC_LABEL[c], disabled: !!available && !available.has(c), hint: available && !available.has(c) ? 'not on this PC' : undefined }))} />
            )}
            {kind === 'video' && (
              <Select label="Quality" value={quality} onValueChange={(v) => setQuality(v as typeof quality)} disabled={busy} width={130}
                options={[{ value: 'low', label: 'Smaller file' }, { value: 'recommended', label: 'Recommended' }, { value: 'high', label: 'Higher' }, { value: 'custom', label: 'Custom bitrate' }]} />
            )}
            {kind === 'video' && quality === 'custom' && (
              <label className="flex items-center gap-2 text-sm">Bitrate <NumberField ariaLabel="Bitrate" value={mbps} onChange={setMbps} min={0.5} max={200} step={0.5} precision={1} unit="Mbps" width={110} /></label>
            )}
          </div>
        )}
        {kind === 'gif' && (
          <div className="grid grid-cols-2 gap-3">
            <Select label="Width" value={gifWidth} onValueChange={setGifWidth} options={['360', '480', '720'].map((v) => ({ value: v, label: `${v} px` }))} disabled={busy} width={110} />
            <Select label="Frame rate" value={gifFps} onValueChange={setGifFps} options={['10', '15', '20', '25'].map((v) => ({ value: v, label: `${v} fps` }))} disabled={busy} width={100} />
          </div>
        )}
        {kind !== 'image' ? (
          <div className="flex flex-col gap-2">
            <Segmented label="What to export" value={rangeMode} onValueChange={(v) => setRangeMode(v as typeof rangeMode)}
              options={[{ value: 'all', label: 'Whole video' }, { value: 'selection', label: 'Selected clips', disabled: !sel.length }, { value: 'custom', label: 'From… to…' }]} />
            {rangeMode === 'custom' && (
              <div className="flex items-center gap-3 text-sm">
                <label className="flex items-center gap-2">From <NumberField ariaLabel="From" value={from} onChange={setFrom} min={0} max={total / 1e6} step={0.1} precision={1} unit="s" width={96} /></label>
                <label className="flex items-center gap-2">to <NumberField ariaLabel="To" value={to} onChange={setTo} min={0} max={total / 1e6} step={0.1} precision={1} unit="s" width={96} /></label>
              </div>
            )}
          </div>
        ) : <p className="text-sm">The frame at the playhead ({formatUs(playheadUs)}).</p>}
        <p className="text-sm text-muted">
          {kind === 'video' && `${W}×${H} · ${CODEC_LABEL[codec]} · ${(bitrate / 1e6).toFixed(1)} Mbps · about ${sizeMb < 1 ? '<1' : sizeMb.toFixed(0)} MB · `}
          {kind === 'audio' && `48 kHz stereo · about ${sizeMb < 1 ? '<1' : sizeMb.toFixed(0)} MB · `}
          {kind === 'image' ? `${W}×${H}` : `${formatUs(spanUs)} · no watermark`}
        </p>
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

function closest(h: number, w: number) {
  const s = Math.min(h, w)
  return [720, 1080, 1440, 2160].reduce((a, b) => (Math.abs(b - s) < Math.abs(a - s) ? b : a))
}
