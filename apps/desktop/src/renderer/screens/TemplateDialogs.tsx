import { useEffect, useMemo, useRef, useState } from 'react'
import { Clapperboard, FileVideo, Film, ImagePlus, Link2, Type, Volume2, X } from 'lucide-react'
import { Badge, Button, Dialog, DropZone, JobProgress, Segmented, Select, Spinner, Switch, TextField, useToast } from '@framevane/ui'
import { formatUs } from '@framevane/doc'
import type { TemplateBrowser, TemplateSummary, TemplateView } from '../../shared/api'
import { useApp } from '../app/store'

const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p
const seconds = (us: number) => `${(us / 1e6).toFixed(us < 10e6 ? 1 : 0)} s`

/**
 * Make a template from someone else's video: a file you saved, or a post link Framevane downloads. The analysis runs
 * as a job (cuts → stills → sound → on-screen text); when it's done the "use" dialog opens on the new template.
 */
export function NewTemplateDialog({ onClose, onMade }: { onClose: () => void; onMade: (t: TemplateSummary) => void }) {
  const mac = window.framevane.app.platform === 'darwin'
  const [mode, setMode] = useState<'file' | 'link'>('file')
  const [path, setPath] = useState<string | null>(null)
  const [link, setLink] = useState('')
  const [cookies, setCookies] = useState<'none' | TemplateBrowser>('none')
  const [readText, setReadText] = useState(true)
  const [job, setJob] = useState<{ id: string; progress: number; detail?: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const linkOk = /^(https?:\/\/)?[\w.-]+\.[a-z]{2,}\/\S+$/i.test(link.trim())
  const ready = mode === 'file' ? !!path : linkOk

  useEffect(() => window.framevane.jobs.onEvent((e) => {
    setJob((j) => (j && e.id === j.id ? { ...j, progress: e.progress, ...(e.detail ? { detail: e.detail } : {}) } : j))
  }), [])

  async function make() {
    setError(null)
    try {
      const { jobId } = await window.framevane.templates.create(mode === 'file' ? { path: path!, readText } : { link: link.trim(), cookiesFrom: cookies === 'none' ? null : cookies, readText })
      setJob({ id: jobId, progress: 0 })
      const t = await window.framevane.templates.wait(jobId)
      onMade(t)
    } catch (e) {
      const msg = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)
      setError(msg === 'cancelled' ? null : msg)
      setJob(null)
    }
  }

  const browsers: { value: 'none' | TemplateBrowser; label: string }[] = [
    { value: 'none', label: 'Nobody (public post)' },
    { value: 'chrome', label: 'Chrome' },
    ...(mac ? [{ value: 'safari' as const, label: 'Safari' }] : [{ value: 'edge' as const, label: 'Edge' }]),
    { value: 'firefox', label: 'Firefox' },
    { value: 'brave', label: 'Brave' },
  ]

  return (
    <Dialog open onOpenChange={(o) => !o && !job && onClose()} busy={!!job} width={560} title="Template from a video"
      description="Framevane copies the edit: every cut becomes a slot for one of your clips, with the same timing, on-screen text and sound."
      footer={job
        ? <Button variant="ghost" onClick={() => void window.framevane.jobs.cancel(job.id)}>Cancel</Button>
        : <><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!ready} onClick={() => void make()}>Make template</Button></>}>
      <div className="flex flex-col gap-4">
        {job ? (
          <JobProgress title="Making the template" value={job.progress} detail={job.detail ?? 'Starting'} />
        ) : (
          <>
            <Segmented label="Where the video comes from" value={mode} onValueChange={(v) => setMode(v as 'file' | 'link')}
              options={[{ value: 'file', label: 'A video file', icon: <FileVideo /> }, { value: 'link', label: 'A link', icon: <Link2 /> }]} />
            {mode === 'file' ? (
              path ? (
                <div className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm">
                  <Film className="size-4 shrink-0 text-muted" aria-hidden />
                  <span className="min-w-0 flex-1 truncate" title={path}>{fileName(path)}</span>
                  <Button size="sm" variant="ghost" onClick={() => setPath(null)}>Change</Button>
                </div>
              ) : (
                <DropZone label="Drop a TikTok, Reel or Short you saved" hint="or choose a video"
                  onFiles={(files) => { const p = files.map((f) => window.framevane.app.pathForFile(f)).find(Boolean); if (p) setPath(p) }}
                  onBrowse={async () => { const [p] = await window.framevane.app.pickFiles({ kind: 'video' }); if (p) setPath(p) }} />
              )
            ) : (
              <div className="flex flex-col gap-3">
                <TextField label="Post link" placeholder="https://www.tiktok.com/@creator/video/…" value={link} autoFocus onChange={(e) => setLink(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && ready && void make()}
                  hint="TikTok, Instagram Reels, YouTube Shorts and most video sites. Use Share → Copy link."
                  error={link.trim() && !linkOk ? 'That doesn’t look like a link.' : undefined} />
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm">
                    <p>Use my sign-in from</p>
                    <p className="text-xs text-muted">Only for posts that need an account (often Instagram). The browser should be closed.</p>
                  </div>
                  <Select label="Use my sign-in from" hideLabel width={190} value={cookies} onValueChange={(v) => setCookies(v as typeof cookies)} options={browsers} />
                </div>
              </div>
            )}
            <Switch label="Read on-screen text" checked={readText} onCheckedChange={setReadText}
              description="The local AI turns titles and captions into text you can edit. The first time, it sets itself up (a large one-off download)." />
            <p className="text-xs text-muted">Only use videos you have permission to reuse. The template keeps a copy of the video and its sound on this computer.</p>
          </>
        )}
        {error && <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      </div>
    </Dialog>
  )
}

/**
 * Fill a template: drop your clips (they fill the slots in order and repeat if there are fewer than slots), or pick a
 * clip for a particular slot. Creates a new project and opens it.
 */
export function UseTemplateDialog({ templateId, onClose }: { templateId: string; onClose: () => void }) {
  const toast = useToast()
  const [t, setT] = useState<TemplateView | null>(null)
  const [pool, setPool] = useState<string[]>([])
  const [picked, setPicked] = useState<(string | null)[]>([])
  const [sound, setSound] = useState<'template' | 'clips' | 'both'>('template')
  const [keepText, setKeepText] = useState(true)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const video = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    void window.framevane.templates.get(templateId).then((v) => {
      setT(v)
      setName(v.name)
      setSound(v.hasSound ? 'template' : 'clips')
      setPicked(v.slotList.map(() => null))
    }).catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [templateId])

  // what goes where, as the main process will do it: picks first, then the pool in order, round and round
  const filling = useMemo(() => {
    let n = 0
    return (t?.slotList ?? []).map((_, i) => picked[i] ?? (pool.length ? pool[n++ % pool.length]! : null))
  }, [t, pool, picked])

  const addFiles = (paths: string[]) => setPool((p) => [...p, ...paths.filter((x) => x && !p.includes(x))])

  async function pickFor(i: number) {
    const [p] = await window.framevane.app.pickFiles({ kind: 'media' })
    if (p) setPicked((xs) => xs.map((x, j) => (j === i ? p : x)))
  }

  async function create() {
    if (!t) return
    setBusy(true)
    setError(null)
    try {
      const r = await window.framevane.templates.use(t.id, { files: pool, slotFiles: picked, sound, keepText, name })
      await useApp.getState().loadProjects()
      useApp.getState().go({ name: 'editor', projectId: r.projectId })
      toast({ tone: 'success', title: `Made “${name || t.name}”`, description: r.filled < r.slots ? `${r.filled} of ${r.slots} slots filled.` : `All ${r.slots} slots filled. Swap any clip in the editor.` })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
      setBusy(false)
    }
  }

  const portrait = t ? t.height >= t.width : true
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} busy={busy} width={980} title={t ? `Use “${t.name}”` : 'Use template'}
      description="Your clips go into the slots in order, cut to the same timing. Clips shorter than their slot are slowed down to fit."
      footer={<><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button><Button variant="primary" disabled={!t || busy || (!pool.length && !picked.some(Boolean))} onClick={() => void create()}>{busy ? 'Making the video…' : 'Create video'}</Button></>}>
      {!t ? (
        error ? <p role="alert" className="text-sm text-danger">{error}</p> : <div className="flex justify-center py-10"><Spinner label="Loading the template" /></div>
      ) : (
        <div className="flex gap-5">
          <aside className="flex w-[260px] shrink-0 flex-col gap-3" aria-label="The original">
            {t.referenceUrl
              ? <video ref={video} src={t.referenceUrl} controls muted={!t.hasSound} playsInline aria-label="The original video" className={`w-full rounded-md bg-black ${portrait ? 'aspect-[9/16]' : 'aspect-video'} object-contain`} />
              : <div className="flex aspect-[9/16] items-center justify-center rounded-md bg-surface-3"><Clapperboard className="size-6 text-muted" aria-hidden /></div>}
            <div className="flex flex-wrap gap-1.5">
              <Badge>{t.slots} {t.slots === 1 ? 'shot' : 'shots'}</Badge>
              <Badge>{formatUs(t.durationUs)}</Badge>
              <Badge>{t.width}×{t.height}</Badge>
              {t.hasSound && <Badge icon={<Volume2 />}>Sound</Badge>}
              {t.texts > 0 && <Badge icon={<Type />}>{t.texts} text{t.texts === 1 ? '' : 's'}</Badge>}
            </div>
            {t.warnings.map((w) => <p key={w} className="text-xs text-warning">{w}</p>)}
            {t.source.url && <p className="truncate text-xs text-muted" title={t.source.url}>From {t.source.url}</p>}
          </aside>

          <div className="flex min-w-0 flex-1 flex-col gap-4">
            <section aria-labelledby="tpl-clips-h" className="flex flex-col gap-2">
              <h3 id="tpl-clips-h" className="text-base">Your clips <span className="text-sm text-muted">{pool.length ? `${pool.length} · fill the ${t.slots} slots in order` : ''}</span></h3>
              <DropZone label="Drop your clips and photos here" hint="or choose files" className="py-5"
                onFiles={(files) => addFiles(files.map((f) => window.framevane.app.pathForFile(f)))}
                onBrowse={async () => addFiles(await window.framevane.app.pickFiles({ kind: 'media' }))} />
              {pool.length > 0 && (
                <ul aria-label="Clips to fill the slots with" className="flex flex-wrap gap-1.5">
                  {pool.map((p, i) => (
                    <li key={p} className="flex max-w-[220px] items-center gap-1 rounded-pill bg-surface-3 py-0.5 pl-2.5 pr-1 text-xs">
                      <span className="tabular-nums text-muted">{i + 1}</span>
                      <span className="truncate" title={p}>{fileName(p)}</span>
                      <button type="button" aria-label={`Remove ${fileName(p)}`} onClick={() => setPool((xs) => xs.filter((x) => x !== p))} className="rounded-pill p-0.5 text-muted hover:bg-surface-2 hover:text-fg"><X className="size-3" /></button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="tpl-slots-h" className="flex flex-col gap-2">
              <h3 id="tpl-slots-h" className="text-base">Slots</h3>
              <ol aria-label="Template slots" className="grid max-h-[300px] grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2 overflow-y-auto pr-1">
                {t.slotList.map((s, i) => (
                  <li key={s.id} className="flex flex-col gap-1">
                    <button type="button" onClick={() => void pickFor(i)} aria-label={`Slot ${i + 1}, ${seconds(s.durationUs)}${filling[i] ? `: ${fileName(filling[i]!)}` : ', empty'}. Choose a clip for this slot`}
                      onMouseEnter={() => { if (video.current && video.current.paused) video.current.currentTime = (s.startUs + s.durationUs / 2) / 1e6 }}
                      className={`relative block w-full overflow-hidden rounded-sm bg-surface-3 bg-cover bg-center ring-1 hover:ring-border-strong ${portrait ? 'aspect-[9/16] max-h-[150px]' : 'aspect-video'} ${picked[i] ? 'ring-2 ring-accent' : 'ring-border'}`}
                      style={s.thumbUrl ? { backgroundImage: `url("${s.thumbUrl}")` } : undefined}>
                      <span className="absolute left-1 top-1 rounded-xs bg-scrim/70 px-1 font-mono text-[10px]">{i + 1}</span>
                      <span className="absolute right-1 top-1 rounded-xs bg-scrim/70 px-1 font-mono text-[10px]">{seconds(s.durationUs)}</span>
                      {!filling[i] && <ImagePlus className="absolute inset-0 m-auto size-5 text-fg/80" aria-hidden />}
                    </button>
                    <div className="flex min-h-5 items-center gap-1 text-xs">
                      <span className={`min-w-0 flex-1 truncate ${picked[i] ? 'text-fg' : 'text-muted'}`} title={filling[i] ?? undefined}>{filling[i] ? fileName(filling[i]!) : 'Empty'}</span>
                      {picked[i] && <button type="button" aria-label={`Clear slot ${i + 1}`} onClick={() => setPicked((xs) => xs.map((x, j) => (j === i ? null : x)))} className="rounded-xs p-0.5 text-muted hover:bg-surface-3 hover:text-fg"><X className="size-3" /></button>}
                    </div>
                  </li>
                ))}
              </ol>
              <p className="text-xs text-muted">Click a slot to pick its clip. Unpicked slots take your clips in order; a clip used twice carries on where it left off.</p>
            </section>

            <section aria-label="Options" className="grid grid-cols-2 gap-x-5 gap-y-3">
              <TextField label="Project name" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
              <div className="flex flex-col gap-1">
                <span className="text-sm text-muted" id="tpl-sound-l">Sound</span>
                <Select label="Sound" hideLabel width={260} value={sound} onValueChange={(v) => setSound(v as typeof sound)} disabled={!t.hasSound}
                  options={[{ value: 'template', label: 'The template’s sound', disabled: !t.hasSound }, { value: 'clips', label: 'My clips’ own sound' }, { value: 'both', label: 'Both (my clips quieter)', disabled: !t.hasSound }]} />
              </div>
              {t.texts > 0 && <div className="col-span-2"><Switch label="Keep the template’s text" description="As text clips you can edit: change the words, font and colours in the editor." checked={keepText} onCheckedChange={setKeepText} /></div>}
            </section>
            {error && <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
          </div>
        </div>
      )}
    </Dialog>
  )
}
