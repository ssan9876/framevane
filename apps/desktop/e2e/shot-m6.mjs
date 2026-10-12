// Screenshots of the M6 export dialog and performance settings (replica/clone-screens/M6-*.png).
import { resolve } from 'node:path'
import { launch } from './harness.mjs'
const { app, page, errors } = await launch({ pickFiles: [resolve('../../replica/seed-media/talk.mp4')] })
try {
  await page.getByRole('button', { name: 'or choose files' }).click()
  await page.locator('[data-clip-id]').first().waitFor()
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const d = page.getByRole('dialog', { name: 'Export', exact: true })
  await d.getByRole('combobox', { name: 'Codec' }).click()
  await page.waitForTimeout(400)
  const opts = await page.getByRole('option').allTextContents()
  console.log('codec options:', opts.join(' | '))
  await page.keyboard.press('Escape')
  await d.getByRole('radio', { name: 'From… to…' }).click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: '../../replica/clone-screens/M6-export.png' })
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('tab', { name: 'Performance' }).click()
  await page.getByRole('list', { name: 'Caches' }).waitFor()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: '../../replica/clone-screens/M6-performance.png' })
  console.log('console errors:', errors)
} finally { await app.close() }
