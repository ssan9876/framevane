import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, ffprobe, newProjectFromFiles, test } from '../fixtures'
import { files } from '../global-setup'

async function pick(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label }).click()
  await page.getByRole('option', { name: option }).click()
}

async function exportWith(page: Page, opts: { name?: string; res?: string; fps?: string; codec?: string } = {}) {
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Export video' })
  await dialog.waitFor()
  if (opts.name) await dialog.getByRole('textbox', { name: 'File name' }).fill(opts.name)
  if (opts.res) await pick(page, 'Resolution', opts.res)
  if (opts.fps) await pick(page, 'Frame rate', opts.fps)
  if (opts.codec) await pick(page, 'Codec', opts.codec)
  await dialog.getByRole('button', { name: 'Export…' }).click()
  return dialog
}

const done = (page: Page) => expect(page.getByText('Your video is ready').first()).toBeVisible({ timeout: 300_000 })
const mp4s = (dir: string) => readdirSync(dir).filter((f) => f.endsWith('.mp4'))

test.describe('F10 export', () => {
  test.describe('talk clip', () => {
    test.use({ pickFiles: [files.talk] })

    test('F10-H1 1080p30 H.264 + AAC with the timeline duration', async ({ framevane }) => {
      const { page } = framevane
      await newProjectFromFiles(page)
      await exportWith(page)
      await done(page)
      const [f] = mp4s(framevane.exportsDir)
      const p = ffprobe(join(framevane.exportsDir, f!))
      const v = p.streams.find((s) => s.codec_type === 'video')!
      const a = p.streams.find((s) => s.codec_type === 'audio')!
      expect([v.codec_name, v.width, v.height, v.r_frame_rate]).toEqual(['h264', 1920, 1080, '30/1'])
      expect(a.codec_name).toBe('aac')
      expect(Math.abs(Number(p.format.duration) - 29.13)).toBeLessThan(0.15)
    })

    test('F10-E2 cancelling mid-export leaves no partial file', async ({ framevane }) => {
      const { page } = framevane
      await newProjectFromFiles(page)
      const dialog = await exportWith(page, { res: '4K (2160p)' })
      await expect(dialog.getByText(/Rendering frame/)).toBeVisible({ timeout: 60_000 })
      await dialog.getByRole('button', { name: 'Cancel export' }).click()
      await expect(dialog.getByRole('button', { name: 'Export…' })).toBeVisible()
      await page.waitForTimeout(1000)
      expect(mp4s(framevane.exportsDir)).toEqual([])
    })

    test('F10-E3 4K 60 fps from a 1080p30 source', async ({ framevane }) => {
      const { page } = framevane
      await newProjectFromFiles(page)
      await exportWith(page, { res: '4K (2160p)', fps: '60 fps' })
      await done(page)
      const v = ffprobe(join(framevane.exportsDir, mp4s(framevane.exportsDir)[0]!)).streams.find((s) => s.codec_type === 'video')!
      expect([v.width, v.height, v.r_frame_rate]).toEqual([3840, 2160, '60/1'])
    })

    test('F10-E5 + E6 HEVC with emoji in the file name', async ({ framevane }) => {
      const { page } = framevane
      await newProjectFromFiles(page)
      await exportWith(page, { name: 'Promo 🎉 final', codec: 'HEVC (H.265)', res: '720p' })
      await done(page)
      const file = join(framevane.exportsDir, 'Promo 🎉 final.mp4')
      expect(existsSync(file)).toBe(true)
      expect(ffprobe(file).streams.find((s) => s.codec_type === 'video')!.codec_name).toBe('hevc')
    })
  })

  test.describe('portrait', () => {
    test.use({ pickFiles: [files.rotated] })
    test('F10-E4 a portrait project exports 1080×1920', async ({ framevane }) => {
      const { page } = framevane
      await newProjectFromFiles(page)
      await exportWith(page)
      await done(page)
      const v = ffprobe(join(framevane.exportsDir, mp4s(framevane.exportsDir)[0]!)).streams.find((s) => s.codec_type === 'video')!
      expect([v.width, v.height]).toEqual([1080, 1920])
    })
  })

  test('F10-E1 export is disabled on an empty timeline', async ({ framevane }) => {
    const { page } = framevane
    await page.getByRole('button', { name: /New project/ }).click()
    await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeDisabled()
  })
})
