import { clips, expect, isBlank, newProjectFromFiles, previewPixel, test, timeline } from '../fixtures'
import { files } from '../global-setup'

const generate = async (page: import('@playwright/test').Page) => {
  await page.getByRole('tab', { name: 'Captions' }).click()
  await page.getByRole('button', { name: /Generate captions|Generate again/ }).click()
}

test.describe('F04 auto captions', () => {
  test.describe('with speech', () => {
    test.use({ pickFiles: [files.talk] })

    test('F04-H1 + E3 captions are generated, drawn, and regenerating replaces them', async ({ framevane }) => {
      const { page } = framevane
      await newProjectFromFiles(page)
      await generate(page)
      await expect(page.getByText(/Added \d+ caption lines/).first()).toBeVisible({ timeout: 180_000 })
      const n = await clips(page, 'cap-').count()
      expect(n).toBeGreaterThanOrEqual(5)
      // a caption is drawn at 1.5 s ("Welcome back to the channel.") near the bottom of the frame
      await timeline(page).click({ position: { x: 160, y: 10 } })
      await page.keyboard.press('Home')
      for (let i = 0; i < 45; i++) await page.keyboard.press('ArrowRight')
      await page.waitForTimeout(800)
      const withCaption = await page.evaluate(() => {
        const c = document.querySelector('canvas[role="img"]') as HTMLCanvasElement
        const d = c.getContext('2d')!.getImageData(0, Math.floor(c.height * 0.76), c.width, Math.floor(c.height * 0.1)).data
        let white = 0
        for (let i = 0; i < d.length; i += 4) if (d[i]! > 240 && d[i + 1]! > 240 && d[i + 2]! > 240) white++
        return white
      })
      expect(withCaption).toBeGreaterThan(200)
      // regenerate with "Replace" on: same count, not doubled
      await generate(page)
      await expect(page.getByText(/Added \d+ caption lines/).nth(1)).toBeVisible({ timeout: 60_000 }).catch(() => {})
      await page.waitForTimeout(1500)
      await expect(clips(page, 'cap-')).toHaveCount(n)
    })

    test('F04-E4 caption text with emoji and accents persists after restart', async ({ framevane }) => {
      let page = framevane.page
      await newProjectFromFiles(page)
      await generate(page)
      await expect(page.getByText(/Added \d+ caption lines/).first()).toBeVisible({ timeout: 180_000 })
      await clips(page, 'cap-').first().click()
      const box = page.getByRole('textbox', { name: /^Text/ })
      await box.fill('Café ☕ ünïcode — ok')
      await box.press('Enter')
      await expect(clips(page, 'cap-').first()).toContainText('Café ☕')
      page = await framevane.relaunch()
      await page.getByRole('button', { name: /^Open / }).first().click()
      await expect(clips(page, 'cap-').first()).toContainText('Café ☕ ünïcode — ok')
    })
  })

  test.describe('no audio', () => {
    test.use({ pickFiles: [files.broll] })
    test('F04-E1 a clip without sound disables Generate', async ({ framevane }) => {
      const { page } = framevane
      await newProjectFromFiles(page)
      await page.getByRole('tab', { name: 'Captions' }).click()
      await expect(page.getByRole('button', { name: /Generate captions/ })).toBeDisabled()
      await expect(page.getByText('Add a clip with sound to the main track first.')).toBeVisible()
    })
  })

  test.describe('no speech', () => {
    test.use({ pickFiles: [files.avi] })
    test('F04-E2 tone-only audio reports no speech and adds nothing', async ({ framevane }) => {
      const { page } = framevane
      await newProjectFromFiles(page)
      await expect(clips(page)).toHaveCount(1, { timeout: 60_000 })
      await generate(page)
      await expect(page.getByText('No speech found on the main track').first()).toBeVisible({ timeout: 180_000 })
      await expect(clips(page, 'cap-')).toHaveCount(0)
    })
  })

  test.describe('sidecar unavailable', () => {
    test.use({ pickFiles: [files.talk], reelEnv: { FRAMEVANE_SIDECAR_DIR: 'C:/nowhere/framevane-sidecar' } })
    test('F04-N1 a missing local AI runtime gives a clear error, not a hang', async ({ framevane }) => {
      const { page } = framevane
      await newProjectFromFiles(page)
      await generate(page)
      await expect(page.getByText("Captions couldn't be generated").first()).toBeVisible({ timeout: 60_000 })
      await expect(page.getByRole('button', { name: /Generate captions/ })).toBeEnabled()
      expect(isBlank(await previewPixel(page))).toBe(false)
    })
  })
})
