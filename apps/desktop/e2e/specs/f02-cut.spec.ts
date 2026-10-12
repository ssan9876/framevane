import type { Page } from '@playwright/test'
import { clips, expect, newProjectFromFiles, projectDuration, test, timeline } from '../fixtures'
import { files } from '../global-setup'

async function seekSeconds(page: Page, s: number) {
  await timeline(page).click({ position: { x: 160, y: 10 } })
  await page.keyboard.press('Home')
  for (let i = 0; i < s; i++) await page.keyboard.press('Shift+ArrowRight')
}

test.describe('F02 cut and trim', () => {
  test.use({ pickFiles: [files.talk] })
  test.beforeEach(async ({ framevane }) => {
    await newProjectFromFiles(framevane.page)
    await expect(clips(framevane.page)).toHaveCount(1)
  })

  test('F02-H1 split, delete (ripple), undo, redo', async ({ framevane }) => {
    const { page } = framevane
    await seekSeconds(page, 5)
    await page.keyboard.press('Control+b')
    await expect(clips(page)).toHaveCount(2)
    await clips(page).first().click()
    await page.keyboard.press('Delete')
    await expect(clips(page)).toHaveCount(1)
    await expect.poll(() => projectDuration(page)).toBe('0:24.1')
    await page.keyboard.press('Control+z')
    await expect(clips(page)).toHaveCount(2)
    await expect.poll(() => projectDuration(page)).toBe('0:29.1')
    await page.keyboard.press('Control+Shift+z')
    await expect(clips(page)).toHaveCount(1)
  })

  test('F02-H2 Q deletes left of the playhead, W deletes right', async ({ framevane }) => {
    const { page } = framevane
    await seekSeconds(page, 3)
    await page.keyboard.press('q')
    await expect.poll(() => projectDuration(page)).toBe('0:26.1')
    await seekSeconds(page, 10)
    await page.keyboard.press('w')
    await expect.poll(() => projectDuration(page)).toBe('0:10.0')
  })

  test('F02-H3 dragging the right edge trims and ripples', async ({ framevane }) => {
    const { page } = framevane
    const clip = clips(page).first()
    const box = (await clip.boundingBox())!
    await page.mouse.move(box.x + box.width - 3, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 })
    await page.mouse.up()
    await expect.poll(() => projectDuration(page)).not.toBe('0:29.1')
    const d = await projectDuration(page)
    expect(Number(d!.split(':')[1])).toBeLessThan(20)
  })

  test('F02-E7 trimming cannot extend past the end of the source', async ({ framevane }) => {
    const { page } = framevane
    const clip = clips(page).first()
    const box = (await clip.boundingBox())!
    await page.mouse.move(box.x + box.width - 3, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width + 400, box.y + box.height / 2, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(500)
    await expect.poll(() => projectDuration(page)).toBe('0:29.1')
  })

  test('F02-H4 dragging a main-track clip before another reorders without gaps', async ({ framevane }) => {
    const { page } = framevane
    await seekSeconds(page, 10)
    await page.keyboard.press('Control+b')
    await expect(clips(page)).toHaveCount(2)
    const ids = await clips(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-clip-id')))
    const second = clips(page).nth(1)
    const b = (await second.boundingBox())!
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x - 300, b.y + b.height / 2, { steps: 10 })
    await page.mouse.up()
    await expect.poll(async () => clips(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-clip-id')))).toEqual([ids[1], ids[0]])
    await expect.poll(() => projectDuration(page)).toBe('0:29.1')
  })

  test('F02-E1 splitting exactly at a clip boundary does nothing', async ({ framevane }) => {
    const { page } = framevane
    await seekSeconds(page, 0)
    await page.keyboard.press('Control+b')
    await page.waitForTimeout(300)
    await expect(clips(page)).toHaveCount(1)
  })

  test('F02-E3 Delete with nothing selected does nothing', async ({ framevane }) => {
    const { page } = framevane
    await page.keyboard.press('Escape')
    await page.keyboard.press('Delete')
    await page.waitForTimeout(300)
    await expect(clips(page)).toHaveCount(1)
  })

  test('F02-E4 a locked track refuses split and delete', async ({ framevane }) => {
    const { page } = framevane
    await page.getByRole('button', { name: 'Lock Main' }).click()
    await seekSeconds(page, 4)
    await page.keyboard.press('Control+b')
    await clips(page).first().click()
    await page.keyboard.press('Delete')
    await page.waitForTimeout(300)
    await expect(clips(page)).toHaveCount(1)
    await expect.poll(() => projectDuration(page)).toBe('0:29.1')
    await page.getByRole('button', { name: 'Unlock Main' }).click()
  })

  test('F02-E5 undo stops at the first state', async ({ framevane }) => {
    const { page } = framevane
    await seekSeconds(page, 4)
    await page.keyboard.press('Control+b')
    await expect(clips(page)).toHaveCount(2)
    for (let i = 0; i < 20; i++) await page.keyboard.press('Control+z')
    await expect(clips(page)).toHaveCount(1)
    await expect(page.getByRole('banner').getByRole('button', { name: 'Undo' })).toBeDisabled()
  })

  test('F02-E6 an edit survives the app being killed right after it', async ({ framevane }) => {
    let page = framevane.page
    await seekSeconds(page, 6)
    await page.keyboard.press('Control+b')
    await expect(clips(page)).toHaveCount(2)
    // kill well inside the 2 s autosave window: only the op journal has the split
    page = await framevane.relaunch({ kill: true })
    await page.getByRole('button', { name: /^Open / }).first().click()
    await expect(clips(page)).toHaveCount(2)
  })
})
