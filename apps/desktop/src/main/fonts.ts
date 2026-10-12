import { execFile } from 'node:child_process'
import { copyFile, mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { CustomFont } from '../shared/api'

/**
 * Fonts for text: families installed in Windows (Chromium draws them by name, nothing to load) and font files the user
 * imports, copied into the app's fonts folder and served to the window as framevane-media://font/<file>.
 */

const FONT_EXTS = new Set(['.ttf', '.otf', '.woff', '.woff2'])

export class Fonts {
  private system: Promise<string[]> | null = null

  constructor(private dir: string) {}

  /** Installed font family names (once per session; ~1 s the first time). */
  systemFamilies(): Promise<string[]> {
    this.system ??= new Promise((resolve) => {
      if (process.platform !== 'win32') return resolve([])
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Add-Type -AssemblyName System.Drawing; (New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }'],
      { windowsHide: true, timeout: 20_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
        if (err) return resolve([])
        resolve([...new Set(stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)))
      })
    })
    return this.system
  }

  async custom(): Promise<CustomFont[]> {
    await mkdir(this.dir, { recursive: true })
    const files = (await readdir(this.dir)).filter((f) => FONT_EXTS.has(extname(f).toLowerCase())).sort()
    return Promise.all(files.map(async (file) => {
      const meta = await readFile(join(this.dir, file)).then(parseFontMeta).catch(() => null)
      const fallback = basename(file, extname(file)).replace(/[-_]+/g, ' ')
      return { file, family: meta?.family || fallback, weight: meta?.weight ?? 400, style: meta?.italic ? 'italic' : 'normal', url: `framevane-media://font/${encodeURIComponent(file)}` } satisfies CustomFont
    }))
  }

  /** Copy font files into the fonts folder. Returns the fonts now available. */
  async import(paths: string[]): Promise<CustomFont[]> {
    await mkdir(this.dir, { recursive: true })
    for (const p of paths) {
      if (!FONT_EXTS.has(extname(p).toLowerCase())) throw new Error(`${basename(p)} is not a font file (.ttf, .otf, .woff, .woff2)`)
      await copyFile(p, join(this.dir, basename(p)))
    }
    return this.custom()
  }

  async remove(file: string) {
    await rm(this.path(file) ?? '', { force: true })
  }

  /** Absolute path of an imported font, or null for anything outside the fonts folder. */
  path(file: string): string | null {
    const name = basename(file)
    return name === file && FONT_EXTS.has(extname(name).toLowerCase()) ? join(this.dir, name) : null
  }
}

/** Family, weight and italic from a TTF/OTF file's name and OS/2 tables (null for collections and web fonts). */
export function parseFontMeta(buf: Buffer): { family: string; weight: number; italic: boolean } | null {
  if (buf.length < 12) return null
  const tag = buf.toString('latin1', 0, 4)
  if (!(buf.readUInt32BE(0) === 0x00010000 || tag === 'OTTO' || tag === 'true')) return null
  const numTables = buf.readUInt16BE(4)
  const tables = new Map<string, { offset: number; length: number }>()
  for (let i = 0; i < numTables; i++) {
    const r = 12 + i * 16
    if (r + 16 > buf.length) return null
    tables.set(buf.toString('latin1', r, r + 4), { offset: buf.readUInt32BE(r + 8), length: buf.readUInt32BE(r + 12) })
  }
  const name = tables.get('name')
  if (!name) return null
  const count = buf.readUInt16BE(name.offset + 2)
  const strings = name.offset + buf.readUInt16BE(name.offset + 4)
  const found = new Map<number, { score: number; text: string }>()
  for (let i = 0; i < count; i++) {
    const r = name.offset + 6 + i * 12
    const platform = buf.readUInt16BE(r)
    const lang = buf.readUInt16BE(r + 4)
    const id = buf.readUInt16BE(r + 6)
    if (id !== 1 && id !== 16) continue
    const len = buf.readUInt16BE(r + 8)
    const off = strings + buf.readUInt16BE(r + 10)
    if (off + len > buf.length) continue
    let text: string
    let score: number
    if (platform === 3 || platform === 0) {
      const b = Buffer.from(buf.subarray(off, off + len))
      b.swap16()
      text = b.toString('utf16le')
      score = platform === 3 && lang === 0x409 ? 3 : 2
    } else if (platform === 1) {
      text = buf.toString('latin1', off, off + len)
      score = 1
    } else continue
    const prev = found.get(id)
    if (!prev || score > prev.score) found.set(id, { score, text: text.trim() })
  }
  const family = found.get(16)?.text || found.get(1)?.text
  if (!family) return null
  let weight = 400
  let italic = false
  const os2 = tables.get('OS/2')
  if (os2 && os2.offset + 64 <= buf.length) {
    weight = buf.readUInt16BE(os2.offset + 4) || 400
    italic = (buf.readUInt16BE(os2.offset + 62) & 1) === 1
  }
  return { family, weight: Math.min(1000, Math.max(1, weight)), italic }
}
