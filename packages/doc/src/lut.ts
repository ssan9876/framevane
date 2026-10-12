/**
 * .cube 3D LUTs (the Adobe/Resolve text format): `LUT_3D_SIZE N`, optional DOMAIN_MIN/MAX, then N³ "r g b" rows with
 * red changing fastest. Values come back scaled to the 0…1 domain.
 */

export interface Lut3D { title: string; size: number; data: Float32Array }

export class LutError extends Error {}

export function parseCube(text: string): Lut3D {
  let title = ''
  let size = 0
  let min = [0, 0, 0]
  let max = [1, 1, 1]
  let data: Float32Array | null = null
  let n = 0
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const parts = line.split(/\s+/)
    const key = parts[0]!.toUpperCase()
    if (key === 'TITLE') { title = line.slice(5).trim().replace(/^"|"$/g, ''); continue }
    if (key === 'LUT_1D_SIZE') throw new LutError('This is a 1D LUT. Only 3D .cube LUTs are supported.')
    if (key === 'LUT_3D_SIZE') {
      size = Number(parts[1])
      if (!Number.isInteger(size) || size < 2 || size > 65) throw new LutError(`LUT size ${parts[1]} is not supported (2–65).`)
      data = new Float32Array(size * size * size * 3)
      continue
    }
    if (key === 'DOMAIN_MIN' || key === 'DOMAIN_MAX') {
      const v = parts.slice(1, 4).map(Number)
      if (v.length !== 3 || v.some((x) => !Number.isFinite(x))) throw new LutError(`Bad ${key} line.`)
      if (key === 'DOMAIN_MIN') min = v; else max = v
      continue
    }
    if (/^[A-Z_]+$/.test(key)) continue // other keywords (LUT_IN_VIDEO_RANGE, …)
    if (!data) throw new LutError('LUT_3D_SIZE must come before the table.')
    if (parts.length < 3) throw new LutError(`Bad table row: "${line.slice(0, 40)}"`)
    if (n >= data.length) throw new LutError('The table has more rows than LUT_3D_SIZE says.')
    for (let c = 0; c < 3; c++) {
      const v = Number(parts[c])
      if (!Number.isFinite(v)) throw new LutError(`Bad table row: "${line.slice(0, 40)}"`)
      data[n++] = (v - min[c]!) / ((max[c]! - min[c]!) || 1)
    }
  }
  if (!data) throw new LutError('Not a 3D .cube LUT (no LUT_3D_SIZE).')
  if (n !== data.length) throw new LutError(`The table has ${n / 3} rows; LUT_3D_SIZE ${size} needs ${size ** 3}.`)
  return { title, size, data }
}

/** Look up a colour (0…1) with trilinear interpolation. For tests and CPU previews; the renderer samples on the GPU. */
export function sampleLut(lut: Lut3D, r: number, g: number, b: number): [number, number, number] {
  const N = lut.size
  const f = (v: number) => Math.max(0, Math.min(1, v)) * (N - 1)
  const [x, y, z] = [f(r), f(g), f(b)]
  const [x0, y0, z0] = [Math.floor(x), Math.floor(y), Math.floor(z)]
  const [x1, y1, z1] = [Math.min(N - 1, x0 + 1), Math.min(N - 1, y0 + 1), Math.min(N - 1, z0 + 1)]
  const [dx, dy, dz] = [x - x0, y - y0, z - z0]
  const at = (i: number, j: number, k: number, c: number) => lut.data[(i + j * N + k * N * N) * 3 + c]!
  const out: [number, number, number] = [0, 0, 0]
  for (let c = 0; c < 3; c++) {
    const c00 = at(x0, y0, z0, c) * (1 - dx) + at(x1, y0, z0, c) * dx
    const c10 = at(x0, y1, z0, c) * (1 - dx) + at(x1, y1, z0, c) * dx
    const c01 = at(x0, y0, z1, c) * (1 - dx) + at(x1, y0, z1, c) * dx
    const c11 = at(x0, y1, z1, c) * (1 - dx) + at(x1, y1, z1, c) * dx
    out[c] = (c00 * (1 - dy) + c10 * dy) * (1 - dz) + (c01 * (1 - dy) + c11 * dy) * dz
  }
  return out
}
