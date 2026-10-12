import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { a11y, clips, expect, newProjectFromFiles, test } from '../fixtures'
import { files } from '../global-setup'

/** Milestone 6: every export format, codecs, ranges, custom bitrate; Settings → Performance (AI device, folder, caches). */

interface Probe { format: { duration: string; format_name: string; bit_rate?: string }; streams: { codec_type: string; codec_name: string; width?: number; height?: number; sample_rate?: string; channels?: number; bit_rate?: string }[] }
const probe = (file: string): Probe => JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { encoding: 'utf8' }).stdout) as Probe
const exported = (dir: string, ext: string) => join(dir, readdirSync(dir).find((f) => f.endsWith(`.${ext}`))!)

async function pick(page: Page, label: string, option: string) {
  await page.getByRole('dialog', { name: 'Export', exact: true }).getByRole('combobox', { name: label }).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}
async function openExport(page: Page) {
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  return page.getByRole('dialog', { name: 'Export', exact: true })
}
async function setNumber(page: Page, label: string, v: string) {
  const f = page.getByRole('dialog', { name: 'Export', exact: true }).getByRole('spinbutton', { name: label, exact: true })
  await f.fill(v)
  await f.press('Enter')
}
async function run(page: Page) {
  const d = page.getByRole('dialog', { name: 'Export', exact: true })
  await d.getByRole('button', { name: 'Export…' }).click()
  // the dialog closes when the file is complete (an earlier toast may still be showing)
  await expect(d).toBeHidden({ timeout: 300_000 })
}

test.describe('M6 export formats', () => {
  test.use({ pickFiles: [files.talk] })

  test('MOV of a range, WebM VP9 + Opus, custom bitrate MP4', async ({ framevane }) => {
    const { page, exportsDir } = framevane
    await newProjectFromFiles(page)
    let d = await openExport(page)
    expect(await a11y(page, 'S22 export')).toEqual([])
    await pick(page, 'Format', 'Video · MOV')
    await pick(page, 'Resolution', '720p')
    await d.getByRole('radio', { name: 'From… to…' }).click()
    await setNumber(page, 'From', '2')
    await setNumber(page, 'To', '5')
    await expect(d.getByText(/0:03\.0 · no watermark/)).toBeVisible()
    await run(page)
    const mov = probe(exported(exportsDir, 'mov'))
    expect(mov.format.format_name).toContain('mov')
    expect(Math.abs(Number(mov.format.duration) - 3)).toBeLessThan(0.15)
    expect(mov.streams.find((s) => s.codec_type === 'video')).toMatchObject({ codec_name: 'h264', width: 1280, height: 720 })

    d = await openExport(page)
    await pick(page, 'Format', 'Video · WebM')
    await pick(page, 'Resolution', '720p')
    await expect(d.getByRole('combobox', { name: 'Codec' })).toContainText(/VP9|AV1/)
    await d.getByRole('radio', { name: 'From… to…' }).click()
    await setNumber(page, 'To', '2')
    await run(page)
    const webm = probe(exported(exportsDir, 'webm'))
    expect(webm.format.format_name).toContain('webm')
    expect(['vp9', 'av1']).toContain(webm.streams.find((s) => s.codec_type === 'video')!.codec_name)
    expect(webm.streams.find((s) => s.codec_type === 'audio')!.codec_name).toBe('opus')

    d = await openExport(page)
    await pick(page, 'Resolution', '720p')
    await pick(page, 'Quality', 'Custom bitrate')
    await setNumber(page, 'Bitrate', '3')
    await expect(d.getByText(/3\.0 Mbps/)).toBeVisible()
    await d.getByRole('radio', { name: 'From… to…' }).click()
    await setNumber(page, 'To', '6')
    await run(page)
    const mp4 = probe(exported(exportsDir, 'mp4'))
    const vbr = Number(mp4.streams.find((s) => s.codec_type === 'video')!.bit_rate)
    expect(vbr).toBeGreaterThan(1.2e6)
    expect(vbr).toBeLessThan(4.5e6)
  })

  test('AV1 when this PC can encode it, otherwise marked unavailable', async ({ framevane }) => {
    const { page, exportsDir } = framevane
    await newProjectFromFiles(page)
    const d = await openExport(page)
    await pick(page, 'Resolution', '720p')
    await d.getByRole('combobox', { name: 'Codec' }).click()
    const av1 = page.getByRole('option', { name: /^AV1/ })
    if (await av1.getAttribute('aria-disabled') === 'true' || await av1.getAttribute('data-disabled') !== null) {
      await expect(av1).toContainText('not on this PC')
      test.info().annotations.push({ type: 'note', description: 'AV1 encode not available on this machine' })
      return
    }
    await av1.click()
    await d.getByRole('radio', { name: 'From… to…' }).click()
    await setNumber(page, 'To', '2')
    await run(page)
    expect(probe(exported(exportsDir, 'mp4')).streams.find((s) => s.codec_type === 'video')!.codec_name).toBe('av1')
  })

  test('GIF, MP3, WAV, M4A and a PNG frame', async ({ framevane }) => {
    const { page, exportsDir } = framevane
    await newProjectFromFiles(page)
    let d = await openExport(page)
    await pick(page, 'Format', 'Animated GIF')
    await pick(page, 'Width', '360 px')
    await pick(page, 'Frame rate', '10 fps')
    await d.getByRole('radio', { name: 'From… to…' }).click()
    await setNumber(page, 'To', '2')
    await run(page)
    const gifFile = exported(exportsDir, 'gif')
    expect(readFileSync(gifFile).subarray(0, 6).toString('latin1')).toBe('GIF89a')
    expect(probe(gifFile).streams[0]).toMatchObject({ codec_name: 'gif', width: 360 })

    for (const [format, ext, codec] of [['Audio only · MP3', 'mp3', 'mp3'], ['Audio only · WAV', 'wav', 'pcm_s16le'], ['Audio only · M4A (AAC)', 'm4a', 'aac']] as const) {
      d = await openExport(page)
      await pick(page, 'Format', format)
      await run(page)
      const p = probe(exported(exportsDir, ext))
      expect(p.streams).toHaveLength(1)
      expect(p.streams[0]).toMatchObject({ codec_type: 'audio', codec_name: codec, channels: 2, sample_rate: '48000' })
      expect(Math.abs(Number(p.format.duration) - 29.13)).toBeLessThan(0.2)
    }

    d = await openExport(page)
    await pick(page, 'Format', 'This frame · PNG')
    await expect(d.getByText(/The frame at the playhead/)).toBeVisible()
    await run(page)
    const png = exported(exportsDir, 'png')
    expect(readFileSync(png).subarray(1, 4).toString('latin1')).toBe('PNG')
    expect(probe(png).streams[0]).toMatchObject({ width: 1920, height: 1080 })
  })

  test('export just the selected clips', async ({ framevane }) => {
    const { page, exportsDir } = framevane
    await newProjectFromFiles(page)
    await clips(page).first().click()
    await page.keyboard.press('Control+b') // split at the playhead (0) does nothing; move first
    await page.getByRole('grid', { name: 'Timeline tracks' }).click({ position: { x: 160, y: 10 } })
    await page.keyboard.press('Home')
    for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowRight')
    await clips(page).first().click()
    await page.keyboard.press('Control+b')
    await expect(clips(page)).toHaveCount(2)
    await clips(page).first().click()
    const d = await openExport(page)
    await d.getByRole('radio', { name: 'Selected clips' }).click()
    await expect(d.getByText(/0:04\.0 · no watermark/)).toBeVisible()
    await run(page)
    expect(Math.abs(Number(probe(exported(exportsDir, 'mp4')).format.duration) - 4)).toBeLessThan(0.15)
  })
})

test.describe('M6 settings', () => {
  const folder = mkdtempSync(join(tmpdir(), 'framevane-newprojects-'))
  test.afterAll(() => { try { rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* swept by the global teardown */ } })
  test.use({ pickFiles: [files.talk], reelEnv: { FRAMEVANE_TEST_PICK_FOLDER: folder } })

  test('projects folder, AI device (survives a restart), caches with sizes and clearing', async ({ framevane }) => {
    let page = framevane.page
    await newProjectFromFiles(page)
    await expect.poll(() => page.evaluate(() => window.framevane.storage.usage().then((u) => u.find((x) => x.id === 'previews')!.bytes))).toBeGreaterThan(0)
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('tab', { name: 'Performance' }).click()
    expect(await a11y(page, 'S23 performance')).toEqual([])
    const caches = page.getByRole('list', { name: 'Caches' })
    await expect(caches.getByRole('listitem')).toHaveCount(6)
    await expect(caches.getByRole('listitem').filter({ hasText: 'Converted and generated media' }).getByRole('button')).toHaveCount(0)

    await caches.getByRole('button', { name: 'Clear Thumbnails and waveforms' }).click()
    await expect(caches.getByRole('listitem').filter({ hasText: 'Thumbnails and waveforms' })).toContainText('Empty')

    await page.getByRole('button', { name: 'Change…' }).click()
    await expect(page.getByText(folder)).toBeVisible()
    await page.getByRole('radio', { name: 'CPU only' }).click()
    await expect(page.getByRole('radio', { name: 'CPU only' })).toHaveAttribute('aria-checked', 'true')

    const { projectId } = await page.evaluate(() => window.framevane.projects.create({ name: 'Lands in the new folder' }))
    const p = (await page.evaluate(() => window.framevane.projects.list())).find((x) => x.id === projectId)!
    expect(p.dirPath.startsWith(folder)).toBe(true)

    page = await framevane.relaunch()
    expect(await page.evaluate(() => window.framevane.storage.aiDevice())).toBe('cpu')
    // previews are made again when the project's media is listed
    const id = (await page.evaluate(() => window.framevane.projects.list())).find((x) => x.name !== 'Lands in the new folder')!.id
    await page.evaluate((id) => window.framevane.media.list(id), id)
    await expect.poll(() => page.evaluate(() => window.framevane.storage.usage().then((u) => u.find((x) => x.id === 'previews')!.bytes)), { timeout: 60_000 }).toBeGreaterThan(0)
  })
})

test.describe('M6 export over MCP', () => {
  const PORT = 47901
  test.use({ pickFiles: [files.talk], reelEnv: { FRAMEVANE_MCP_PORT: String(PORT) } })

  test('export_video picks the format from the extension, with a range', async ({ framevane }) => {
    const { page, exportsDir } = framevane
    await newProjectFromFiles(page)
    const info = await page.evaluate(() => window.framevane.mcp.info())
    const client = new Client({ name: 'e2e', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${info.token}` } } }))
    const call = async (args: Record<string, unknown>) => {
      const r = await client.callTool({ name: 'export_video', arguments: args }, undefined, { timeout: 300_000 })
      const text = (r.content as { type: string; text?: string }[]).map((c) => c.text ?? '').join('\n')
      return { ok: !r.isError, text }
    }
    expect((await call({ outputPath: join(exportsDir, 'clip.webm'), height: 720, startSeconds: 1, endSeconds: 3 })).ok).toBe(true)
    expect(Math.abs(Number(probe(join(exportsDir, 'clip.webm')).format.duration) - 2)).toBeLessThan(0.15)
    expect((await call({ outputPath: join(exportsDir, 'still.jpg'), height: 720, atSeconds: 5 })).ok).toBe(true)
    expect(probe(join(exportsDir, 'still.jpg')).streams[0]).toMatchObject({ codec_name: 'mjpeg', width: 1280, height: 720 })
    const bad = await call({ outputPath: join(exportsDir, 'nope.avi') })
    expect(bad.ok).toBe(false)
    expect(bad.text).toMatch(/must end in/)
    await client.close()
  })
})
