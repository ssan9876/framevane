import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Bot, Clapperboard, Copy, Film, ImageIcon, Library, MoreHorizontal, Pencil, Plus, Search, Settings, Sparkles, Trash2, AlertTriangle } from 'lucide-react'
import { Badge, Button, Checkbox, Dialog, DropdownMenu, DropZone, EmptyState, IconButton, TextField, useToast } from '@framevane/ui'
import { formatUs } from '@framevane/doc'
import type { ProjectSummary } from '../../shared/api'
import { useApp } from '../app/store'
import { BatchDialog } from './BatchDialog'

/** S01 · Home: projects, quick starts, drop files to start a project. */
export function Home() {
  const projects = useApp((s) => s.projects)
  const { go, loadProjects, openDialog } = useApp.getState()
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<ProjectSummary | null>(null)
  const [deleting, setDeleting] = useState<ProjectSummary | null>(null)
  const [loaded, setLoaded] = useState(false)
  // select mode: pick projects for a batch agent run (F14)
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [batch, setBatch] = useState<ProjectSummary[] | null>(null)
  const toast = useToast()

  useEffect(() => { void loadProjects().finally(() => setLoaded(true)) }, [loadProjects])

  const shown = useMemo(() => projects.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase())), [projects, query])

  async function create(files: string[] = []) {
    setCreating(true)
    try {
      const name = files.length ? files[0]!.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, '') : `Project ${new Date().toLocaleDateString()}`
      const { projectId } = await window.framevane.projects.create({ name, files })
      go({ name: 'editor', projectId })
    } catch (e) {
      toast({ tone: 'error', title: 'Could not create the project', description: e instanceof Error ? e.message : String(e) })
    } finally {
      setCreating(false)
    }
  }

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-[var(--fv-titlebar-h)] shrink-0 items-center justify-between border-b border-border bg-surface px-4">
        <div className="flex items-center gap-2">
          <Clapperboard className="size-4 text-accent" aria-hidden />
          <span className="text-base">Framevane</span>
          <Badge>Preview</Badge>
        </div>
        <div className="flex items-center gap-1">
          <IconButton label="Agent library" icon={<Library />} onClick={() => openDialog('agents')} />
          <IconButton label="Settings" shortcut="Ctrl+," icon={<Settings />} onClick={() => openDialog('settings')} />
        </div>
      </header>

      <div className="scroll-y flex-1">
        <div className="mx-auto flex max-w-6xl flex-col gap-8 px-8 py-8">
          <section aria-labelledby="start-h" className="flex flex-col gap-3">
            <h1 id="start-h" className="text-display">What are we making?</h1>
            <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-3">
              <button
                type="button"
                onClick={() => void create()}
                disabled={creating}
                className="flex h-32 flex-col items-start justify-end gap-1 rounded-lg bg-accent p-4 text-left text-on-accent hover:bg-accent-hover disabled:opacity-60"
              >
                <Plus className="size-6" aria-hidden />
                <span className="text-lg">New project</span>
                <span className="text-sm opacity-80">A blank 1080p timeline</span>
              </button>
              <QuickCard icon={<ImageIcon />} title="Photo editor" body="Edit a single image" onClick={() => go({ name: 'photo' })} />
              <QuickCard icon={<Sparkles />} title="Script to video" body="Rough cut from a script" onClick={() => go({ name: 'ai-maker' })} />
            </div>
            <DropZone
              label="Drop footage here and we'll set up a project around it"
              hint="or choose files"
              onFiles={(files) => void create(files.map((f) => window.framevane.app.pathForFile(f)).filter(Boolean))}
              onBrowse={async () => { const files = await window.framevane.app.pickFiles({ kind: 'media' }); if (files.length) void create(files) }}
              disabled={creating}
            />
          </section>

          <section aria-labelledby="projects-h" className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-4">
              <h2 id="projects-h" className="text-xl">Projects <span className="text-base text-muted">{projects.length || ''}</span></h2>
              <div className="flex items-center gap-2">
                {projects.length > 0 && (picking
                  ? <Button size="sm" variant="ghost" onClick={() => { setPicking(false); setPicked([]) }}>Cancel selection</Button>
                  : <Button size="sm" icon={<Bot className="size-3.5" />} onClick={() => setPicking(true)}>Select for an agent</Button>)}
                <div className="w-64"><TextField label="Search projects" hideLabel placeholder="Search projects" leading={<Search />} value={query} onChange={(e) => setQuery(e.target.value)} /></div>
              </div>
            </div>
            {picking && (
              <div role="toolbar" aria-label="Selected projects" className="flex items-center gap-3 rounded-md border border-agent/40 bg-agent-soft/40 px-3 py-2 text-sm">
                <span>{picked.length ? `${picked.length} selected` : 'Click projects to select them'}</span>
                <Button size="sm" variant="ghost" onClick={() => setPicked(picked.length === shown.length ? [] : shown.filter((p) => p.status === 'ok').map((p) => p.id))}>{picked.length === shown.length ? 'Select none' : 'Select all'}</Button>
                <span className="flex-1" />
                <Button size="sm" variant="agent" disabled={!picked.length} onClick={() => setBatch(projects.filter((p) => picked.includes(p.id)))}>
                  Run an agent on {picked.length || 'the'} project{picked.length === 1 ? '' : 's'}
                </Button>
              </div>
            )}
            {loaded && projects.length === 0 && (
              <EmptyState icon={<Film />} title="Nothing here yet" body="Your projects will live here. Start one above, or drop in some footage." />
            )}
            {projects.length > 0 && shown.length === 0 && <p className="py-6 text-center text-sm text-muted">No projects match “{query}”.</p>}
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
              {shown.map((p) => (
                <ProjectCard key={p.id} p={p} onOpen={() => go({ name: 'editor', projectId: p.id })}
                  picking={picking} picked={picked.includes(p.id)} onPick={(v) => setPicked((x) => (v ? [...x, p.id] : x.filter((id) => id !== p.id)))}
                  onRename={() => setRenaming(p)}
                  onDuplicate={async () => { await window.framevane.projects.duplicate(p.id); await loadProjects() }}
                  onDelete={() => setDeleting(p)} />
              ))}
            </ul>
          </section>
        </div>
      </div>

      {batch && <BatchDialog projects={batch} onClose={() => { setBatch(null); setPicking(false); setPicked([]) }} />}
      {renaming && <RenameDialog p={renaming} onClose={() => setRenaming(null)} />}
      {deleting && (
        <Dialog open onOpenChange={(o) => !o && setDeleting(null)} title={`Delete “${deleting.name}”?`} description="The project folder moves to the Recycle Bin. Your original media files are not touched."
          footer={<><Button variant="ghost" onClick={() => setDeleting(null)}>Cancel</Button><Button variant="danger" onClick={async () => { await window.framevane.projects.remove(deleting.id); setDeleting(null); await loadProjects() }}>Delete project</Button></>}>
          <p className="text-sm text-muted">{deleting.dirPath}</p>
        </Dialog>
      )}
    </main>
  )
}

function QuickCard({ icon, title, body, onClick }: { icon: ReactNode; title: string; body: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex h-32 flex-col items-start justify-end gap-1 rounded-lg border border-border bg-surface-2 p-4 text-left hover:border-border-strong hover:bg-surface-3 [&_svg]:size-5 [&_svg]:text-muted">
      {icon}
      <span className="text-lg">{title}</span>
      <span className="text-sm text-muted">{body}</span>
    </button>
  )
}

function ProjectCard({ p, onOpen, onRename, onDuplicate, onDelete, picking, picked, onPick }: {
  p: ProjectSummary; onOpen: () => void; onRename: () => void; onDuplicate: () => void; onDelete: () => void
  picking: boolean; picked: boolean; onPick: (v: boolean) => void
}) {
  const broken = p.status !== 'ok'
  return (
    <li className="group flex flex-col gap-1.5">
      <div className="relative">
        {picking && !broken && (
          <div className="absolute left-1.5 top-1.5 z-[1] rounded-xs bg-scrim/70 p-1"><Checkbox label={`Select ${p.name}`} hideLabel checked={picked} onCheckedChange={onPick} /></div>
        )}
        <button type="button" onClick={picking ? () => onPick(!picked) : onOpen} disabled={broken} aria-label={picking ? `${picked ? 'Deselect' : 'Select'} ${p.name}` : `Open ${p.name}`}
          className={`relative block aspect-video w-full overflow-hidden rounded-md bg-surface-3 bg-cover bg-center ring-1 hover:ring-border-strong disabled:cursor-not-allowed ${picked ? 'ring-2 ring-agent' : 'ring-border'}`}
          style={p.coverUrl ? { backgroundImage: `url("${p.coverUrl}")` } : undefined}>
          {!p.coverUrl && <Film className="absolute inset-0 m-auto size-6 text-muted" aria-hidden />}
          {p.durationUs > 0 && <span className="absolute bottom-1.5 right-1.5 rounded-xs bg-scrim/70 px-1 font-mono text-[10px]">{formatUs(p.durationUs)}</span>}
          {broken && (
            <span className="absolute inset-0 flex items-center justify-center gap-1 bg-scrim/70 text-sm text-warning">
              <AlertTriangle className="size-4" />{p.status === 'missing_dir' ? 'Folder missing' : p.status === 'corrupt' ? "Can't read project" : 'Media missing'}
            </span>
          )}
        </button>
        <div className="absolute right-1.5 top-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <DropdownMenu trigger={<IconButton variant="secondary" size="sm" label={`More actions for ${p.name}`} icon={<MoreHorizontal />} tooltip={false} />}
            items={[{ label: 'Rename', icon: <Pencil />, onSelect: onRename }, { label: 'Duplicate', icon: <Copy />, onSelect: onDuplicate }, { label: 'Delete', icon: <Trash2 />, danger: true, separatorBefore: true, onSelect: onDelete }]} />
        </div>
      </div>
      <span className="truncate text-sm" title={p.name}>{p.name}</span>
      <span className="text-xs text-muted">{p.width}×{p.height} · {new Date(p.updatedAt).toLocaleString()}</span>
    </li>
  )
}

function RenameDialog({ p, onClose }: { p: ProjectSummary; onClose: () => void }) {
  const [name, setName] = useState(p.name)
  const save = async () => {
    if (!name.trim()) return
    await window.framevane.projects.rename(p.id, name)
    await useApp.getState().loadProjects()
    onClose()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Rename project" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={() => void save()} disabled={!name.trim()}>Save</Button></>}>
      <TextField label="Name" value={name} autoFocus maxLength={200} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} error={name.trim() ? undefined : 'Give the project a name.'} />
    </Dialog>
  )
}
