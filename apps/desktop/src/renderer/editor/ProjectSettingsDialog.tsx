import { useState } from 'react'
import { Button, Dialog, Select, TextField } from '@reel/ui'
import { useApp } from '../app/store'

const RATIOS = [
  { value: '16:9', label: '16:9 · Landscape', w: 16, h: 9 },
  { value: '9:16', label: '9:16 · Vertical (Shorts, Reels, TikTok)', w: 9, h: 16 },
  { value: '1:1', label: '1:1 · Square', w: 1, h: 1 },
  { value: '4:5', label: '4:5 · Portrait feed', w: 4, h: 5 },
  { value: '4:3', label: '4:3', w: 4, h: 3 },
  { value: '21:9', label: '21:9 · Cinema', w: 21, h: 9 },
]

/** S02 · Project settings ("Modify"): name, aspect ratio, resolution, frame rate. */
export function ProjectSettingsDialog() {
  const doc = useApp((s) => s.doc)!
  const [name, setName] = useState(doc.name)
  const g = gcd(doc.canvas.width, doc.canvas.height)
  const currentRatio = `${doc.canvas.width / g}:${doc.canvas.height / g}`
  const [ratio, setRatio] = useState(RATIOS.some((r) => r.value === currentRatio) ? currentRatio : 'custom')
  const [short, setShort] = useState(String(Math.min(doc.canvas.width, doc.canvas.height)))
  const [fps, setFps] = useState(String(Math.round(doc.canvas.fps.num / doc.canvas.fps.den)))
  const close = () => useApp.getState().openDialog(null)
  const r = RATIOS.find((x) => x.value === ratio)
  const s = Number(short)
  const W = r ? even(r.w >= r.h ? (s * r.w) / r.h : s) : doc.canvas.width
  const H = r ? even(r.w >= r.h ? s : (s * r.h) / r.w) : doc.canvas.height

  async function save() {
    if (name.trim() && name.trim() !== doc.name) await window.reel.projects.rename(doc.id, name)
    await useApp.getState().apply([{ type: 'set_canvas', canvas: { width: W, height: H, fps: { num: Number(fps), den: 1 } } }])
    close()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && close()} title="Project settings" description="Changing the ratio keeps your clips centered; nothing is cropped." width={460}
      footer={<><Button variant="ghost" onClick={close}>Cancel</Button><Button variant="primary" onClick={() => void save()}>Save</Button></>}>
      <div className="flex flex-col gap-3">
        <TextField label="Project name" value={name} onChange={(e) => setName(e.target.value)} />
        <Select label="Aspect ratio" value={ratio} onValueChange={setRatio} width={280} options={[...RATIOS, ...(ratio === 'custom' ? [{ value: 'custom', label: `Custom (${doc.canvas.width}×${doc.canvas.height})` }] : [])]} />
        <Select label="Resolution" value={short} onValueChange={setShort} width={140} disabled={!r} options={['720', '1080', '1440', '2160'].map((v) => ({ value: v, label: `${v}p` }))} />
        <Select label="Frame rate" value={fps} onValueChange={setFps} width={140} options={['24', '25', '30', '50', '60'].map((v) => ({ value: v, label: `${v} fps` }))} />
        <p className="text-sm text-muted">Canvas: {W}×{H}</p>
      </div>
    </Dialog>
  )
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)
