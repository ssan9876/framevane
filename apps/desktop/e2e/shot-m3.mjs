// Screenshots of the M3 text, caption and audio features for a visual check (replica/clone-screens/M3-*.png).
import { resolve } from 'node:path'
import { launch } from './harness.mjs'
const { app, page, errors } = await launch({ pickFiles: [resolve('../../replica/seed-media/talk.mp4')] })
const seek = async (s) => { await page.keyboard.press('Home'); for (let i = 0; i < s; i++) await page.keyboard.press('Shift+ArrowRight') }
try {
  await page.getByRole('button', { name: 'or choose files' }).click()
  await page.locator('[data-clip-id]').first().waitFor()
  await page.waitForTimeout(1200)
  await seek(1)
  await page.getByRole('tab', { name: 'Text' }).click()
  await page.getByRole('button', { name: 'Add Headline text' }).click()
  await seek(2)
  await page.waitForTimeout(800)
  await page.screenshot({ path: '../../replica/clone-screens/M3-text.png' })
  await page.getByRole('tab', { name: 'Captions' }).click()
  await page.getByRole('button', { name: /Generate captions/ }).click()
  await page.locator('[data-clip-id^="cap-"]').first().waitFor({ timeout: 120_000 })
  await page.locator('[data-clip-id^="cap-"]').first().click()
  await page.getByRole('button', { name: 'Bold pop' }).click()
  await page.getByRole('button', { name: 'Show transcript' }).click()
  await page.getByRole('listbox', { name: 'Transcript words' }).waitFor({ timeout: 60_000 })
  await seek(3)
  await page.waitForTimeout(800)
  await page.screenshot({ path: '../../replica/clone-screens/M3-captions.png' })
  console.log('console errors:', errors)
} finally { await app.close() }
