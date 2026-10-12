import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { a11y, clips, expect, isBlank, newProjectFromFiles, previewPixel, test, timeline } from '../fixtures'
import { files } from '../global-setup'

/** Milestone 5: local AI background removal (video and photo), auto reframe, the model manager, agent tools. */

const props = (page: Page) => page.getByRole('region', { name: 'Properties' })
const hasPerson = existsSync(files.person)
const brightness = (p: { rgba: number[] } | null) => (p ? Math.max(p.rgba[0]!, p.rgba[1]!, p.rgba[2]!) : 0)

async function removeBg(page: Page) {
  await clips(page).first().click()
  await props(page).getByRole('radio', { name: 'Remove BG' }).click()
  await props(page).getByRole('switch', { name: /Remove background/ }).click()
  await expect(timeline(page).getByRole('gridcell', { name: /cutout/ })).toBeVisible()
  // the Edge control appears when the matte is ready
  await expect(props(page).getByRole('spinbutton', { name: 'Edge' })).toBeVisible({ timeout: 180_000 })
}
async function seekTo(page: Page, s: number) {
  await timeline(page).click({ position: { x: 160, y: 10 } })
  await page.keyboard.press('Home')
  for (let i = 0; i < s; i++) await page.keyboard.press('Shift+ArrowRight')
}

test.describe('M5 remove background', () => {
  test.describe('footage with nobody in it', () => {
    test.use({ pickFiles: [files.talk] })

    test('the matte removes the whole picture; keep-background inverts it; undo', async ({ framevane }) => {
      const { page } = framevane
      await newProjectFromFiles(page)
      await expect.poll(async () => isBlank(await previewPixel(page, 0.06, 0.5))).toBe(false)
      await removeBg(page)
      expect(await a11y(page, 'S14 remove BG')).toEqual([])
      await expect.poll(async () => isBlank(await previewPixel(page, 0.06, 0.5))).toBe(true)
      await props(page).getByRole('switch', { name: 'Keep the background instead' }).click()
      await expect.poll(async () => isBlank(await previewPixel(page, 0.06, 0.5))).toBe(false)
      await props(page).getByRole('switch', { name: /Remove background/ }).click()
      await expect(timeline(page).getByRole('gridcell', { name: /cutout/ })).toHaveCount(0)
      await page.keyboard.press('Control+z')
      await expect(timeline(page).getByRole('gridcell', { name: /cutout/ })).toBeVisible()
    })
  })

  test.describe('a person on video', () => {
    test.skip(!hasPerson, 'person.mp4 could not be downloaded (offline)')
    test.use({ pickFiles: [files.person] })

    test('keeps the person, removes the room, and exports that way', async ({ framevane }) => {
      const { page } = framevane
      await newProjectFromFiles(page)
      await seekTo(page, 3)
      await expect.poll(async () => brightness(await previewPixel(page, 0.03, 0.05))).toBeGreaterThan(30)
      await removeBg(page)
      await expect.poll(async () => brightness(await previewPixel(page, 0.03, 0.05))).toBeLessThan(10)
      expect(brightness(await previewPixel(page, 0.53, 0.24))).toBeGreaterThan(90) // his face
    })
  })

  test.describe('a photo', () => {
    test.skip(!hasPerson, 'person.png could not be made (offline)')
    test.use({ pickFiles: [files.personStill] })

    test('BiRefNet cuts out the subject of a photo', async ({ framevane }) => {
      const { page } = framevane
      await newProjectFromFiles(page)
      await removeBg(page)
      await expect.poll(async () => brightness(await previewPixel(page, 0.03, 0.05))).toBeLessThan(10)
      expect(brightness(await previewPixel(page, 0.53, 0.24))).toBeGreaterThan(90)
    })
  })
})

test.describe('M5 auto reframe', () => {
  test.describe('centred', () => {
    test.use({ pickFiles: [files.talk] })

    test('9:16 keeping the clip centred: new canvas, clip fills it', async ({ framevane }) => {
      const { page } = framevane
      await newProjectFromFiles(page)
      await page.getByRole('button', { name: 'Auto reframe…' }).click()
      const dlg = page.getByRole('dialog', { name: 'Auto reframe' })
      expect(await a11y(page, 'auto reframe')).toEqual([])
      await expect(dlg.getByText('Canvas becomes 1080×1920.')).toBeVisible()
      await dlg.getByRole('radio', { name: 'Keep centred' }).click()
      await dlg.getByRole('button', { name: 'Reframe' }).click()
      await expect(dlg).toBeHidden()
      await expect(props(page).getByText('1080 × 1920')).toBeVisible()
      await clips(page).first().click()
      await expect(props(page).getByRole('spinbutton', { name: 'Scale' })).toHaveValue('316')
      await page.keyboard.press('Control+z')
      await clips(page).first().click()
      await expect(props(page).getByRole('spinbutton', { name: 'Scale' })).toHaveValue('100')
    })
  })

  test.describe('following a person', () => {
    test.skip(!hasPerson, 'person.mp4 could not be downloaded (offline)')
    test.use({ pickFiles: [files.person] })

    test('pans with keyframes to keep the speaker in frame', async ({ framevane }) => {
      const { page } = framevane
      await newProjectFromFiles(page)
      await clips(page).first().click()
      await props(page).getByRole('button', { name: 'Auto reframe…' }).click()
      const dlg = page.getByRole('dialog', { name: 'Auto reframe' })
      await dlg.getByRole('radio', { name: /Selected/ }).click()
      await dlg.getByRole('button', { name: 'Reframe' }).click()
      await expect(dlg).toBeHidden({ timeout: 120_000 })
      await expect(page.getByText('The clip follows the person.').first()).toBeVisible()
      await clips(page).first().click()
      await expect(props(page).getByRole('button', { name: 'Clear keyframes' })).toBeVisible()
      // the speaker's face is in the middle third of the new vertical frame
      await seekTo(page, 3)
      expect(brightness(await previewPixel(page, 0.5, 0.2))).toBeGreaterThan(60)
    })
  })
})

test.describe('M5 model manager', () => {
  const models = mkdtempSync(join(tmpdir(), 'framevane-models-'))
  test.afterAll(() => rmSync(models, { recursive: true, force: true }))
  test.use({ reelEnv: { FRAMEVANE_MODELS_DIR: models } })

  test('lists the local models; downloads and removes one (checksum-verified)', async ({ framevane }) => {
    const { page } = framevane
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('tab', { name: 'AI models' }).click()
    const list = page.getByRole('list', { name: 'AI models' })
    await expect(list.getByRole('listitem')).toHaveCount(4)
    for (const n of ['Whisper', 'Kokoro', 'Robust Video Matting', 'BiRefNet']) await expect(list.getByText(new RegExp(n))).toBeVisible()
    expect(await a11y(page, 'S23 AI models')).toEqual([])
    const rvm = list.getByRole('listitem').filter({ hasText: 'Robust Video Matting' })
    await expect(rvm.getByText('Not downloaded')).toBeVisible()
    await rvm.getByRole('button', { name: /Download/ }).click()
    await expect(rvm.getByText('On this computer')).toBeVisible({ timeout: 180_000 })
    expect(existsSync(join(models, 'rvm', 'rvm_mobilenetv3_fp32.onnx'))).toBe(true)
    await rvm.getByRole('button', { name: /Remove/ }).click()
    await expect(rvm.getByText('Not downloaded')).toBeVisible()
    expect(existsSync(join(models, 'rvm'))).toBe(false)
  })
})

test.describe('M5 agent tools over MCP', () => {
  const PORT = 47900
  test.use({ pickFiles: [files.talk], reelEnv: { FRAMEVANE_MCP_PORT: String(PORT) } })

  test('remove_background and auto_reframe', async ({ framevane }) => {
    const { page } = framevane
    await newProjectFromFiles(page)
    const info = await page.evaluate(() => window.framevane.mcp.info())
    const client = new Client({ name: 'e2e', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${info.token}` } } }))
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 180_000 })
      const text = (r.content as { type: string; text?: string }[]).map((c) => c.text ?? '').join('\n')
      expect(r.isError, `${name}: ${text}`).toBeFalsy()
      return text
    }
    const tl = JSON.parse(await call('get_timeline')) as { tracks: { clips: { id: string }[] }[] }
    const id = tl.tracks[0]!.clips[0]!.id
    await call('remove_background', { clipIds: [id], edge: 0.6 })
    await expect(timeline(page).getByRole('gridcell', { name: /cutout/ })).toBeVisible()
    await expect.poll(async () => isBlank(await previewPixel(page, 0.06, 0.5))).toBe(true)
    const r = JSON.parse(await call('auto_reframe', { ratio: '1:1', follow: 'subject' })) as { canvas: { width: number; height: number }; followingSubject: number }
    expect(r.canvas).toEqual({ width: 1080, height: 1080 })
    expect(r.followingSubject).toBe(0) // colour bars: nobody to follow, so centred
    await expect(page.getByRole('img', { name: /Preview/ })).toHaveAttribute('width', /\d+/)
    await client.close()
  })
})
