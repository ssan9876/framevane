import { useMemo, useState } from 'react'
import { ArrowLeftRight, Captions, Film, Music, Palette, Plus, SlidersHorizontal, Sparkles, Sticker, Type, Construction, Wand2 } from 'lucide-react'
import { AssetCard, Badge, Button, CategoryList, DropZone, EmptyState, PanelTabs, Select, TabPanel, Checkbox, useToast } from '@framevane/ui'
import { buildCaptionClips, formatUs, timelineWords } from '@framevane/doc'
import type { MediaInfo } from '../../shared/api'
import { useApp } from '../app/store'
import { addAssetToTimeline } from './actions'
import { CaptionFiles, TextTab, TranscriptEditor, VoiceoverRecorder } from './AssetTabsM3'
import { EffectsTab, FiltersTab, TransitionsTab } from './LookTabs'

/** S04–S12 · Asset panel. Stickers and adjustment layers are reachable stubs; everything else works. */
export function AssetPanel() {
  const [tab, setTab] = useState('media')
  return (
    <PanelTabs
      value={tab}
      onValueChange={setTab}
      className="h-full"
      tabs={[
        { value: 'media', label: 'Media', icon: <Film /> },
        { value: 'audio', label: 'Audio', icon: <Music /> },
        { value: 'text', label: 'Text', icon: <Type /> },
        { value: 'stickers', label: 'Stickers', icon: <Sticker /> },
        { value: 'effects', label: 'Effects', icon: <Sparkles /> },
        { value: 'transitions', label: 'Transitions', icon: <ArrowLeftRight /> },
        { value: 'filters', label: 'Filters', icon: <Palette /> },
        { value: 'captions', label: 'Captions', icon: <Captions /> },
        { value: 'adjust', label: 'Adjust', icon: <SlidersHorizontal /> },
      ]}
    >
      <TabPanel value="media" className="flex min-h-0"><MediaTab /></TabPanel>
      <TabPanel value="audio" className="flex min-h-0"><AudioTab /></TabPanel>
      <TabPanel value="text" className="flex min-h-0 flex-col"><TextTab /></TabPanel>
      <TabPanel value="stickers"><Stub id="S07" what="Stickers, emoji and shapes" when="should-have" /></TabPanel>
      <TabPanel value="effects" className="flex min-h-0 flex-col"><EffectsTab /></TabPanel>
      <TabPanel value="transitions" className="flex min-h-0 flex-col"><TransitionsTab /></TabPanel>
      <TabPanel value="filters" className="flex min-h-0 flex-col"><FiltersTab /></TabPanel>
      <TabPanel value="captions" className="scroll-y"><CaptionsTab /></TabPanel>
      <TabPanel value="adjust"><Stub id="S12" what="Adjustment layers and saved color presets" when="should-have" /></TabPanel>
    </PanelTabs>
  )
}

function Stub({ id, what, when }: { id: string; what: string; when: string }) {
  return <EmptyState className="h-full" icon={<Construction />} title={`${what} are coming`} body={`Planned for ${when} (${id}). Everything here will be free, with no paid packs.`} />
}

function useImport() {
  const doc = useApp((s) => s.doc)
  const toast = useToast()
  return async (paths: string[]) => {
    if (!doc || !paths.length) return
    try {
      const infos = await window.framevane.media.import(doc.id, paths)
      useApp.setState((s) => ({ media: [...s.media.filter((m) => !infos.some((i) => i.asset.id === m.asset.id)), ...infos] }))
      // register assets with the project document right away so agents and undo know them
      const fresh = infos.filter((i) => !doc.assets[i.asset.id] && i.status !== 'unsupported')
      if (fresh.length) await useApp.getState().apply(fresh.map((i) => ({ type: 'add_asset', asset: i.asset })))
      const bad = infos.filter((i) => i.status === 'unsupported')
      if (bad.length) toast({ tone: 'warning', title: `${bad.length} file${bad.length > 1 ? 's' : ''} couldn't be read`, description: bad.map((b) => b.asset.name).join(', ') })
    } catch (e) {
      toast({ tone: 'error', title: "That file didn't come in", description: e instanceof Error ? e.message : String(e) })
    }
  }
}

/** S04 · Media */
function MediaTab() {
  const media = useApp((s) => s.media)
  const doc = useApp((s) => s.doc)
  const [filter, setFilter] = useState<'all' | 'video' | 'audio' | 'image'>('all')
  const [selected, setSelected] = useState<string | null>(null)
  const doImport = useImport()
  const used = useMemo(() => new Set(doc?.tracks.flatMap((t) => t.clips.flatMap((c) => ('assetId' in c ? [c.assetId] : [])))), [doc])
  const shown = media.filter((m) => filter === 'all' || m.asset.kind === filter)
  const browse = async () => doImport(await window.framevane.app.pickFiles({ kind: 'media' }))

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault() }}
      onDrop={(e) => { if (!e.dataTransfer.files.length) return; e.preventDefault(); void doImport([...e.dataTransfer.files].map((f) => window.framevane.app.pathForFile(f)).filter(Boolean)) }}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => void browse()}>Import</Button>
        <Select label="Show" hideLabel width={110} value={filter} onValueChange={(v) => setFilter(v as typeof filter)}
          options={[{ value: 'all', label: 'All media' }, { value: 'video', label: 'Videos' }, { value: 'audio', label: 'Audio' }, { value: 'image', label: 'Images' }]} />
      </div>
      {media.length === 0 ? (
        <div className="p-3"><DropZone onBrowse={() => void browse()} onFiles={(f) => void doImport(f.map((x) => window.framevane.app.pathForFile(x)).filter(Boolean))} /></div>
      ) : (
        <ul className="scroll-y grid flex-1 grid-cols-[repeat(auto-fill,var(--fv-asset-card-w))] content-start gap-2 px-3 pb-3" aria-label="Project media">
          {shown.map((m) => (
            <li key={m.asset.id} onDragStart={(e) => { e.dataTransfer.setData('application/x-framevane-asset', m.asset.id); e.dataTransfer.effectAllowed = 'copy' }}>
              <AssetCard
                title={m.asset.name}
                kind={m.asset.kind}
                thumb={m.urls.thumb ? `center / cover no-repeat url("${m.urls.thumb}")` : undefined}
                duration={m.asset.durationUs ? formatUs(m.asset.durationUs) : undefined}
                state={m.status === 'missing' ? 'missing' : m.status === 'preparing' ? 'generating' : 'ready'}
                selected={selected === m.asset.id}
                usedInProject={used.has(m.asset.id)}
                badge={m.status === 'unsupported' ? <Badge tone="danger">Unsupported</Badge> : undefined}
                onSelect={() => setSelected(m.asset.id)}
                onAdd={m.status === 'ready' ? () => void addAssetToTimeline(m.asset.id) : undefined}
              />
              {m.status === 'missing' && <RelinkButton m={m} />}
            </li>
          ))}
          {shown.length === 0 && <li className="col-span-full py-6 text-center text-sm text-muted">No {filter} in this project yet.</li>}
        </ul>
      )}
    </div>
  )
}

/** Point a missing file at its new location (same kind, about the same length). */
function RelinkButton({ m }: { m: MediaInfo }) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  return (
    <Button size="sm" variant="ghost" loading={busy} className="mt-0.5 w-full" aria-label={`Locate ${m.asset.name}`} onClick={async () => {
      const doc = useApp.getState().doc
      const [path] = await window.framevane.app.pickFiles({ kind: 'media' })
      if (!doc || !path) return
      setBusy(true)
      try {
        const info = await window.framevane.media.relink(doc.id, m.asset.id, path)
        useApp.setState((s) => ({ media: s.media.map((x) => (x.asset.id === info.asset.id ? info : x)) }))
        await useApp.getState().apply([{ type: 'add_asset', asset: info.asset }])
        toast({ tone: 'success', title: `Found ${m.asset.name}`, description: 'Every clip that uses it is back.' })
      } catch (e) {
        toast({ tone: 'warning', title: "That doesn't look like the same file", description: e instanceof Error ? e.message : String(e) })
      } finally {
        setBusy(false)
      }
    }}>Locate…</Button>
  )
}

/** S05 · Audio: local files only in M0 (no licensed library). */
function AudioTab() {
  const media = useApp((s) => s.media)
  const [cat, setCat] = useState('local')
  const doImport = useImport()
  const audio = media.filter((m) => m.asset.kind === 'audio')
  return (
    <>
      <CategoryList label="Audio sources" value={cat} onValueChange={setCat} items={[{ value: 'local', label: 'Your audio', count: audio.length }, { value: 'sfx', label: 'Sound effects' }, { value: 'free', label: 'Free library' }]} />
      <div className="scroll-y flex flex-1 flex-col gap-3 p-3">
        {cat === 'local' && <VoiceoverRecorder />}
        {cat === 'local' ? (
          audio.length ? (
            <ul className="flex flex-col gap-1">
              {audio.map((m) => <AudioRow key={m.asset.id} m={m} />)}
            </ul>
          ) : (
            <EmptyState icon={<Music />} title="No audio yet" body="Import music or voice-over files. Your own files only, so there's nothing to license." action={<Button size="sm" onClick={async () => void doImport(await window.framevane.app.pickFiles({ kind: 'media' }))}>Import audio</Button>} />
          )
        ) : (
          <EmptyState icon={<Construction />} title="Coming later" body="A free CC0 library (Freesound, Pixabay) is on the way, using your own API key. Licensed music from other apps can't come along." />
        )}
      </div>
    </>
  )
}

function AudioRow({ m }: { m: MediaInfo }) {
  return (
    <li className="flex items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-surface-2" draggable onDragStart={(e) => e.dataTransfer.setData('application/x-framevane-asset', m.asset.id)}>
      <Music className="size-4 text-muted" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-sm">{m.asset.name}</span>
      <span className="font-mono text-xs text-muted">{m.asset.durationUs ? formatUs(m.asset.durationUs) : ''}</span>
      <Button size="sm" variant="ghost" disabled={m.status !== 'ready'} onClick={() => void addAssetToTimeline(m.asset.id)} aria-label={`Add ${m.asset.name} at the playhead`}>Add</Button>
    </li>
  )
}

/** S11 · Auto captions: local Whisper, timeline-accurate after cuts. */
function CaptionsTab() {
  const doc = useApp((s) => s.doc)
  const [language, setLanguage] = useState('auto')
  const [replace, setReplace] = useState(true)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  if (!doc) return null
  const audioAssets = [...new Set(doc.tracks.filter((t) => t.main).flatMap((t) => t.clips.flatMap((c) => ('assetId' in c && doc.assets[c.assetId]?.hasAudio ? [c.assetId] : []))))]
  const existing = doc.tracks.find((t) => t.kind === 'caption')

  async function generate() {
    if (!doc) return
    setBusy(true)
    try {
      const transcripts: Record<string, { text: string; start: number; end: number }[]> = {}
      for (const id of audioAssets) transcripts[id] = (await window.framevane.analysis.transcript(doc.id, id, language === 'auto' ? {} : { language })).words
      const current = useApp.getState().doc!
      const clips = buildCaptionClips(timelineWords(current, transcripts), { idPrefix: `cap-${Date.now().toString(36)}` })
      if (!clips.length) { toast({ tone: 'warning', title: 'No speech found on the main track' }); return }
      const ok = await useApp.getState().apply([{ type: 'add_captions', trackId: existing?.id ?? 'track-captions', trackName: 'Captions', clips, replace: replace && !!existing }])
      if (ok) toast({ tone: 'success', title: `Added ${clips.length} caption lines`, description: 'Edit a line in the inspector, or ask the agent to restyle them.' })
    } catch (e) {
      toast({ tone: 'error', title: "Captions couldn't be generated", description: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <h3 className="text-base">Auto captions</h3>
        <p className="mt-1 text-sm text-muted">Transcribes the main track on your computer (Whisper on your GPU) and adds a caption line per phrase. Free, with no time limit.</p>
      </div>
      <Select label="Spoken language" value={language} onValueChange={setLanguage} width={170}
        options={[{ value: 'auto', label: 'Detect automatically' }, { value: 'en', label: 'English' }, { value: 'es', label: 'Spanish' }, { value: 'fr', label: 'French' }, { value: 'de', label: 'German' }, { value: 'pt', label: 'Portuguese' }, { value: 'ja', label: 'Japanese' }, { value: 'zh', label: 'Chinese' }]} />
      {existing && <Checkbox label="Replace the existing captions" checked={replace} onCheckedChange={setReplace} />}
      <Button variant="primary" icon={<Wand2 className="size-3.5" />} loading={busy} disabled={!audioAssets.length} onClick={() => void generate()}>
        {busy ? 'Transcribing…' : existing ? 'Generate again' : 'Generate captions'}
      </Button>
      {!audioAssets.length && <p className="text-sm text-muted">Add a clip with sound to the main track first.</p>}
      {existing && <p className="text-sm text-muted">{existing.clips.length} caption lines on “{existing.name}”. Select a line on the timeline to edit its text and the look of all captions.</p>}
      <CaptionFiles hasCaptions={!!existing?.clips.length} />
      <TranscriptEditor />
    </div>
  )
}
