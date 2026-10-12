import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { a11y, clips, expect, newProjectFromFiles, previewPixel, test, timeline } from '../fixtures'
import { files } from '../global-setup'

/** Milestone 4: filters, LUTs, basic colour, effects, transitions, chroma key; preview and export; agent tools. */

const props = (page: Page) => page.getByRole('region', { name: 'Properties' })
const assets = (page: Page) => page.getByRole('region', { name: 'Media and assets' })
const assetTab = (page: Page, name: string) => assets(page).getByRole('tab', { name, exact: true })
const propTab = (page: Page, name: string) => props(page).getByRole('tab', { name, exact: true })
async function setField(scope: ReturnType<typeof props>, label: string, value: string) {
  const f = scope.getByRole('spinbutton', { name: label, exact: true })
  await f.fill(value)
  await f.press('Enter')
  await scope.page().waitForTimeout(450) // inspector commits 250 ms after the last change
}
async function seekSeconds(page: Page, s: number) {
  await timeline(page).click({ position: { x: 160, y: 10 } })
  await page.keyboard.press('Home')
  for (let i = 0; i < s; i++) await page.keyboard.press('Shift+ArrowRight')
}
async function openProject(page: Page, name: string, paths: string[]) {
  await page.evaluate(async ({ name, paths }) => { await window.framevane.projects.create({ name, files: paths }) }, { name, paths })
  await page.reload()
  await page.getByRole('button', { name: `Open ${name}` }).click()
  await expect(clips(page)).toHaveCount(paths.length)
}
/** The first colour bar of the talk video (red) at mid height. */
const bar = (page: Page) => previewPixel(page, 0.06, 0.5).then((p) => p!.rgba as [number, number, number, number])
const isRed = ([r, g, b]: number[]) => r! > 120 && r! - b! > 80 && r! - g! > 60
const isGrey = ([r, g, b]: number[]) => Math.abs(r! - g!) < 14 && Math.abs(g! - b!) < 14
const dist = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!)

test.describe('M4 colour', () => {
  test.use({ pickFiles: [files.lut] })

  test('filters, basic colour and a .cube LUT change the picture; undo and reset restore it', async ({ framevane }) => {
    const { page } = framevane
    await openProject(page, 'M4 colour', [files.talk])
    expect(await page.evaluate(() => (window as unknown as { framevaneDiagnostics: { lookShaders(): string[] } }).framevaneDiagnostics.lookShaders())).toEqual([])
    await clips(page).first().click()
    await expect.poll(() => bar(page).then(isRed)).toBe(true)

    await assetTab(page, 'Filters').click()
    expect(await a11y(page, 'S10 filters')).toEqual([])
    await assets(page).getByRole('button', { name: 'Mono filter' }).click()
    await expect(assets(page).getByRole('button', { name: 'Mono filter' })).toHaveAttribute('aria-pressed', 'true')
    await propTab(page, 'Adjust').click()
    await expect(props(page).getByText('Mono', { exact: true })).toBeVisible()
    await setField(props(page), 'Strength', '100')
    await expect.poll(() => bar(page).then(isGrey)).toBe(true)
    expect(await a11y(page, 'S18 adjust')).toEqual([])
    await props(page).getByRole('button', { name: 'Remove' }).click()
    await expect.poll(() => bar(page).then(isRed)).toBe(true)

    await setField(props(page), 'Saturation', '-100')
    await expect.poll(() => bar(page).then(isGrey)).toBe(true)
    await expect(timeline(page).getByRole('gridcell', { name: /talk\.mp4.*colour/ })).toBeVisible()
    await props(page).getByRole('button', { name: 'Reset colour' }).click()
    await expect.poll(() => bar(page).then(isRed)).toBe(true)

    // LUT: the test file swaps red and blue
    await assets(page).getByRole('button', { name: 'Import .cube' }).click()
    await expect(assets(page).getByRole('button', { name: 'Swap RB LUT' })).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => bar(page).then(([r, , b]) => b! - r! > 80)).toBe(true)
    await expect(props(page).getByRole('combobox', { name: 'LUT' })).toContainText('Swap RB')
    await page.keyboard.press('Control+z')
    await expect.poll(() => bar(page).then(isRed)).toBe(true)
    await expect(assets(page).getByRole('button', { name: 'Swap RB LUT' })).toBeVisible() // still imported
    // a 1D LUT is refused with a reason
    const err = await page.evaluate((p) => window.framevane.luts.import([p]).then(() => 'ok', (e: Error) => e.message), files.lut1d)
    expect(err).toMatch(/1D LUT/)
  })
})

test.describe('M4 effects', () => {
  test.use({ pickFiles: [files.talk] })

  test('add, tune, reorder and remove effects', async ({ framevane }) => {
    const { page } = framevane
    await newProjectFromFiles(page)
    await clips(page).first().click()
    await assetTab(page, 'Effects').click()
    expect(await a11y(page, 'S08 effects')).toEqual([])
    await assets(page).getByRole('button', { name: 'Add Pixelate effect' }).click()
    await assets(page).getByRole('button', { name: 'Add Invert effect' }).click()
    await propTab(page, 'Effects').click()
    const list = props(page).getByRole('list', { name: 'Effects on this clip' })
    await expect(list.getByRole('listitem')).toHaveCount(2)
    await expect(list.getByRole('listitem').first()).toContainText('Pixelate')
    await setField(props(page), 'Size', '80')
    expect(await a11y(page, 'S14 effects inspector')).toEqual([])
    // the red bar, inverted, is cyan
    await expect.poll(() => bar(page).then(([r, , b]) => b! - r! > 80)).toBe(true)
    await props(page).getByRole('button', { name: 'Move Invert up' }).click()
    await expect(list.getByRole('listitem').first()).toContainText('Invert')
    await props(page).getByRole('button', { name: 'Remove Invert' }).click()
    await expect(list.getByRole('listitem')).toHaveCount(1)
    await expect.poll(() => bar(page).then(isRed)).toBe(true)
    await expect(timeline(page).getByRole('gridcell', { name: /talk\.mp4.*fx/ })).toBeVisible()
    await page.keyboard.press('Control+z')
    await expect(list.getByRole('listitem')).toHaveCount(2)
  })
})

test.describe('M4 transitions', () => {
  test.use({ pickFiles: [files.talk, files.broll, files.still] })

  test('a transition on a cut plays between the clips; apply to all; remove', async ({ framevane }) => {
    const { page } = framevane
    await newProjectFromFiles(page)
    await expect(clips(page)).toHaveCount(3)
    await seekSeconds(page, 29) // the cut is at 29.13 s
    const plain = (await previewPixel(page, 0.5, 0.5))!.rgba
    await clips(page).first().click()
    await assetTab(page, 'Transitions').click()
    expect(await a11y(page, 'S09 transitions')).toEqual([])
    await assets(page).getByRole('button', { name: 'Dissolve transition' }).click()
    await expect(assets(page).getByText('Cut after talk.mp4')).toBeVisible()
    await setField(assets(page), 'Duration', '2')
    await expect(timeline(page).getByRole('gridcell', { name: /talk\.mp4.*Dissolve transition into the next clip/ })).toBeVisible()
    await seekSeconds(page, 29)
    await expect.poll(async () => dist((await previewPixel(page, 0.5, 0.5))!.rgba, plain)).toBeGreaterThan(30)

    await clips(page).first().click()
    await assets(page).getByRole('button', { name: 'Apply to all cuts' }).click()
    await expect(page.getByText('Applied to 2 cuts')).toBeVisible()
    await expect(timeline(page).getByRole('gridcell', { name: /Dissolve transition into the next clip/ })).toHaveCount(2)
    await assets(page).getByRole('button', { name: 'Remove' }).click()
    await expect(timeline(page).getByRole('gridcell', { name: /Dissolve transition into the next clip/ })).toHaveCount(1)
    await seekSeconds(page, 29)
    await expect.poll(async () => dist((await previewPixel(page, 0.5, 0.5))!.rgba, plain)).toBeLessThan(12)
  })
})

test.describe('M4 chroma key', () => {
  test.use({ pickFiles: [files.greenscreen] })

  test('keying the green screen makes it see-through', async ({ framevane }) => {
    const { page } = framevane
    await newProjectFromFiles(page)
    const corner = () => previewPixel(page, 0.05, 0.05).then((p) => p!.rgba)
    await expect.poll(async () => (await corner())[1]!).toBeGreaterThan(150)
    await clips(page).first().click()
    await props(page).getByRole('radio', { name: 'Remove BG' }).click()
    await props(page).getByRole('switch', { name: /Chroma key/ }).click()
    await expect(props(page).getByRole('spinbutton', { name: 'Intensity' })).toBeVisible()
    await expect.poll(async () => Math.max(...(await corner()).slice(0, 3))).toBeLessThan(20)
    // the test card in the middle stays (most of it is not near green)
    const kept = await page.evaluate(() => {
      const c = document.querySelector('canvas[role="img"]') as HTMLCanvasElement
      const d = c.getContext('2d')!.getImageData(Math.round(c.width * 0.33), Math.round(c.height * 0.27), Math.round(c.width * 0.34), Math.round(c.height * 0.46)).data
      let n = 0
      for (let i = 0; i < d.length; i += 4) if (Math.max(d[i]!, d[i + 1]!, d[i + 2]!) > 40) n++
      return n / (d.length / 4)
    })
    expect(kept).toBeGreaterThan(0.6)
    expect(await a11y(page, 'S14 chroma key')).toEqual([])
    await expect(timeline(page).getByRole('gridcell', { name: /greenscreen\.mp4.*key/ })).toBeVisible()
    await props(page).getByRole('switch', { name: /Chroma key/ }).click()
    await expect.poll(async () => (await corner())[1]!).toBeGreaterThan(150)
  })
})

test.describe('M4 export', () => {
  test.use({ pickFiles: [files.talk] })

  test('the exported video has the look the preview shows', async ({ framevane }) => {
    const { page } = framevane
    await newProjectFromFiles(page)
    await clips(page).first().click()
    await assetTab(page, 'Filters').click()
    await assets(page).getByRole('button', { name: 'Mono filter' }).click()
    await propTab(page, 'Adjust').click()
    await setField(props(page), 'Strength', '100')
    await expect.poll(() => bar(page).then(isGrey)).toBe(true)
    await page.getByRole('button', { name: 'Export', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Export', exact: true })
    await dialog.getByRole('button', { name: 'Export…' }).click()
    await expect(page.getByText('Your video is ready').first()).toBeVisible({ timeout: 300_000 })
    const mp4 = readdirSync(framevane.exportsDir).find((f) => f.endsWith('.mp4'))!
    // one pixel row through the bars at 1 s, as RGB
    const r = spawnSync('ffmpeg', ['-v', 'error', '-ss', '1', '-i', join(framevane.exportsDir, mp4), '-frames:v', '1', '-vf', 'crop=1920:2:0:539,scale=64:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'])
    const px = [...r.stdout]
    expect(px.length).toBe(64 * 3)
    for (let i = 0; i < 64; i++) expect(isGrey(px.slice(i * 3, i * 3 + 3)), `pixel ${i}: ${px.slice(i * 3, i * 3 + 3)}`).toBe(true)
  })
})

test.describe('M4 agent tools over MCP', () => {
  const PORT = 47899
  test.use({ pickFiles: [files.talk, files.broll], reelEnv: { FRAMEVANE_MCP_PORT: String(PORT) } })

  test('list_looks, adjust_color, apply_filter, apply_lut, effects, transitions, chroma_key', async ({ framevane }) => {
    const { page } = framevane
    await newProjectFromFiles(page)
    await expect(clips(page)).toHaveCount(2)
    const info = await page.evaluate(() => window.framevane.mcp.info())
    const client = new Client({ name: 'e2e', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${info.token}` } } }))
    const call = async (name: string, args: Record<string, unknown> = {}, ok = true) => {
      const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 60_000 })
      const text = (r.content as { type: string; text?: string }[]).map((c) => c.text ?? '').join('\n')
      expect(!!r.isError, `${name}: ${text}`).toBe(!ok)
      return text
    }
    const looks = JSON.parse(await call('list_looks')) as { effects: unknown[]; filters: unknown[]; transitions: unknown[] }
    expect(looks.effects.length).toBeGreaterThanOrEqual(20)
    expect(looks.filters.length).toBe(20)
    expect(looks.transitions.length).toBeGreaterThanOrEqual(15)

    const tl = JSON.parse(await call('get_timeline')) as { tracks: { trackId: string; clips: { id: string }[] }[] }
    const main = tl.tracks[0]!
    const [a, b] = main.clips.map((c) => c.id)
    await call('adjust_color', { clipIds: [a, b], temperature: 30, contrast: 15 })
    await call('apply_filter', { clipIds: [a], filter: 'cinema', intensity: 0.6 })
    expect(await call('apply_filter', { clipIds: [a], filter: 'sparkly' }, false)).toMatch(/Unknown filter/)
    const { lutId } = JSON.parse(await call('apply_lut', { clipIds: [b], path: files.lut, intensity: 0.5 })) as { lutId: string }
    const added = JSON.parse(await call('add_effect', { clipIds: [a], kind: 'glitch', params: { amount: 70 } })) as { effectId: string }[]
    expect(await call('add_effect', { clipIds: [a], kind: 'blur', params: { radius: 3 } }, false)).toMatch(/no param radius/)
    await call('add_effect', { clipIds: [a], kind: 'vignette-ish' }, false)
    const tr = JSON.parse(await call('set_transition', { allOnTrackId: main.trackId, kind: 'iris', durationSeconds: 0.8 })) as { applied: number }
    expect(tr.applied).toBe(1)
    await call('chroma_key', { clipId: b, color: '#00ff00', intensity: 0.3 })

    await expect(timeline(page).getByRole('gridcell', { name: /talk\.mp4.*colour, fx.*Circle transition into the next clip/ })).toBeVisible()
    await expect(timeline(page).getByRole('gridcell', { name: /broll\.mp4.*key, colour/ })).toBeVisible()
    const after = JSON.parse(await call('get_timeline')) as { tracks: { clips: Record<string, unknown>[] }[] }
    const [ca, cb] = after.tracks[0]!.clips
    expect(ca).toMatchObject({ color: { temperature: 30, contrast: 15 }, filter: { id: 'cinema', intensity: 0.6 }, effects: [{ effectId: added[0]!.effectId, kind: 'glitch' }], transitionToNext: { kind: 'iris', seconds: 0.8 } })
    expect(cb).toMatchObject({ lut: { id: lutId, intensity: 0.5 }, chromaKey: { color: '#00ff00', intensity: 0.3 } })
    await call('remove_effect', { clipId: a, all: true })
    await call('set_transition', { clipIds: [a], kind: 'none' })
    await expect(timeline(page).getByRole('gridcell', { name: /Circle transition/ })).toHaveCount(0)
    await client.close()
  })
})
