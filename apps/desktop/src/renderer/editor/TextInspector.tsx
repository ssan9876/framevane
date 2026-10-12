import { useEffect, useState } from 'react'
import { AlignCenter, AlignLeft, AlignRight, Bold, Captions, Download, Italic, Type, Underline, Volume2 } from 'lucide-react'
import { Button, ColorPicker, PanelHeader, Segmented, Select, SliderField, Switch, TabPanel, UnderlineTabs, useToast } from '@framevane/ui'
import {
  DEFAULT_CAPTION_STYLE, formatUs, TEXT_ANIMS,
  type AnimProp, type CaptionClip, type Easing, type TextAnimKind, type TextClip, type TextStyle, type Track,
} from '@framevane/doc'
import type { TtsVoice } from '../../shared/api'
import { useApp } from '../app/store'
import { localPlayhead } from './actions-m1'
import { speak } from './actions-m3'
import { FontPicker } from './FontPicker'
import { AnimSlider, KeyframeTools, useCommitted } from './Inspector'
import { CAPTION_PRESETS } from './textPresets'

/** S19 · Text: content, look, position (keyframable), in/out animation and text to speech. */
export function TextInspector({ clip, track }: { clip: TextClip; track: Track }) {
  const [tab, setTab] = useState('text')
  // a photo has no time: no in/out animation, and speech belongs to video
  const photo = useApp((s) => s.doc?.kind === 'photo')
  const apply = (op: { text?: string; style?: Partial<TextStyle>; anim?: { in?: { kind?: TextAnimKind; durationUs?: number }; out?: { kind?: TextAnimKind; durationUs?: number } } }) =>
    void useApp.getState().apply([{ type: 'set_text', clipId: clip.id, ...op }])
  return (
    <div className={track.locked ? 'pointer-events-none opacity-60' : ''}>
      <PanelHeader title={<span className="flex items-center gap-1.5"><Type className="size-3.5 text-muted" />Text</span>} />
      <UnderlineTabs tabs={photo ? [{ value: 'text', label: 'Text' }] : [{ value: 'text', label: 'Text' }, { value: 'animation', label: 'Animation' }, { value: 'speech', label: 'Speech' }]} value={tab} onValueChange={setTab}>
        <div className="flex flex-col gap-3 p-3">
          <TabPanel value="text" className="flex flex-col gap-3">
            <ContentBox value={clip.text} max={2000} label="Text" onCommit={(text) => apply({ text })} />
            <StyleControls style={clip.style} onStyle={(style) => apply({ style })} />
            <PositionControls clip={clip} />
          </TabPanel>
          <TabPanel value="animation" className="flex flex-col gap-3">
            <AnimPart label="In" part={clip.anim.in} max={clip.durationUs} onChange={(p) => apply({ anim: { in: p } })} />
            <AnimPart label="Out" part={clip.anim.out} max={clip.durationUs} onChange={(p) => apply({ anim: { out: p } })} />
            <p className="text-xs text-muted">For motion in between, key Position, Scale or Rotation on the Text tab.</p>
          </TabPanel>
          <TabPanel value="speech"><SpeechPanel text={clip.text} atUs={clip.startUs} /></TabPanel>
        </div>
      </UnderlineTabs>
    </div>
  )
}

/** S19 for captions: one line's text, and the look of the whole caption track. */
export function CaptionInspector({ clip, track }: { clip: CaptionClip; track: Track }) {
  const style = track.style ?? DEFAULT_CAPTION_STYLE
  const styleOp = (s: Partial<TextStyle>) => void useApp.getState().apply([{ type: 'set_track_style', trackId: track.id, style: s }])
  const [pos, setPos] = useCommitted(Math.round(style.y * 100), (v) => styleOp({ y: v / 100 }))
  const [hl, setHl] = useCommitted(style.highlightColor ?? '#ffd84d', (v) => styleOp({ highlightColor: v }), 400)
  return (
    <>
      <PanelHeader title={<span className="flex items-center gap-1.5"><Captions className="size-3.5 text-muted" />Caption</span>} />
      <div className="flex flex-col gap-3 p-3">
        <ContentBox value={clip.text} max={500} label={`Text (${formatUs(clip.startUs)}–${formatUs(clip.startUs + clip.durationUs)})`}
          onCommit={(text) => void useApp.getState().apply([{ type: 'set_caption_text', clipId: clip.id, text }])} />
        <h3 className="pt-1 text-sm text-muted">Style · applies to all captions</h3>
        <div role="group" aria-label="Caption presets" className="flex flex-wrap gap-1.5">
          {CAPTION_PRESETS.map((p) => <Button key={p.id} size="sm" onClick={() => styleOp(p.style)}>{p.name}</Button>)}
        </div>
        <StyleControls style={style} onStyle={styleOp} />
        <SliderField label="Height" value={pos} onChange={setPos} min={5} max={95} unit="%" defaultValue={Math.round(DEFAULT_CAPTION_STYLE.y * 100)} />
        <Switch label="Highlight the spoken word" checked={style.highlightColor !== null} onCheckedChange={(v) => styleOp({ highlightColor: v ? hl : null })} />
        {style.highlightColor !== null && <Row label="Highlight"><ColorPicker label="Highlight color" value={hl} onChange={setHl} /></Row>}
        <Switch label="One word at a time" checked={style.wordByWord} onCheckedChange={(v) => styleOp({ wordByWord: v })} />
      </div>
    </>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex items-center gap-3"><span className="w-[88px] shrink-0 text-sm text-muted">{label}</span>{children}</div>
}

function ContentBox({ value, max, label, onCommit }: { value: string; max: number; label: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  const commit = () => { if (text.trim() && text !== value) onCommit(text.trim()) }
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm text-muted">{label}</span>
      <textarea value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} maxLength={max} rows={3}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit() } }}
        className="resize-none rounded-sm border border-border-input bg-surface-2 p-2 text-md focus-visible:border-focus focus-visible:outline-none" />
      <span className="text-xs text-muted">Enter saves · Shift+Enter for a new line</span>
    </label>
  )
}

function Toggle({ label, pressed, onChange, icon }: { label: string; pressed: boolean; onChange: (v: boolean) => void; icon: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} aria-pressed={pressed} title={label} onClick={() => onChange(!pressed)}
      className="grid size-7 shrink-0 place-items-center rounded-sm text-muted hover:bg-surface-3 hover:text-fg aria-pressed:bg-accent-soft aria-pressed:text-fg [&_svg]:size-4">
      {icon}
    </button>
  )
}

/** "#rrggbb" + alpha 0–100 ⇄ "#rrggbbaa". */
const splitHex = (c: string) => ({ hex: c.slice(0, 7), alpha: c.length === 9 ? Math.round((parseInt(c.slice(7, 9), 16) / 255) * 100) : 100 })
const joinHex = (hex: string, alpha: number) => (alpha >= 100 ? hex : `${hex}${Math.round((alpha / 100) * 255).toString(16).padStart(2, '0')}`)

/** Font, weight, emphasis, size, colours, outline, shadow, box, spacing, alignment. Shared by text and captions. */
export function StyleControls({ style, onStyle }: { style: TextStyle; onStyle: (patch: Partial<TextStyle>) => void }) {
  const [size, setSize] = useCommitted(style.fontSize, (v) => onStyle({ fontSize: v }))
  const [color, setColor] = useCommitted(style.color, (v) => onStyle({ color: v }), 400)
  const [stroke, setStroke] = useCommitted(style.strokeWidth, (v) => onStyle({ strokeWidth: v }))
  const [strokeColor, setStrokeColor] = useCommitted(style.strokeColor, (v) => onStyle({ strokeColor: v }), 400)
  const sh = style.shadow ?? { color: '#000000', blur: 12, x: 0, y: 4 }
  const [shColor, setShColor] = useCommitted(sh.color, (v) => onStyle({ shadow: { ...sh, color: v } }), 400)
  const [shBlur, setShBlur] = useCommitted(sh.blur, (v) => onStyle({ shadow: { ...sh, blur: v } }))
  const bg = splitHex(style.background ?? '#000000b3')
  const [bgColor, setBgColor] = useCommitted(bg.hex, (v) => onStyle({ background: joinHex(v, bg.alpha) }), 400)
  const [bgAlpha, setBgAlpha] = useCommitted(bg.alpha, (v) => onStyle({ background: joinHex(bg.hex, v) }))
  const [radius, setRadius] = useCommitted(Math.round(style.backgroundRadius * 100), (v) => onStyle({ backgroundRadius: v / 100 }))
  const [spacing, setSpacing] = useCommitted(style.letterSpacing, (v) => onStyle({ letterSpacing: v }))
  const [lineH, setLineH] = useCommitted(Math.round(style.lineHeight * 100), (v) => onStyle({ lineHeight: v / 100 }))
  return (
    <div className="flex flex-col gap-2">
      <FontPicker value={style.fontFamily} onChange={(fontFamily) => onStyle({ fontFamily })} />
      <div className="flex items-center gap-1">
        <Select label="Weight" hideLabel width={110} value={String(style.fontWeight)} onValueChange={(v) => onStyle({ fontWeight: Number(v) })}
          options={[{ value: '300', label: 'Light' }, { value: '400', label: 'Regular' }, { value: '500', label: 'Medium' }, { value: '600', label: 'Semibold' }, { value: '700', label: 'Bold' }, { value: '800', label: 'Extra bold' }, { value: '900', label: 'Black' }]} />
        <Toggle label="Bold" pressed={style.fontWeight >= 700} onChange={(v) => onStyle({ fontWeight: v ? 700 : 400 })} icon={<Bold />} />
        <Toggle label="Italic" pressed={style.italic} onChange={(v) => onStyle({ italic: v })} icon={<Italic />} />
        <Toggle label="Underline" pressed={style.underline} onChange={(v) => onStyle({ underline: v })} icon={<Underline />} />
      </div>
      <div className="flex items-center gap-3">
        <span className="w-[88px] shrink-0 text-sm text-muted">Alignment</span>
        <Segmented label="Alignment" size="sm" value={style.align} onValueChange={(v) => onStyle({ align: v as TextStyle['align'] })}
          options={[{ value: 'left', label: '', icon: <AlignLeft aria-label="Left" /> }, { value: 'center', label: '', icon: <AlignCenter aria-label="Center" /> }, { value: 'right', label: '', icon: <AlignRight aria-label="Right" /> }]} />
      </div>
      <SliderField label="Size" value={size} onChange={setSize} min={12} max={400} unit="px" defaultValue={DEFAULT_CAPTION_STYLE.fontSize} />
      <Row label="Color"><ColorPicker label="Text color" value={color} onChange={setColor} /></Row>
      <SliderField label="Outline" value={stroke} onChange={setStroke} min={0} max={30} unit="px" defaultValue={0} />
      {stroke > 0 && <Row label="Outline color"><ColorPicker label="Outline color" value={strokeColor} onChange={setStrokeColor} /></Row>}
      <Switch label="Shadow" checked={!!style.shadow} onCheckedChange={(v) => onStyle({ shadow: v ? sh : null })} />
      {style.shadow && <>
        <Row label="Shadow color"><ColorPicker label="Shadow color" value={shColor} onChange={setShColor} /></Row>
        <SliderField label="Softness" value={shBlur} onChange={setShBlur} min={0} max={60} unit="px" defaultValue={12} />
      </>}
      <Switch label="Background box" checked={!!style.background} onCheckedChange={(v) => onStyle({ background: v ? joinHex(bg.hex, bg.alpha) : null })} />
      {style.background && <>
        <Row label="Box color"><ColorPicker label="Box color" value={bgColor} onChange={setBgColor} /></Row>
        <SliderField label="Box opacity" value={bgAlpha} onChange={setBgAlpha} min={0} max={100} unit="%" defaultValue={70} />
        <SliderField label="Roundness" value={radius} onChange={setRadius} min={0} max={100} unit="%" defaultValue={20} />
      </>}
      <SliderField label="Letter spacing" value={spacing} onChange={setSpacing} min={-20} max={80} unit="px" defaultValue={0} bipolar />
      <SliderField label="Line height" value={lineH} onChange={setLineH} min={60} max={300} unit="%" defaultValue={118} />
    </div>
  )
}

function PositionControls({ clip }: { clip: TextClip }) {
  const photo = useApp((s) => s.doc?.kind === 'photo')
  const playheadUs = useApp((s) => s.playheadUs)
  const doc = useApp((s) => s.doc)!
  const local = localPlayhead(clip, playheadUs)
  const keysHere = (Object.entries(clip.keyframes) as [AnimProp, { tUs: number; value: number; easing: Easing }[] | undefined][])
    .flatMap(([prop, kfs]) => (kfs ?? []).filter((k) => Math.abs(k.tUs - local) <= 16_666).map((k) => ({ prop, ...k })))
  const animated = Object.values(clip.keyframes).some((k) => k?.length)
  return (
    <div className="flex flex-col gap-1.5 border-t border-border pt-3">
      <h3 className="text-sm text-muted">Position</h3>
      <AnimSlider clip={clip} prop="x" label="Position X" min={-doc.canvas.width} max={doc.canvas.width} unit="px" defaultValue={0} bipolar />
      <AnimSlider clip={clip} prop="y" label="Position Y" min={-doc.canvas.height} max={doc.canvas.height} unit="px" defaultValue={0} bipolar />
      <AnimSlider clip={clip} prop="scale" label="Scale" min={5} max={400} unit="%" toUi={(v) => Math.round(v * 100)} fromUi={(v) => v / 100} defaultValue={100} />
      <AnimSlider clip={clip} prop="rotation" label="Rotation" min={-180} max={180} unit="°" defaultValue={0} bipolar />
      <AnimSlider clip={clip} prop="opacity" label="Opacity" min={0} max={100} unit="%" toUi={(v) => Math.round(v * 100)} fromUi={(v) => v / 100} defaultValue={100} />
      {!photo && <KeyframeTools clip={clip} keysHere={keysHere} animated={animated} local={local} />}
    </div>
  )
}

const ANIM_LABELS: Record<TextAnimKind, string> = {
  none: 'None', fade: 'Fade', 'slide-up': 'Slide up', 'slide-down': 'Slide down', 'slide-left': 'Slide left', 'slide-right': 'Slide right',
  pop: 'Pop', 'zoom-out': 'Zoom', typewriter: 'Typewriter', wipe: 'Wipe',
}

function AnimPart({ label, part, max, onChange }: { label: string; part: { kind: TextAnimKind; durationUs: number }; max: number; onChange: (p: { kind?: TextAnimKind; durationUs?: number }) => void }) {
  const [dur, setDur] = useCommitted(Math.round(part.durationUs / 100_000) / 10, (v) => onChange({ durationUs: Math.round(v * 1e6) }))
  return (
    <section aria-label={`${label} animation`} className="flex flex-col gap-2">
      <Select label={`${label} animation`} value={part.kind} width={150} onValueChange={(v) => onChange({ kind: v as TextAnimKind })}
        options={TEXT_ANIMS.map((k) => ({ value: k, label: ANIM_LABELS[k] }))} />
      {part.kind !== 'none' && <SliderField label={`${label} length`} value={dur} onChange={setDur} min={0.1} max={Math.max(0.2, Math.min(5, max / 2e6))} step={0.1} precision={1} unit="s" defaultValue={0.5} />}
    </section>
  )
}

/** Text to speech: pick a voice, generate, and the audio lands on an audio track at the text's start. */
export function SpeechPanel({ text, atUs }: { text: string; atUs: number }) {
  const [voices, setVoices] = useState<TtsVoice[] | null>(null)
  const [voice, setVoice] = useState<string>(() => { try { return localStorage.getItem('framevane.voice') ?? '' } catch { return '' } })
  const [speed, setSpeed] = useState(100)
  const [busy, setBusy] = useState<'install' | 'speak' | null>(null)
  const toast = useToast()
  const load = () => window.framevane.tts.voices().then((v) => { setVoices(v); if (!v.some((x) => x.id === voice)) setVoice((v.find((x) => x.ready) ?? v[0])?.id ?? '') })
  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const current = voices?.find((v) => v.id === voice)
  const kokoroMissing = voices?.some((v) => v.engine === 'kokoro' && !v.ready)

  async function install() {
    setBusy('install')
    try { await window.framevane.tts.installKokoro(); await load(); toast({ tone: 'success', title: 'Natural voices are ready' }) }
    catch (e) { toast({ tone: 'error', title: "The voices couldn't be downloaded", description: e instanceof Error ? e.message : String(e) }) }
    finally { setBusy(null) }
  }
  async function generate() {
    if (!current) return
    setBusy('speak')
    try {
      try { localStorage.setItem('framevane.voice', current.id) } catch { /* remembered for this session */ }
      if (await speak(text, current.id, speed / 100, atUs)) toast({ tone: 'success', title: 'Speech added', description: `${current.name} · on an audio track at ${formatUs(atUs)}` })
    } catch (e) {
      toast({ tone: 'error', title: "Speech couldn't be generated", description: e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e) })
    } finally { setBusy(null) }
  }

  if (!voices) return <p className="text-sm text-muted">Loading voices…</p>
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">Reads the text aloud and puts the audio under it. Runs on your computer, free.</p>
      <Select label="Voice" value={voice} width={210} onValueChange={setVoice}
        options={voices.map((v) => ({ value: v.id, label: v.name, hint: `${v.engine === 'kokoro' ? 'natural' : 'Windows'} · ${v.language}`, disabled: !v.ready }))} />
      {kokoroMissing && (
        <div className="flex items-center gap-2 rounded-md border border-border p-2 text-sm">
          <span className="flex-1 text-muted">Natural voices need a one-time 120 MB download.</span>
          <Button size="sm" icon={<Download className="size-3.5" />} loading={busy === 'install'} onClick={() => void install()}>Download</Button>
        </div>
      )}
      <SliderField label="Speed" value={speed} onChange={setSpeed} min={50} max={200} step={5} unit="%" defaultValue={100} />
      <Button variant="primary" icon={<Volume2 className="size-3.5" />} loading={busy === 'speak'} disabled={!current?.ready || !text.trim()} onClick={() => void generate()}>Generate speech</Button>
    </div>
  )
}
