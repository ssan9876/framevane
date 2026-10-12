import { clips, expect, newProjectFromFiles, projectDuration, test, timeline } from '../fixtures'
import { files } from '../global-setup'

const ASK = 'Cut the silences and add captions'

test.describe('F12 agent (test-double model)', () => {
  test.use({ pickFiles: [files.talk], reelEnv: { FRAMEVANE_FAKE_AGENT: '1' } })
  test.beforeEach(async ({ framevane }) => {
    await newProjectFromFiles(framevane.page)
    await expect(clips(framevane.page)).toHaveCount(1)
  })

  test('F12-H1 propose → review → apply a subset → undo', async ({ framevane }) => {
    const { page } = framevane
    await page.getByRole('button', { name: ASK }).click()
    await page.getByRole('button', { name: 'Review edits' }).click({ timeout: 180_000 })
    const dialog = page.getByRole('dialog', { name: "Review the agent's edits" })
    // BUG-009: the review preview must show the video, not just the captions
    const preview = dialog.getByRole('img', { name: 'Preview of the proposed edits' })
    await expect.poll(() => preview.evaluate((c: HTMLCanvasElement) => {
      const d = c.getContext('2d')!.getImageData(Math.floor(c.width / 4), Math.floor(c.height / 4), 1, 1).data
      return d[0]! + d[1]! + d[2]!
    }), { timeout: 15_000 }).toBeGreaterThan(30)
    await dialog.getByRole('checkbox', { name: /^Include:/ }).first().click()
    await dialog.getByRole('button', { name: /^Apply \d+ edit/ }).click()
    await expect(page.getByText(/^Applied \d+ edit/).first()).toBeVisible()
    await expect.poll(() => projectDuration(page)).not.toBe('0:29.1')
    expect(await clips(page, 'cap-').count()).toBeGreaterThan(0)
    await page.getByRole('banner').getByRole('button', { name: 'Undo' }).click()
    await expect.poll(() => projectDuration(page)).toBe('0:29.1')
    await expect(clips(page, 'cap-')).toHaveCount(0)
  })

  test('F12-E2 discard applies nothing', async ({ framevane }) => {
    const { page } = framevane
    await page.getByRole('button', { name: ASK }).click()
    await page.getByRole('button', { name: 'Discard' }).click({ timeout: 180_000 })
    await expect(page.getByText('Edits discarded.')).toBeVisible()
    await expect.poll(() => projectDuration(page)).toBe('0:29.1')
  })

  test('F12-E3 editing the timeline before applying blocks time-based edits', async ({ framevane }) => {
    const { page } = framevane
    await page.getByRole('button', { name: ASK }).click()
    await page.getByRole('button', { name: 'Review edits' }).waitFor({ timeout: 180_000 })
    await timeline(page).click({ position: { x: 160, y: 10 } })
    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('Control+b')
    await expect(clips(page)).toHaveCount(2)
    await page.getByRole('button', { name: 'Review edits' }).click()
    await page.getByRole('dialog', { name: "Review the agent's edits" }).getByRole('button', { name: /^Apply \d+ edit/ }).click()
    await expect(page.getByText(/timeline changed after the agent started/).first()).toBeVisible()
    await page.getByRole('dialog', { name: "Review the agent's edits" }).getByRole('button', { name: 'Close' }).click()
    await expect.poll(() => projectDuration(page)).toBe('0:29.1')
  })

  test('F12-E4 double-clicking a suggestion starts one run', async ({ framevane }) => {
    const { page } = framevane
    await page.getByRole('button', { name: ASK }).dblclick()
    await page.getByRole('button', { name: 'Review edits' }).waitFor({ timeout: 180_000 })
    await expect(page.getByRole('article', { name: 'Your message' })).toHaveCount(1)
  })

  test('F12-E5 stop mid-run cancels without a proposal', async ({ framevane }) => {
    const { page } = framevane
    await page.getByRole('button', { name: ASK }).click()
    await page.getByRole('button', { name: 'Stop' }).click()
    await expect(page.getByText('Stopped.')).toBeVisible()
    await page.waitForTimeout(2000)
    await expect(page.getByRole('button', { name: 'Review edits' })).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: 'Message the agent' })).toBeEditable()
  })
})

test.describe('F12 agent without credentials', () => {
  test.use({ pickFiles: [files.talk], reelEnv: { ANTHROPIC_API_KEY: '', ANTHROPIC_AUTH_TOKEN: '' } })
  test('F12-E1 no key shows how to connect a model', async ({ framevane }) => {
    const { page } = framevane
    await newProjectFromFiles(page)
    await expect(page.getByText('Connect an AI model')).toBeVisible()
    await page.getByRole('button', { name: 'Add API key' }).click()
    await expect(page.getByRole('tab', { name: 'Agents & AI', selected: true })).toBeVisible()
    await expect(page.getByLabel('Anthropic API key')).toBeVisible()
  })
})

test.describe('F12 agent with an invalid key (real API)', () => {
  test.use({ pickFiles: [files.talk], reelEnv: { ANTHROPIC_API_KEY: 'sk-ant-invalid-key-for-tests' } })
  test('F12-N1 a rejected key gives a clear message', async ({ framevane }) => {
    const { page } = framevane
    await newProjectFromFiles(page)
    await page.getByRole('textbox', { name: 'Message the agent' }).fill('Cut the silences')
    await page.getByRole('button', { name: 'Send' }).click()
    await expect(page.getByRole('alert').filter({ hasText: /API key was rejected/ })).toBeVisible({ timeout: 60_000 })
    await expect(page.getByRole('textbox', { name: 'Message the agent' })).toBeEditable()
  })
})
