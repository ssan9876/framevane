// Screenshot of the M1 editing features for a visual check (replica/clone-screens/M1-editing.png).
import { resolve } from 'node:path'
import { launch } from './harness.mjs'
const { app, page } = await launch({ pickFiles: [resolve('../../replica/seed-media/talk.mp4')] })
const seek = async (s) => { await page.keyboard.press('Home'); for (let i = 0; i < s; i++) await page.keyboard.press('Shift+ArrowRight') }
try {
  await page.getByRole('button', { name: 'or choose files' }).click()
  await page.locator('[data-clip-id]').first().waitFor()
  await page.waitForTimeout(1200)
  // vertical canvas with blurred background
  await page.getByRole('button', { name: 'Modify canvas…' }).click()
  await page.getByRole('combobox', { name: 'Aspect ratio' }).click()
  await page.getByRole('option', { name: /9:16/ }).click()
  await page.getByRole('button', { name: 'Save' }).click()
  await page.getByRole('radio', { name: 'Blur' }).click()
  // detach audio, marker, keyframes
  await page.locator('[data-clip-id]').first().click()
  await page.keyboard.press('Control+Shift+s')
  await seek(1); await page.keyboard.press('m')
  await page.keyboard.press('Escape')
  await page.locator('[data-clip-id]').first().click({ modifiers: ['Alt'] })
  await page.keyboard.press('`') // linkage off so the video alone is selected
  await page.keyboard.press('Escape')
  await page.locator('[data-clip-id]').first().click()
  await seek(0)
  await page.getByRole('button', { name: 'Add Scale keyframe at playhead' }).click()
  await seek(3)
  const f = page.getByRole('spinbutton', { name: 'Scale' }); await f.fill('160'); await f.press('Enter')
  await page.waitForTimeout(500)
  await seek(2)
  await page.waitForTimeout(900)
  await page.screenshot({ path: '../../replica/clone-screens/M1-editing.png' })
} finally { await app.close() }
