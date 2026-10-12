import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Checkbox, Dialog, OpRow, useToast } from '@reel/ui'
import { formatUs, projectDurationUs, type Project } from '@reel/doc'
import { useApp } from '../app/store'
import { Player } from '../engine/player'

/** S29 · Review the agent's proposed edits: include/exclude each one, preview the result, apply or discard. */
export function ReviewDialog() {
  const runId = useApp((s) => s.reviewRunId)
  const run = useApp((s) => s.agentRuns.find((r) => r.runId === s.reviewRunId))
  const doc = useApp((s) => s.doc)!
  const ops = run?.proposal?.ops ?? []
  const [included, setIncluded] = useState(() => new Set(ops.map((o) => o.id)))
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<Project | null>(null)
  const toast = useToast()
  const close = () => useApp.getState().openDialog(null)

  useEffect(() => {
    if (!runId) return
    let alive = true
    void window.reel.agent.previewDoc(runId, [...included]).then((d) => alive && setPreview(d))
    return () => { alive = false }
  }, [runId, included])

  const all = included.size === ops.length ? true : included.size === 0 ? false : 'indeterminate'
  const before = projectDurationUs(doc)
  const after = preview ? projectDurationUs(preview) : before

  async function apply() {
    if (!runId) return
    setBusy(true)
    const r = await window.reel.agent.review(runId, [...included], 'apply')
    setBusy(false)
    if (r.ok) {
      toast({ tone: 'success', title: `Applied ${r.applied} edit${r.applied === 1 ? '' : 's'}`, description: r.conflicted ? `${r.conflicted} no longer fit the timeline and were skipped.` : 'Undo with Ctrl+Z.', action: { label: 'Undo', onClick: () => void window.reel.doc.undo(doc.id) } })
      close()
    } else {
      toast({ tone: 'warning', title: "The edits weren't applied", description: r.message })
    }
  }

  if (!run?.proposal) return null
  return (
    <Dialog open onOpenChange={(o) => !o && close()} title="Review the agent's edits" description={`${run.proposal.summary}. Untick anything you don't want.`} width={880} busy={busy}
      footer={<>
        <Button variant="ghost" onClick={async () => { await window.reel.agent.review(run.runId, [], 'reject'); close() }}>Discard all</Button>
        <Button variant="primary" loading={busy} disabled={included.size === 0} onClick={() => void apply()}>Apply {included.size} edit{included.size === 1 ? '' : 's'}</Button>
      </>}>
      <div className="grid grid-cols-[1fr_340px] gap-4">
        <div className="flex min-h-0 flex-col gap-2">
          <div className="flex items-center justify-between">
            <Checkbox label="Include all" checked={all} onCheckedChange={(v) => setIncluded(new Set(v ? ops.map((o) => o.id) : []))} />
            <span className="text-sm text-muted">Length {formatUs(before)} → <span className="text-fg">{formatUs(after)}</span></span>
          </div>
          <ul aria-label="Proposed edits" className="max-h-[420px] overflow-y-auto rounded-md border border-border">
            {ops.map((o) => (
              <OpRow key={o.id} label={o.label} target={targetOf(o.op)} time={timeOf(o.op)} status={o.status} included={included.has(o.id)}
                onIncludedChange={(v) => setIncluded((s) => { const n = new Set(s); if (v) n.add(o.id); else n.delete(o.id); return n })} />
            ))}
          </ul>
          <p className="text-xs text-muted">Cuts are listed latest-first so each one stays valid if you skip another. Captions were made after the cuts, so skipping a cut can shift them.</p>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-sm text-muted">Preview with the selected edits</span>
          {preview ? <MiniPreview doc={preview} /> : <div className="aspect-video rounded-md bg-surface-2" />}
        </div>
      </div>
    </Dialog>
  )
}

function MiniPreview({ doc }: { doc: Project }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(false)
  const player = useMemo(() => new Player(doc, (us) => setT(us), () => setPlaying(false)), []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { player.setDoc(doc) }, [doc, player])
  useEffect(() => { player.attach(canvas.current); return () => { void player.dispose() } }, [player])
  const dur = projectDurationUs(doc)
  const w = 340
  const h = Math.round((w * doc.canvas.height) / doc.canvas.width)
  return (
    <div className="flex flex-col gap-2">
      <canvas ref={canvas} width={w * 2} height={h * 2} style={{ width: w, height: h }} className="rounded-md bg-scrim" />
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => { if (playing) { player.pause(); setPlaying(false) } else { void player.play(t); setPlaying(true) } }}>{playing ? 'Pause' : 'Play'}</Button>
        <input type="range" aria-label="Preview position" min={0} max={dur} value={t} onChange={(e) => { const v = Number(e.target.value); setT(v); player.seek(v) }} className="flex-1 accent-[var(--reel-color-agent)]" />
        <span className="font-mono text-xs text-muted">{formatUs(t)}</span>
      </div>
    </div>
  )
}

function targetOf(op: { type: string } & Record<string, unknown>) {
  switch (op.type) {
    case 'ripple_delete_range': return 'All unlocked tracks'
    case 'add_captions': return `${(op.clips as unknown[]).length} lines on the caption track`
    case 'set_track_style': return 'Caption style'
    default: return typeof op.clipId === 'string' ? `Clip ${op.clipId.slice(-6)}` : ''
  }
}
function timeOf(op: { type: string } & Record<string, unknown>) {
  if (op.type === 'ripple_delete_range') return `${formatUs(op.startUs as number)}–${formatUs(op.endUs as number)}`
  if (op.type === 'split_clip') return formatUs(op.atUs as number)
  return undefined
}
