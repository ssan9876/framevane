// Screenshots of the M4 looks for a visual check (replica/clone-screens/M4-*.png).
import { resolve } from 'node:path'
import { launch } from './harness.mjs'
const seed = (f) => resolve('../../replica/seed-media', f)
const { app, page, errors } = await launch({ pickFiles: [seed('talk.mp4'), seed('broll.mp4')] })
const seek = async (s) => { await page.evaluate(() => document.activeElement?.blur()); await page.keyboard.press('Home'); for (let i = 0; i < s; i++) await page.keyboard.press('Shift+ArrowRight') }
const lib = (name) => page.getByRole('tablist', { name: 'Asset library' }).getByRole('tab', { name })
const props = (name) => page.getByRole('tablist', { name: 'Properties' }).getByRole('tab', { name })
const out = (n) => `../../replica/clone-screens/${n}.png`
try {
  await page.getByRole('button', { name: 'or choose files' }).click()
  await page.locator('[data-clip-id]').nth(1).waitFor()
  await page.waitForTimeout(1500)
  await page.locator('[data-clip-id]').first().click()
  await lib('Filters').click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: out('M4-filters-tab') })
  await page.getByRole('button', { name: 'Teal & orange filter' }).click()
  await lib('Effects').click()
  await page.getByRole('button', { name: 'Add Light leak effect' }).click()
  await props('Adjust').click()
  await seek(3)
  await page.waitForTimeout(900)
  await page.screenshot({ path: out('M4-looks') })
  await lib('Transitions').click()
  await page.getByRole('button', { name: 'Circle transition' }).click()
  await page.getByRole('slider', { name: 'Duration' }).focus()
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(600)
  await seek(29)
  await page.waitForTimeout(1200)
  await page.screenshot({ path: out('M4-transition') })
  console.log('console errors:', errors)
} finally { await app.close() }
