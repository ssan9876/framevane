import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { a11y, expect, previewPixel, test } from '../fixtures'
import { files } from '../global-setup'

/** Milestone 7: the photo editor (S25): layers, shapes, stickers, canvas crop/resize/turn, looks, cutout, PNG/JPG/WebP. */

const tools = (page: Page) => page.getByRole('region', { name: 'Layers and tools' })
const props = (page: Page) => page.getByRole('region', { name: 'Properties' })
const layers = (page: Page) => tools(page).getByRole('list', { name: 'Layers' }).getByRole('listitem')
const tab = (page: Page, name: string) => tools(page).getByRole('tab', { name, exact: true })

interface Probe { streams: { codec_name: string; width: number; height: number; pix_fmt?: string }[] }
const probe = (f: string) => JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', f], { encoding: 'utf8' }).stdout) as Probe
/** RGBA of one pixel of an image file, decoded by FFmpeg. */
function pixel(file: string, x: number, y: number): number[] {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `crop=1:1:${x}:${y}`, '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'])
  return [...r.stdout]
}

async function openPhoto(page: Page) {
  await page.getByRole('button', { name: /Photo editor/ }).click()
  await expect(page.getByRole('img', { name: /^Photo \d+ by \d+/ })).toBeVisible()
}
async function exportAs(page: Page, format: 'PNG' | 'JPG' | 'WebP', dir: string, ext: string) {
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const d = page.getByRole('dialog', { name: 'Export photo' })
  await d.getByRole('radio', { name: format }).click()
  await d.getByRole('button', { name: 'Export…' }).click()
  await expect(d).toBeHidden({ timeout: 60_000 })
  return join(dir, readdirSync(dir).find((f) => f.endsWith(`.${ext}`))!)
}

test.describe('M7 photo editor', () => {
  test.use({ pickFiles: [files.still] })

  test('open an image, add text, shape and sticker layers; reorder, hide, lock, delete, undo', async ({ framevane }) => {
    const { page } = framevane
    await openPhoto(page)
    await expect(page.getByRole('img', { name: 'Photo 1920 by 1080' })).toBeVisible()
    await expect(layers(page)).toHaveCount(1)
    expect(await a11y(page, 'S25 photo editor')).toEqual([])
    await tab(page, 'Add').click()
    expect(await a11y(page, 'S25 add')).toEqual([])
    await tools(page).getByRole('button', { name: 'Add text', exact: true }).click()
    await tools(page).getByRole('button', { name: 'Add Star', exact: true }).click()
    await tools(page).getByRole('button', { name: 'Add fire sticker', exact: true }).click()
    await tab(page, 'Layers').click()
    await expect(layers(page)).toHaveCount(4)
    await expect(layers(page).first()).toContainText('🔥')
    await expect(layers(page).nth(1)).toContainText('Star')
    await expect(layers(page).last()).toContainText('still.png')
    // the star's colour is in the middle of the picture
    await tools(page).getByRole('button', { name: 'Hide 🔥' }).click()
    await tools(page).getByRole('button', { name: 'Hide Add text' }).click()
    await expect.poll(async () => (await previewPixel(page, 0.5, 0.5))!.rgba.slice(0, 3)).toEqual([255, 122, 61])
    await tools(page).getByRole('button', { name: 'Move Star down' }).click()
    await tools(page).getByRole('button', { name: 'Move Star down' }).click()
    await expect(layers(page).last()).toContainText('Star')
    await expect.poll(async () => (await previewPixel(page, 0.5, 0.5))!.rgba.slice(0, 3)).not.toEqual([255, 122, 61])
    await tools(page).getByRole('button', { name: 'Lock still.png' }).click()
    await expect(tools(page).getByRole('button', { name: 'Delete still.png' })).toBeDisabled()
    await tools(page).getByRole('button', { name: 'Delete 🔥' }).click()
    await expect(layers(page)).toHaveCount(3)
    await page.keyboard.press('Control+z')
    await expect(layers(page)).toHaveCount(4)
  })

  test('shape inspector, canvas crop / resize / turn, transparent PNG, white JPG, WebP', async ({ framevane }) => {
    const { page, exportsDir } = framevane
    await openPhoto(page)
    await tab(page, 'Add').click()
    await tools(page).getByRole('button', { name: 'Add Rectangle', exact: true }).click()
    await expect(props(page).getByRole('combobox', { name: 'Shape' })).toContainText('Rectangle')
    expect(await a11y(page, 'S25 shape inspector')).toEqual([])
    await props(page).getByRole('combobox', { name: 'Shape' }).click()
    await page.getByRole('option', { name: 'Ellipse' }).click()
    await expect(layers(page).first()).toContainText('Ellipse').catch(async () => { await tab(page, 'Layers').click(); await expect(layers(page).first()).toContainText('Ellipse') })

    // crop to a square, then halve it, then turn it
    await tab(page, 'Canvas').click()
    expect(await a11y(page, 'S25 canvas')).toEqual([])
    await tools(page).getByRole('button', { name: 'Crop…' }).click()
    await tools(page).getByRole('combobox', { name: 'Shape' }).click()
    await page.getByRole('option', { name: '1:1' }).click()
    await expect(page.getByRole('group', { name: 'Crop box 1080 by 1080' })).toBeVisible()
    await tools(page).getByRole('button', { name: 'Apply crop' }).click()
    await expect(page.getByRole('img', { name: 'Photo 1080 by 1080' })).toBeVisible()
    const w = tools(page).getByRole('spinbutton', { name: 'Width' })
    await w.fill('540'); await w.press('Enter')
    await tools(page).getByRole('button', { name: 'Apply size' }).click()
    await expect(page.getByRole('img', { name: 'Photo 540 by 540' })).toBeVisible()

    // remove the image layer: only the ellipse is left on a see-through canvas
    await tab(page, 'Layers').click()
    await tools(page).getByRole('button', { name: 'Delete still.png' }).click()
    const png = await exportAs(page, 'PNG', exportsDir, 'png')
    expect(probe(png).streams[0]).toMatchObject({ width: 540, height: 540 })
    expect(pixel(png, 2, 2)[3]).toBe(0) // see-through corner
    expect(pixel(png, 270, 270)).toEqual([255, 122, 61, 255]) // the ellipse
    const jpg = await exportAs(page, 'JPG', exportsDir, 'jpg')
    expect(pixel(jpg, 2, 2).slice(0, 3).every((v) => v > 245)).toBe(true) // white page
    const webp = await exportAs(page, 'WebP', exportsDir, 'webp')
    expect(probe(webp).streams[0]).toMatchObject({ codec_name: 'webp', width: 540, height: 540 })

    // a quarter turn of a non-square picture swaps its sides
    await tab(page, 'Canvas').click()
    const h = tools(page).getByRole('spinbutton', { name: 'Height' })
    await tools(page).getByRole('switch', { name: 'Keep the shape' }).click()
    await h.fill('300'); await h.press('Enter')
    await tools(page).getByRole('switch', { name: 'Scale the picture' }).click()
    await tools(page).getByRole('button', { name: 'Apply size' }).click()
    await expect(page.getByRole('img', { name: 'Photo 540 by 300' })).toBeVisible()
    await tools(page).getByRole('button', { name: 'Right' }).click()
    await expect(page.getByRole('img', { name: 'Photo 300 by 540' })).toBeVisible()
  })

  test('filters and colour work on photo layers; the photo reopens from Home', async ({ framevane }) => {
    const { page } = framevane
    await openPhoto(page)
    await tools(page).getByRole('button', { name: /still\.png/ }).first().click()
    await expect(props(page).getByRole('tab', { name: 'Image' })).toBeVisible()
    await expect(props(page).getByRole('tab', { name: 'Speed' })).toHaveCount(0)
    await tab(page, 'Filters').click()
    await tools(page).getByRole('button', { name: 'Mono filter' }).click()
    await props(page).getByRole('tab', { name: 'Adjust' }).click()
    const s = props(page).getByRole('spinbutton', { name: 'Strength', exact: true })
    await s.fill('100'); await s.press('Enter')
    await expect.poll(async () => { const [r, g, b] = (await previewPixel(page, 0.8, 0.5))!.rgba; return Math.abs(r! - g!) < 10 && Math.abs(g! - b!) < 10 }).toBe(true)
    await page.getByRole('button', { name: 'Projects' }).click()
    await page.getByRole('button', { name: 'Open still' }).click()
    await expect(page.getByRole('region', { name: 'Layers and tools' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Timeline' })).toHaveCount(0)
  })
})

test.describe('M7 cut-out', () => {
  test.skip(!existsSync(files.personStill), 'person.png could not be made (offline)')
  test.use({ pickFiles: [files.personStill] })

  test('remove the background of a photo and export a transparent PNG', async ({ framevane }) => {
    const { page, exportsDir } = framevane
    await openPhoto(page)
    await tools(page).getByRole('button', { name: /person\.png/ }).first().click()
    await props(page).getByRole('radio', { name: 'Remove BG' }).click()
    await props(page).getByRole('switch', { name: /Remove background/ }).click()
    await expect(props(page).getByRole('spinbutton', { name: 'Edge' })).toBeVisible({ timeout: 120_000 })
    const png = await exportAs(page, 'PNG', exportsDir, 'png')
    expect(pixel(png, 10, 10)[3]).toBe(0) // the chamber is gone
    expect(pixel(png, 545, 140)[3]).toBeGreaterThan(200) // his face stays
  })
})

test.describe('M7 photo tools over MCP', () => {
  const PORT = 47902
  test.use({ reelEnv: { FRAMEVANE_MCP_PORT: String(PORT) } })

  test('create a photo, add layers, restack, crop, export WebP', async ({ framevane }) => {
    const { page, exportsDir } = framevane
    await page.getByRole('heading', { name: 'What are we making?' }).waitFor()
    const info = await page.evaluate(() => window.framevane.mcp.info())
    const client = new Client({ name: 'e2e', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${info.token}` } } }))
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 120_000 })
      const text = (r.content as { type: string; text?: string }[]).map((c) => c.text ?? '').join('\n')
      expect(r.isError, `${name}: ${text}`).toBeFalsy()
      return text
    }
    await call('create_project', { name: 'Agent photo', kind: 'photo', files: [files.still] })
    await expect(page.getByRole('region', { name: 'Layers and tools' })).toBeVisible()
    expect(JSON.parse(await call('get_project_summary'))).toMatchObject({ kind: 'photo', canvas: { width: 1920, height: 1080 } })
    const { clipId: shape } = JSON.parse(await call('add_shape', { shape: 'rect', width: 800, height: 200, fill: '#000000aa', y: 300 })) as { clipId: string }
    await call('add_text', { text: 'SALE', style: { fontSize: 140 } })
    await expect(layers(page)).toHaveCount(3)
    await expect(layers(page).first()).toContainText('SALE')
    await call('move_layer', { clipId: shape, to: 'top' })
    await expect(layers(page).first()).toContainText('Rectangle')
    await call('edit_shape', { clipId: shape, radius: 0.3 })
    await call('crop_photo', { x: 420, y: 0, width: 1080, height: 1080 })
    await expect(page.getByRole('img', { name: 'Photo 1080 by 1080' })).toBeVisible()
    await call('export_video', { outputPath: join(exportsDir, 'post.webp') })
    expect(probe(join(exportsDir, 'post.webp')).streams[0]).toMatchObject({ codec_name: 'webp', width: 1080, height: 1080 })
    await client.close()
  })
})
