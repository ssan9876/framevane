import { copyFileSync, existsSync, rmSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { clips, expect, isBlank, newProjectFromFiles, previewPixel, projectDuration, test, timeline } from '../fixtures'
import { files } from '../global-setup'

/** Milestone 1: keyframes, on-canvas handles, crop/blend/background, clipboard, detach audio, freeze, reverse, groups, markers, proxies, relink. */

async function seekSeconds(page: Page, s: number) {
  await timeline(page).click({ position: { x: 160, y: 10 } })
  await page.keyboard.press('Home')
  for (let i = 0; i < s; i++) await page.keyboard.press('Shift+ArrowRight')
}
/** Seek with the keyboard only (clicking the ruler would deselect the clip being edited). */
async function seekKeys(page: Page, s: number) {
  await page.keyboard.press('Home')
  for (let i = 0; i < s; i++) await page.keyboard.press('Shift+ArrowRight')
}
const mainClip = (page: Page) => clips(page).first()
async function setField(page: Page, label: string, value: string) {
  const f = page.getByRole('spinbutton', { name: label })
  await f.fill(value)
  await f.press('Enter')
  await page.waitForTimeout(450) // inspector commits 250 ms after the last change
}

test.describe('M1 timeline and canvas editing', () => {
  test.use({ pickFiles: [files.talk] })
  test.beforeEach(async ({ framevane }) => {
    await newProjectFromFiles(framevane.page)
    await expect(clips(framevane.page)).toHaveCount(1)
  })

  test('keyframes: key scale at 0 and 2 s, interpolate, survive a split, clear', async ({ framevane }) => {
    const { page } = framevane
    await seekSeconds(page, 0)
    await mainClip(page).click()
    await page.getByRole('button', { name: 'Add Scale keyframe at playhead' }).click()
    await expect(page.getByRole('button', { name: 'Remove Scale keyframe at playhead' })).toBeVisible()
    await seekKeys(page, 2)
    await setField(page, 'Scale', '200') // animated → auto-key at 2 s
    await expect(page.getByRole('button', { name: 'Remove Scale keyframe at playhead' })).toBeVisible()
    await seekKeys(page, 1)
    await expect.poll(async () => Number(await page.getByRole('spinbutton', { name: 'Scale' }).inputValue())).toBeGreaterThan(110)
    await expect.poll(async () => Number(await page.getByRole('spinbutton', { name: 'Scale' }).inputValue())).toBeLessThan(190)
    const midBefore = await page.getByRole('spinbutton', { name: 'Scale' }).inputValue()
    // split at 1 s: the right part starts exactly where the animation was
    await page.keyboard.press('Control+b')
    await expect(clips(page)).toHaveCount(2)
    await clips(page).nth(1).click()
    await expect(page.getByRole('spinbutton', { name: 'Scale' })).toHaveValue(midBefore)
    // easing + clear
    await page.getByRole('button', { name: 'Clear keyframes' }).click()
    await expect(page.getByRole('button', { name: 'Add Scale keyframe at playhead' })).toBeVisible()
  })

  test('on-canvas: drag the selected picture to move it, undo', async ({ framevane }) => {
    const { page } = framevane
    await seekSeconds(page, 1)
    const canvas = page.getByRole('img', { name: /^Preview at / })
    const b = (await canvas.boundingBox())!
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2) // click on the picture selects it
    const handles = page.getByRole('group', { name: /Selected clip on canvas/ })
    await expect(handles).toBeVisible()
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width / 2 + 60, b.y + b.height / 2 + 30, { steps: 8 })
    await page.mouse.up()
    await expect.poll(async () => Number(await page.getByRole('spinbutton', { name: 'Position X' }).inputValue())).toBeGreaterThan(100)
    await page.keyboard.press('Control+z')
    await expect.poll(async () => Number(await page.getByRole('spinbutton', { name: 'Position X' }).inputValue())).toBe(0)
  })

  test('crop, blend mode and blurred background', async ({ framevane }) => {
    const { page } = framevane
    await seekSeconds(page, 1)
    await mainClip(page).click()
    await page.getByRole('radio', { name: 'Crop' }).click()
    await setField(page, 'Left', '30')
    // the left 30% of the picture is gone: the left edge of the canvas shows the black background
    await expect.poll(async () => isBlank(await previewPixel(page, 0.05, 0.5))).toBe(true)
    await page.getByRole('radio', { name: 'Basic' }).click()
    await page.getByRole('combobox', { name: 'Blend' }).click()
    await page.getByRole('option', { name: 'Screen' }).click()
    await expect(page.getByRole('combobox', { name: 'Blend' })).toContainText('Screen')
    // nothing selected → project panel → blurred background fills the cropped-away area
    await page.keyboard.press('Escape')
    await page.getByRole('radio', { name: 'Blur' }).click()
    await expect.poll(async () => isBlank(await previewPixel(page, 0.05, 0.5))).toBe(false)
  })

  test('copy, paste (inserts on the magnet track) and duplicate', async ({ framevane }) => {
    const { page } = framevane
    await mainClip(page).click()
    await page.keyboard.press('Control+c')
    await page.keyboard.press('End')
    await page.keyboard.press('Control+v')
    await expect(clips(page)).toHaveCount(2)
    await expect.poll(() => projectDuration(page)).toBe('0:58.3')
    await page.keyboard.press('Control+d')
    await expect(clips(page)).toHaveCount(3)
    await page.keyboard.press('Control+z')
    await page.keyboard.press('Control+z')
    await expect(clips(page)).toHaveCount(1)
  })

  test('detach audio: linked audio clip, linkage selects both, delete removes both', async ({ framevane }) => {
    const { page } = framevane
    await mainClip(page).click()
    await page.keyboard.press('Control+Shift+s')
    await expect(clips(page)).toHaveCount(2)
    await expect(page.getByRole('gridcell', { name: /audio detached/ })).toBeVisible()
    await expect(page.getByRole('rowheader', { name: /Audio 1/ })).toBeVisible()
    await page.keyboard.press('Escape')
    await mainClip(page).click()
    await expect(page.getByRole('heading', { name: '2 clips selected' })).toBeVisible()
    await page.keyboard.press('Delete')
    await expect(clips(page)).toHaveCount(0)
  })

  test('freeze frame inserts a 3 s still and pushes the rest right', async ({ framevane }) => {
    const { page } = framevane
    await seekSeconds(page, 2)
    await page.getByRole('toolbar', { name: 'Timeline tools' }).getByRole('button', { name: 'Freeze frame' }).click()
    await expect(clips(page)).toHaveCount(3)
    await expect(page.getByRole('gridcell', { name: /^Freeze · talk\.mp4/ })).toBeVisible()
    await expect.poll(() => projectDuration(page)).toBe('0:32.1')
  })

  test('reverse renders the range backwards and keeps the length', async ({ framevane }) => {
    const { page } = framevane
    await seekSeconds(page, 3)
    await page.keyboard.press('Control+b')
    await clips(page).first().click() // the 3 s piece
    await page.getByRole('toolbar', { name: 'Timeline tools' }).getByRole('button', { name: 'Reverse' }).click()
    await expect(page.getByRole('gridcell', { name: /reversed/ })).toBeVisible({ timeout: 90_000 })
    await expect.poll(() => projectDuration(page)).toBe('0:29.1')
  })

  test('V disables a clip; groups select together; markers add, jump, delete', async ({ framevane }) => {
    const { page } = framevane
    await mainClip(page).click()
    await page.keyboard.press('v')
    await expect(page.getByRole('gridcell', { name: /, disabled/ })).toBeVisible()
    await page.keyboard.press('v')
    // two clips → group
    await seekSeconds(page, 5)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Control+b')
    await clips(page).first().click()
    await clips(page).nth(1).click({ modifiers: ['Shift'] })
    await page.keyboard.press('Control+g')
    await page.keyboard.press('Escape')
    await clips(page).first().click()
    await expect(page.getByRole('heading', { name: '2 clips selected' })).toBeVisible()
    // markers
    await page.keyboard.press('Escape')
    await seekSeconds(page, 2)
    await page.keyboard.press('m')
    await seekSeconds(page, 6)
    await page.keyboard.press('m')
    await expect(page.getByRole('button', { name: /^Marker at / })).toHaveCount(2)
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+m')
    await expect(page.getByRole('timer', { name: /^Timecode 00:00:02:00/ })).toBeVisible()
    await page.getByRole('button', { name: /^Marker at 2\.00/ }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Delete marker' }).click()
    await expect(page.getByRole('button', { name: /^Marker at / })).toHaveCount(1)
  })
})

test.describe('M1 proxies', () => {
  test.use({ pickFiles: [files.uhd] })
  test('4K media gets a proxy and still previews', async ({ framevane }) => {
    const { page } = framevane
    await newProjectFromFiles(page)
    await expect.poll(() => page.evaluate(async () => (await window.framevane.media.list((await window.framevane.projects.list())[0]!.id))[0]?.hasProxy), { timeout: 60_000 }).toBe(true)
    await expect.poll(async () => isBlank(await previewPixel(page)), { timeout: 20_000 }).toBe(false)
  })
})

test.describe('M1 relink', () => {
  test.use({ pickFiles: [files.relink] })
  test('a moved file can be located again', async ({ framevane }) => {
    copyFileSync(files.broll, files.relink)
    const { page } = framevane
    await newProjectFromFiles(page)
    await expect(clips(page)).toHaveCount(1)
    await page.getByRole('button', { name: 'Projects' }).click()
    rmSync(files.relink)
    await page.getByRole('button', { name: /^Open / }).click()
    await expect(page.getByRole('button', { name: 'Locate relink-me.mp4' })).toBeVisible()
    copyFileSync(files.broll, files.relink) // "found it again" (the test picker returns this path)
    await page.getByRole('button', { name: 'Locate relink-me.mp4' }).click()
    await expect(page.getByText('Found relink-me.mp4').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Locate relink-me.mp4' })).toHaveCount(0)
    await expect.poll(async () => isBlank(await previewPixel(page)), { timeout: 20_000 }).toBe(false)
    if (existsSync(files.relink)) rmSync(files.relink)
  })
})
