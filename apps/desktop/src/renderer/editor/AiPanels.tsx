import { useEffect, useState } from 'react'
import { Crop, Download, Trash2 } from 'lucide-react'
import { Badge, Button, Dialog, ProgressBar, Segmented, SliderField, Switch, useToast } from '@framevane/ui'
import { canvasForRatio, findClip, type Follow, type MediaClip, type ReframeRatio } from '@framevane/doc'
import type { AiModel } from '../../shared/api'
import { useApp } from '../app/store'
import { autoReframe, matteJob, removeBackground, restoreBackground } from './actions-m5'
import { useCommitted } from './Inspector'

/** M5: background removal (inspector), auto reframe (dialog), and the local model manager (settings). */

const errText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))

/** S14 · Remove BG: automatic background removal for people (video) and subjects (photos), local and free. */
export function CutoutPanel({ clip }: { clip: MediaClip }) {
  const toast = useToast()
  const ready = useApp((s) => !!s.mattes[clip.assetId])
  const job = useApp((s) => matteJob(s.jobs, clip.assetId))
  const failed = useApp((s) => Object.values(s.jobs).find((j) => j.kind === 'matte' && j.assetId === clip.assetId && j.status === 'failed'))
  const k = clip.cutout
  const [edge, setEdge] = useCommitted(Math.round((k?.edge ?? 0.3) * 100), (x) => void useApp.getState().apply([{ type: 'set_look', clipId: clip.id, cutout: { edge: x / 100 } }]))
  const start = async () => {
    try { await removeBackground([clip.id]) } catch (e) { toast({ tone: 'error', title: "The background couldn't be removed", description: errText(e) }) }
  }
  return (
    <div className="flex flex-col gap-2">
      <Switch label="Remove background" description={clip.kind === 'image' ? 'Keeps the main subject' : 'Keeps the people in the shot'} checked={!!k}
        onCheckedChange={(on) => void (on ? start() : restoreBackground([clip.id]))} />
      {k && !ready && (job
        ? <ProgressBar value={job.progress} label={job.detail ?? 'Removing background'} />
        : failed ? (
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-danger">{failed.error ?? 'It failed.'}</p>
            <Button size="sm" onClick={() => void start()}>Try again</Button>
          </div>
        ) : <Button size="sm" onClick={() => void start()}>Start</Button>)}
      {k && ready && (
        <>
          <SliderField label="Edge" value={edge} onChange={setEdge} min={0} max={100} unit="%" defaultValue={30} />
          <Switch label="Keep the background instead" checked={k.invert} onCheckedChange={(v) => void useApp.getState().apply([{ type: 'set_look', clipId: clip.id, cutout: { invert: v } }])} />
        </>
      )}
      <p className="text-xs text-muted">Runs on your computer. The first time downloads the model ({clip.kind === 'image' ? '224' : '15'} MB). Put a clip below it, or pick a background colour, to show behind.</p>
    </div>
  )
}

/* ───────────── auto reframe ───────────── */

const RATIOS: { value: ReframeRatio; label: string }[] = [{ value: '9:16', label: '9:16' }, { value: '1:1', label: '1:1' }, { value: '4:5', label: '4:5' }, { value: '16:9', label: '16:9' }]

/** Change the ratio and keep the subject in frame: every clip is scaled to fill and panned with keyframes. */
export function ReframeDialog() {
  const doc = useApp((s) => s.doc)!
  const selection = useApp((s) => s.selection)
  const toast = useToast()
  const visual = selection.filter((id) => { const c = findClip(doc, id)?.clip; return c?.kind === 'video' || c?.kind === 'image' })
  const [ratio, setRatio] = useState<ReframeRatio>(doc.canvas.width >= doc.canvas.height ? '9:16' : '16:9')
  const [follow, setFollow] = useState<Follow>('subject')
  const [scope, setScope] = useState(visual.length ? 'selected' : 'all')
  const [busy, setBusy] = useState(false)
  const close = () => useApp.getState().openDialog(null)
  const c = canvasForRatio(doc.canvas, ratio)
  const run = async () => {
    setBusy(true)
    try {
      const r = await autoReframe(ratio, follow, scope === 'selected' ? visual : undefined)
      if (r) {
        toast({ tone: 'success', title: `Reframed to ${ratio}`, description: `${follow === 'center' ? 'Clips fill the frame, centred.' : r.followed === r.clips ? (r.clips === 1 ? 'The clip follows the person.' : `All ${r.clips} clips follow a person.`) : `${r.followed} of ${r.clips} clips follow a person; the others had nobody to follow and are centred.`} Ctrl+Z undoes it.` })
        close()
      }
    } catch (e) { toast({ tone: 'error', title: "Reframing didn't work", description: errText(e) }) } finally { setBusy(false) }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && close()} busy={busy} title="Auto reframe" description="Change the shape of the video and keep the person in frame. Clips are scaled to fill and panned with keyframes you can edit." width={460}
      footer={<><Button variant="ghost" onClick={close} disabled={busy}>Cancel</Button><Button variant="primary" loading={busy} icon={<Crop className="size-3.5" />} onClick={() => void run()}>Reframe</Button></>}>
      <div className="flex flex-col gap-3">
        <Segmented label="New ratio" value={ratio} onValueChange={(v) => setRatio(v as ReframeRatio)} options={RATIOS} />
        <p className="text-sm text-muted">Canvas becomes {c.width}×{c.height}.</p>
        <Segmented label="Framing" value={follow} onValueChange={(v) => setFollow(v as Follow)} options={[{ value: 'subject', label: 'Follow the person' }, { value: 'center', label: 'Keep centred' }]} />
        <Segmented label="Clips" value={scope} onValueChange={setScope} options={[{ value: 'all', label: 'All clips' }, { value: 'selected', label: `Selected (${visual.length})`, disabled: !visual.length }]} />
        {busy && follow === 'subject' && <ProgressBar label="Following the subject" />}
      </div>
    </Dialog>
  )
}

/* ───────────── S23 · AI models ───────────── */

const mb = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`)

export function AiModels() {
  const [models, setModels] = useState<AiModel[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const jobs = useApp((s) => s.jobs)
  const toast = useToast()
  const load = () => window.framevane.ai.models().then((m) => { setModels(m); setError(null) }).catch((e) => setError(errText(e)))
  useEffect(() => { void load() }, [])
  if (error) return <p className="text-sm text-danger">The local AI isn't running: {error}</p>
  if (!models) return <ProgressBar label="Checking the local AI" />
  const downloading = Object.values(jobs).find((j) => j.title.startsWith('Downloading') && (j.status === 'running' || j.status === 'queued'))
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">These models run on your computer, free, with no account. They download once when first needed; download them now to work offline, or remove them to free space.</p>
      <ul aria-label="AI models" className="flex flex-col gap-2">
        {models.map((m) => (
          <li key={m.id} className="flex items-center gap-3 rounded-md border border-border p-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm">{m.name}</span>
                {m.ready ? <Badge tone="success">On this computer</Badge> : <Badge>Not downloaded</Badge>}
              </div>
              <p className="text-xs text-muted">{m.purpose} · {mb(m.ready ? m.onDiskBytes || m.sizeBytes : m.sizeBytes)} · {m.license}</p>
              {busy === m.id && downloading && <ProgressBar className="mt-1" value={downloading.progress} label={`Downloading ${m.name}`} />}
            </div>
            {m.ready
              ? <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} disabled={!!busy} aria-label={`Remove ${m.name}`} onClick={async () => {
                setBusy(m.id)
                try { await window.framevane.ai.removeModel(m.id); await load() } catch (e) { toast({ tone: 'error', title: "It wasn't removed", description: errText(e) }) } finally { setBusy(null) }
              }}>Remove</Button>
              : <Button size="sm" icon={<Download className="size-3.5" />} disabled={!!busy} loading={busy === m.id} aria-label={`Download ${m.name}`} onClick={async () => {
                setBusy(m.id)
                try { await window.framevane.ai.installModel(m.id); await load() } catch (e) { toast({ tone: 'error', title: "The download didn't finish", description: errText(e) }) } finally { setBusy(null) }
              }}>Download</Button>}
          </li>
        ))}
      </ul>
    </div>
  )
}
