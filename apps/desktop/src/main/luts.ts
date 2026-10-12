import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { parseCube, type LutRef } from '@framevane/doc'

/**
 * Imported .cube LUTs, kept in the app's luts folder under a content hash (the same file imported twice is one file,
 * and projects that use it keep working if the original is moved). Projects reference them by file name.
 */
export class Luts {
  private dir: string
  constructor(userData: string) {
    this.dir = join(userData, 'luts')
    mkdirSync(this.dir, { recursive: true })
  }

  /** Validate and copy .cube files in. Throws with the file's name if one isn't a usable 3D LUT. */
  async import(paths: string[]): Promise<LutRef[]> {
    const out: LutRef[] = []
    for (const p of paths) {
      if (!/\.cube$/i.test(p)) throw new Error(`${basename(p)} is not a .cube file`)
      if ((await stat(p)).size > 64 * 1024 * 1024) throw new Error(`${basename(p)} is too large for a LUT`)
      const text = await readFile(p, 'utf8')
      try { parseCube(text) } catch (e) { throw new Error(`${basename(p)}: ${e instanceof Error ? e.message : String(e)}`) }
      const hash = createHash('sha256').update(text).digest('hex').slice(0, 16)
      const file = `${hash}.cube`
      await writeFile(join(this.dir, file), text, 'utf8')
      out.push({ id: `lut-${hash.slice(0, 12)}`, name: basename(p).replace(/\.cube$/i, ''), file })
    }
    return out
  }

  /** The text of an imported LUT (only names this module wrote: hash.cube). */
  read(file: string): Promise<string> {
    if (!/^[0-9a-f]{16}\.cube$/.test(file)) return Promise.reject(new Error('Unknown LUT'))
    return readFile(join(this.dir, file), 'utf8')
  }
}
