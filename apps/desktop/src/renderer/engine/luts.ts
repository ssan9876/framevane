import { parseCube, type Lut3D, type Project } from '@framevane/doc'

/**
 * LUT tables for the compositor. Files are loaded (and parsed) before a frame is drawn, so drawing stays synchronous:
 * ensureLuts() before render/export, lutFor() inside drawFrame.
 */

const loading = new Map<string, Promise<Lut3D | null>>()
const ready = new Map<string, Lut3D>()

export function lutFor(doc: Project, lutId: string): { key: string; lut: Lut3D } | null {
  const ref = doc.luts[lutId]
  if (!ref) return null
  const lut = ready.get(ref.file)
  return lut ? { key: ref.file, lut } : null
}

/** Load every LUT the project's clips use (cached by file; files never change once imported). */
export async function ensureLuts(doc: Project) {
  const files = new Set<string>()
  for (const t of doc.tracks) for (const c of t.clips) if ((c.kind === 'video' || c.kind === 'image') && c.lut) { const r = doc.luts[c.lut.id]; if (r) files.add(r.file) }
  await Promise.all([...files].map((f) => load(f)))
}

export function load(file: string): Promise<Lut3D | null> {
  let p = loading.get(file)
  if (!p) {
    p = window.framevane.luts.read(file).then((text) => {
      const lut = parseCube(text)
      ready.set(file, lut)
      return lut
    }).catch((e) => { console.warn('[luts]', file, e); loading.delete(file); return null })
    loading.set(file, p)
  }
  return p
}
