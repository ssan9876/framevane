// Screenshot of the M5 model manager for a visual check (replica/clone-screens/M5-models.png). No people on screen.
import { launch } from './harness.mjs'
const { app, page, errors } = await launch()
try {
  await page.getByRole('heading', { name: 'What are we making?' }).waitFor()
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('tab', { name: 'AI models' }).click()
  await page.getByRole('list', { name: 'AI models' }).waitFor({ timeout: 60_000 })
  await page.waitForTimeout(500)
  await page.screenshot({ path: '../../replica/clone-screens/M5-models.png' })
  console.log('console errors:', errors)
} finally { await app.close() }
