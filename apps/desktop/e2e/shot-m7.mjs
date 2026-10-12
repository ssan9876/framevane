// Screenshots of the M7 photo editor (replica/clone-screens/M7-*.png).
import { resolve } from 'node:path'
import { launch } from './harness.mjs'
const { app, page, errors } = await launch({ pickFiles: [resolve('../../replica/seed-media/still.png')] })
const tools = page.getByRole('region', { name: 'Layers and tools' })
try {
  await page.getByRole('button', { name: /Photo editor/ }).click()
  await page.getByRole('img', { name: /^Photo / }).waitFor()
  await page.waitForTimeout(800)
  await tools.getByRole('tab', { name: 'Add' }).click()
  await tools.getByRole('button', { name: 'Add Headline text' }).click()
  await tools.getByRole('button', { name: 'Add Star', exact: true }).click()
  await tools.getByRole('button', { name: 'Add fire sticker', exact: true }).click()
  await tools.getByRole('tab', { name: 'Layers' }).click()
  await page.waitForTimeout(800)
  await page.screenshot({ path: '../../replica/clone-screens/M7-photo.png' })
  await tools.getByRole('tab', { name: 'Canvas' }).click()
  await tools.getByRole('button', { name: 'Crop…' }).click()
  await tools.getByRole('combobox', { name: 'Shape' }).click()
  await page.getByRole('option', { name: '1:1' }).click()
  await page.waitForTimeout(500)
  await page.screenshot({ path: '../../replica/clone-screens/M7-crop.png' })
  console.log('console errors:', errors)
} finally { await app.close() }
