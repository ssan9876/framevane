import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { clips, expect, isBlank, newProjectFromFiles, previewPixel, projectDuration, test } from '../fixtures'
import { EDGE, files } from '../global-setup'

test.describe('F01 create a project and import media', () => {
  test.describe('from the media panel', () => {
    test.use({ pickFiles: [files.talk, files.music, files.broll] })

    test('F01-H1 new project, import three files, add one', async ({ reel }) => {
      const { page } = reel
      await page.getByRole('button', { name: /New project/ }).click()
      await page.getByRole('button', { name: 'Import', exact: true }).click()
      for (const n of ['talk.mp4', 'music.m4a', 'broll.mp4']) await expect(page.getByText(n, { exact: true }).first()).toBeVisible()
      await page.getByRole('button', { name: 'Add talk.mp4 to timeline' }).click({ force: true })
      await expect(clips(page)).toHaveCount(1)
      await expect(page.getByText('1920 × 1080')).toBeVisible()
      await expect.poll(async () => isBlank(await previewPixel(page))).toBe(false)
    })

    test('F01-E2 importing the same file twice keeps one card', async ({ reel }) => {
      const { page } = reel
      await page.getByRole('button', { name: /New project/ }).click()
      await page.getByRole('button', { name: 'Import', exact: true }).click()
      await expect(page.getByText('talk.mp4', { exact: true })).toHaveCount(1)
      await page.getByRole('button', { name: 'Import', exact: true }).click()
      await page.waitForTimeout(1500)
      await expect(page.getByText('talk.mp4', { exact: true })).toHaveCount(1)
    })
  })

  test.describe('home drop zone', () => {
    test.use({ pickFiles: [files.talk] })
    test('F01-H2 choose files creates a named project with the clip placed', async ({ reel }) => {
      const { page } = reel
      await newProjectFromFiles(page)
      await expect(clips(page)).toHaveCount(1)
      await expect(page.getByRole('heading', { level: 1, name: 'talk' })).toBeVisible()
      await expect.poll(async () => projectDuration(page)).toBe('0:29.1')
    })

    test('F01-E9 double-clicking New project creates one project', async ({ reel }) => {
      const { page } = reel
      await page.getByRole('button', { name: /New project/ }).dblclick()
      await page.getByRole('tab', { name: 'Media' }).waitFor()
      await page.getByRole('button', { name: 'Projects' }).click()
      await expect(page.getByRole('button', { name: /^Open / })).toHaveCount(1)
    })

    test('F01-E10 keyboard only: new project and import', async ({ reel }) => {
      const { page } = reel
      // first focusable is the Settings button, then New project
      await page.keyboard.press('Tab')
      await page.keyboard.press('Tab')
      await expect(page.getByRole('button', { name: /New project/ })).toBeFocused()
      await page.keyboard.press('Enter')
      await page.getByRole('tab', { name: 'Media' }).waitFor()
      const importBtn = page.getByRole('button', { name: 'Import', exact: true })
      for (let i = 0; i < 25 && !(await importBtn.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab')
      await expect(importBtn).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(page.getByText('talk.mp4', { exact: true })).toBeVisible()
    })
  })

  test.describe('edge media', () => {
    test.use({ pickFiles: [files.weird] })
    test('F01-E1 emoji, accents and spaces in the path', async ({ reel }) => {
      const { page } = reel
      await newProjectFromFiles(page)
      await expect(clips(page)).toHaveCount(1)
      await expect(page.getByText('Tést 🎬 clip (copy).mp4').first()).toBeVisible()
      await expect.poll(async () => isBlank(await previewPixel(page))).toBe(false)
    })
  })

  test.describe('legacy codec', () => {
    test.use({ pickFiles: [files.avi] })
    test('F01-E3 MPEG-4 Part 2 AVI is transcoded and plays', async ({ reel }) => {
      const { page } = reel
      await page.getByRole('button', { name: /New project/ }).click()
      await page.getByRole('button', { name: 'Import', exact: true }).click()
      const add = page.getByRole('button', { name: 'Add legacy-mpeg4.avi to timeline' })
      await expect(add).toBeAttached({ timeout: 60_000 })
      await add.click({ force: true })
      await expect(clips(page)).toHaveCount(1)
      await expect.poll(async () => isBlank(await previewPixel(page)), { timeout: 20_000 }).toBe(false)
    })
  })

  test.describe('HEVC 10-bit', () => {
    test.use({ pickFiles: [files.hevc10] })
    test('F01-E4 HEVC 10-bit decodes in the preview', async ({ reel }) => {
      const { page } = reel
      await newProjectFromFiles(page)
      await expect(clips(page)).toHaveCount(1)
      await expect.poll(async () => isBlank(await previewPixel(page)), { timeout: 20_000 }).toBe(false)
    })
  })

  test.describe('rotated phone video', () => {
    test.use({ pickFiles: [files.rotated] })
    test('F01-E5 portrait phone video sets a 1080×1920 canvas', async ({ reel }) => {
      const { page } = reel
      await newProjectFromFiles(page)
      await expect(page.getByText('1080 × 1920')).toBeVisible()
      const px = await previewPixel(page)
      expect(px!.h).toBeGreaterThan(px!.w)
      await expect.poll(async () => isBlank(await previewPixel(page, 0.5, 0.5)), { timeout: 20_000 }).toBe(false)
    })
  })

  test.describe('variable frame rate', () => {
    test.use({ pickFiles: [files.vfr] })
    test('F01-E6 VFR (2 s at 30 fps + 10 s at 12 fps) imports at 12 s with frames late in the clip', async ({ reel }) => {
      const { page } = reel
      await newProjectFromFiles(page)
      await expect.poll(async () => projectDuration(page)).toMatch(/^0:1[12]\./)
      await page.getByRole('grid', { name: 'Timeline tracks' }).click({ position: { x: 160, y: 10 } })
      await page.keyboard.press('Home')
      for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowRight')
      await expect.poll(async () => isBlank(await previewPixel(page)), { timeout: 15_000 }).toBe(false)
    })
  })

  test.describe('not a video', () => {
    test.use({ pickFiles: [files.fake] })
    test("F01-N1 a fake .mp4 is refused with a warning and doesn't crash", async ({ reel }) => {
      const { page } = reel
      await page.getByRole('button', { name: /New project/ }).click()
      await page.getByRole('button', { name: 'Import', exact: true }).click()
      await expect(page.getByText(/couldn't be read|Import failed/).first()).toBeVisible()
      await expect(page.getByRole('button', { name: 'Add not-really-a-video.mp4 to timeline' })).toHaveCount(0)
    })
  })

  test.describe('missing source', () => {
    const victim = join(EDGE, 'will-be-deleted.mp4')
    test.use({ pickFiles: [victim] })
    test('F01-N2 deleted source shows media offline and the app keeps working', async ({ reel }) => {
      const { page } = reel
      await newProjectFromFiles(page)
      await expect(clips(page)).toHaveCount(1)
      await page.getByRole('button', { name: 'Projects' }).click()
      await page.waitForTimeout(500)
      // copy back afterwards so the suite is re-runnable
      const { copyFileSync } = await import('node:fs')
      rmSync(victim)
      try {
        await page.getByRole('button', { name: /^Open / }).click()
        await expect(clips(page)).toHaveCount(1)
        await page.getByRole('tab', { name: 'Media' }).click()
        await expect(page.getByRole('button', { name: /will-be-deleted\.mp4.*file missing/ })).toBeVisible()
        // still editable
        await page.getByRole('grid', { name: 'Timeline tracks' }).click({ position: { x: 160, y: 10 } })
        await page.keyboard.press('Shift+ArrowRight')
        await page.keyboard.press('Control+b')
        await expect(clips(page)).toHaveCount(2)
      } finally {
        copyFileSync(files.broll, victim)
      }
    })
  })
})
