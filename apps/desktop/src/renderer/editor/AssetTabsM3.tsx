import { useEffect, useMemo, useRef, useState } from 'react'
import { FileDown, FileUp, Mic, Plus, Scissors, Square } from 'lucide-react'
import { Button, Checkbox, EmptyState, Select, useToast } from '@framevane/ui'
import { DEFAULT_CAPTION_STYLE, emptyProject, formatUs, isFiller, NO_TEXT_ANIM, TextStyle, type TimelineWord } from '@framevane/doc'
import { drawFrame, ensureFonts } from '../engine/compositor'
import { useApp } from '../app/store'
import { addText, cutWords, exportCaptions, fillerWords, importSrt, mainTrackWords, placeAudioOps } from './actions-m3'
import { useEditor } from './Editor'
import { TEXT_PRESETS, type TextPreset } from './textPresets'

const errText = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))

/** A preset's sample drawn by the real compositor (so the tile shows exactly what you get). */
function PresetPreview({ preset }: { preset: TextPreset }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const W = 720
    const H = 180
    const style = TextStyle.parse({ ...DEFAULT_CAPTION_STYLE, ...preset.style, y: 0.5, maxWidth: 0.96, align: 'center', fontSize: Math.min(preset.style.fontSize ?? 96, 72) })
    const doc = emptyProject('preview', 'preview', { width: W, height: H, background: { kind: 'color', color: '#000000' } })
    doc.tracks.push({ id: 't', kind: 'text', name: 'Text', main: false, locked: false, hidden: false, muted: false, clips: [{
      id: 'c', kind: 'text', startUs: 0, durationUs: 3_000_000, enabled: true, text: preset.sample, style, keyframes: {}, anim: NO_TEXT_ANIM,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, flipH: false, flipV: false, crop: { left: 0, top: 0, right: 0, bottom: 0 } },
    }] })
    let alive = true
    void ensureFonts(doc).then(() => {
      const c = ref.current
      if (!alive || !c) return
      drawFrame(c.getContext('2d')!, doc, 1_500_000, new Map(), c.width / W)
    })
    return () => { alive = false }
  }, [preset])
  return <canvas ref={ref} width={720} height={180} aria-hidden className="h-12 w-full rounded-sm" />
}

/** S06 · Text: plain text and our own presets, added at the playhead. */
export function TextTab() {
  return (
    <div className="scroll-y flex h-full flex-col gap-3 p-3">
      <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => void addText()}>Add text</Button>
      <h3 className="text-sm text-muted">Styles</h3>
      <ul aria-label="Text styles" className="grid grid-cols-2 gap-2">
        {TEXT_PRESETS.map((p) => (
          <li key={p.id}>
            <button type="button" aria-label={`Add ${p.name} text`} onClick={() => void addText(p)}
              className="flex w-full flex-col items-center gap-1 overflow-hidden rounded-md border border-border bg-bg p-1.5 hover:border-accent">
              <PresetPreview preset={p} />
              <span className="text-xs text-muted">{p.name}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">Pick a text on the timeline to change its words, look, animation, or to read it aloud.</p>
    </div>
  )
}

/** S05 · Record a voiceover at the playhead (optionally while the timeline plays). */
export function VoiceoverRecorder() {
  const doc = useApp((s) => s.doc)
  const { player } = useEditor()
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState('default')
  const [playAlong, setPlayAlong] = useState(true)
  const [rec, setRec] = useState<{ startedAt: number; atUs: number } | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [saving, setSaving] = useState(false)
  const recorder = useRef<MediaRecorder | null>(null)
  const toast = useToast()

  useEffect(() => {
    void navigator.mediaDevices?.enumerateDevices().then((d) => setDevices(d.filter((x) => x.kind === 'audioinput'))).catch(() => {})
  }, [])
  useEffect(() => {
    if (!rec) return
    const t = setInterval(() => setElapsed(Date.now() - rec.startedAt), 200)
    return () => clearInterval(t)
  }, [rec])

  async function start() {
    if (!doc) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: deviceId === 'default' ? undefined : { exact: deviceId }, echoCancellation: true, noiseSuppression: true } })
      // labels only appear after permission is granted
      void navigator.mediaDevices.enumerateDevices().then((d) => setDevices(d.filter((x) => x.kind === 'audioinput')))
      const r = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
      const chunks: Blob[] = []
      const atUs = useApp.getState().playheadUs
      r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        player.pause()
        setSaving(true)
        try {
          const bytes = new Uint8Array(await new Blob(chunks, { type: 'audio/webm' }).arrayBuffer())
          if (bytes.byteLength < 200) throw new Error('Nothing was recorded. Check the microphone.')
          const m = await window.framevane.media.saveRecording(doc.id, bytes)
          const cur = useApp.getState().doc!
          if (await useApp.getState().apply(placeAudioOps(cur, m, atUs))) toast({ tone: 'success', title: 'Voiceover added', description: `${formatUs(m.asset.durationUs ?? 0)} at ${formatUs(atUs)}` })
        } catch (e) {
          toast({ tone: 'error', title: "The recording couldn't be saved", description: errText(e) })
        } finally { setSaving(false) }
      }
      recorder.current = r
      r.start(250)
      setElapsed(0)
      setRec({ startedAt: Date.now(), atUs })
      if (playAlong) void player.play(atUs)
    } catch (e) {
      toast({ tone: 'error', title: "The microphone didn't start", description: errText(e) })
    }
  }
  function stop() {
    recorder.current?.stop()
    recorder.current = null
    setRec(null)
  }

  return (
    <section aria-label="Voiceover" className="flex flex-col gap-2 rounded-md border border-border p-3">
      <h3 className="text-sm">Voiceover</h3>
      <Select label="Microphone" value={deviceId} width={190} disabled={!!rec} onValueChange={setDeviceId}
        options={[{ value: 'default', label: 'Default microphone' }, ...devices.filter((d) => d.deviceId && d.deviceId !== 'default').map((d, i) => ({ value: d.deviceId, label: d.label || `Microphone ${i + 1}` }))]} />
      <Checkbox label="Play the timeline while recording" checked={playAlong} disabled={!!rec} onCheckedChange={setPlayAlong} />
      {rec
        ? <Button variant="danger" icon={<Square className="size-3.5" />} onClick={stop}>Stop · {formatUs(elapsed * 1000)}</Button>
        : <Button icon={<Mic className="size-3.5" />} loading={saving} onClick={() => void start()}>Record at playhead</Button>}
      <p className="text-xs text-muted">Use headphones so the timeline's sound doesn't end up in the recording.</p>
    </section>
  )
}

/** S11 · Caption files in and out. */
export function CaptionFiles({ hasCaptions }: { hasCaptions: boolean }) {
  const toast = useToast()
  const run = async (fn: () => Promise<unknown>, ok: (v: unknown) => string | null) => {
    try { const v = await fn(); const t = ok(v); if (t) toast({ tone: 'success', title: t }) } catch (e) { toast({ tone: 'error', title: 'That didn’t work', description: errText(e) }) }
  }
  return (
    <div role="group" aria-label="Caption files" className="flex flex-wrap gap-2">
      <Button size="sm" icon={<FileDown className="size-3.5" />} disabled={!hasCaptions} onClick={() => void run(() => exportCaptions('srt'), (p) => (p ? 'Saved the .srt file' : null))}>Export .srt</Button>
      <Button size="sm" icon={<FileDown className="size-3.5" />} disabled={!hasCaptions} onClick={() => void run(() => exportCaptions('txt'), (p) => (p ? 'Saved the transcript text' : null))}>Export .txt</Button>
      <Button size="sm" icon={<FileUp className="size-3.5" />} onClick={() => void run(importSrt, (n) => (n ? `Imported ${n} caption lines` : null))}>Import .srt</Button>
    </div>
  )
}

/**
 * S30 · Edit by transcript: the main track's words in order. Click a word to jump there, Shift+click to select a run,
 * Ctrl+click to add or remove one; Delete cuts the selection out of the video. Filler words are marked.
 */
export function TranscriptEditor() {
  const doc = useApp((s) => s.doc)
  const playheadUs = useApp((s) => s.playheadUs)
  const { seek } = useEditor()
  const [words, setWords] = useState<TimelineWord[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [sel, setSel] = useState<Set<number>>(new Set())
  const anchor = useRef<number | null>(null)
  const toast = useToast()
  const version = doc?.version

  const load = async () => {
    if (!doc) return
    setLoading(true)
    try { setWords(await mainTrackWords(useApp.getState().doc!)) } catch (e) { toast({ tone: 'error', title: "The transcript couldn't be made", description: errText(e) }) } finally { setLoading(false) }
  }
  // after any edit the words move with the timeline (transcripts are cached, so this is quick)
  useEffect(() => { if (words) { setSel(new Set()); void load() } }, [version]) // eslint-disable-line react-hooks/exhaustive-deps

  const fillers = useMemo(() => (words ? fillerWords(words) : []), [words])
  const current = words ? words.findIndex((w) => playheadUs >= w.startUs && playheadUs < w.endUs) : -1

  const cut = async (list: TimelineWord[], what: string) => {
    if (!list.length) return
    if (await cutWords(list)) toast({ tone: 'success', title: `Cut ${list.length} ${what}`, description: 'Ctrl+Z puts them back.' })
  }
  const click = (i: number, e: React.MouseEvent) => {
    const w = words![i]!
    if (e.shiftKey && anchor.current !== null) {
      const [a, b] = [Math.min(anchor.current, i), Math.max(anchor.current, i)]
      setSel(new Set(Array.from({ length: b - a + 1 }, (_, k) => a + k)))
    } else if (e.ctrlKey || e.metaKey) {
      setSel((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n })
      anchor.current = i
    } else {
      setSel(new Set([i]))
      anchor.current = i
      seek(w.startUs)
    }
  }

  if (!words) {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-border p-3">
        <h3 className="text-sm">Edit by transcript</h3>
        <p className="text-sm text-muted">Delete words to cut them from the video, and remove “um”s and “uh”s in one go.</p>
        <Button size="sm" loading={loading} onClick={() => void load()}>Show transcript</Button>
      </div>
    )
  }
  const selected = [...sel].sort((a, b) => a - b).map((i) => words[i]!).filter(Boolean)
  return (
    <section aria-label="Transcript" className="flex flex-col gap-2 rounded-md border border-border p-3">
      <div className="flex items-center gap-2">
        <h3 className="flex-1 text-sm">Transcript</h3>
        <Button size="sm" variant="ghost" onClick={() => { setWords(null); setSel(new Set()) }}>Hide</Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" icon={<Scissors className="size-3.5" />} disabled={!selected.length} onClick={() => void cut(selected, selected.length === 1 ? 'word' : 'words')}>
          Cut {selected.length || ''} selected
        </Button>
        <Button size="sm" disabled={!fillers.length} onClick={() => void cut(fillers, fillers.length === 1 ? 'filler word' : 'filler words')}>Remove {fillers.length} filler{fillers.length === 1 ? '' : 's'}</Button>
      </div>
      {words.length === 0 ? (
        <EmptyState title="No speech on the main track" body="Add a clip with someone talking, then show the transcript again." />
      ) : (
        <div role="listbox" aria-label="Transcript words" aria-multiselectable tabIndex={0}
          onKeyDown={(e) => { if ((e.key === 'Delete' || e.key === 'Backspace') && selected.length) { e.preventDefault(); e.stopPropagation(); void cut(selected, selected.length === 1 ? 'word' : 'words') } }}
          className="flex max-h-[360px] flex-wrap gap-x-1 gap-y-0.5 overflow-y-auto text-md leading-relaxed focus-visible:outline-none">
          {words.map((w, i) => {
            const filler = isFiller(w.text)
            return (
              <span key={`${w.clipId}-${w.startUs}`} role="option" aria-selected={sel.has(i)} title={`${formatUs(w.startUs)}${filler ? ' · filler word' : ''}`}
                onMouseDown={(e) => e.preventDefault()} onClick={(e) => click(i, e)}
                className={`cursor-pointer rounded-xs px-0.5 hover:bg-surface-3 aria-selected:bg-accent aria-selected:text-on-accent ${i === current ? 'outline outline-1 outline-selection' : ''} ${filler ? 'text-warning underline decoration-dotted' : ''}`}>
                {w.text}
              </span>
            )
          })}
        </div>
      )}
      <p className="text-xs text-muted">Click to jump · Shift+click to select a run · Ctrl+click to pick words · Delete to cut</p>
    </section>
  )
}
