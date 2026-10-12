// F12 · Ask the agent to edit → review proposal (S29) → apply → undo. Uses the test double model (FRAMEVANE_FAKE_AGENT=1)
// so it runs without an API key; every tool, the forked doc, the review UI and apply/undo are real.
import { resolve } from 'node:path'
import { launch } from './harness.mjs'

const SHOTS = resolve('../../replica/clone-screens')
const talk = resolve('../../replica/seed-media/talk.mp4')
const { app, page, errors } = await launch({ pickFiles: [talk], env: { FRAMEVANE_FAKE_AGENT: '1' } })
const step = (s) => console.log(`· ${s}`)
const shot = (id) => page.screenshot({ path: `${SHOTS}/${id}.png`, timeout: 10_000 })
const dur = async () => (await page.locator('dt:text("Duration") + dd').textContent())?.trim()

try {
  await page.getByRole('heading', { name: 'What are we making?' }).waitFor()
  await page.getByText('choose files').click()
  await page.locator('[data-clip-id]').first().waitFor({ timeout: 30_000 })
  await page.waitForTimeout(1500)
  const before = await dur()
  step(`project open, duration ${before}`)

  step('send a request from a suggestion chip')
  await page.getByRole('button', { name: 'Cut the silences and add captions' }).click()
  await page.getByRole('button', { name: 'Review edits' }).waitFor({ timeout: 180_000 })
  const steps = await page.locator('[aria-label="Agent conversation"] button[aria-expanded]').allTextContents()
  steps.forEach((s) => step(`  tool: ${s.replace(/\s+/g, ' ').trim()}`))
  await shot('S27-agent-proposal')

  step('S29 review: untick one edit, preview, apply')
  await page.getByRole('button', { name: 'Review edits' }).click()
  const dialog = page.getByRole('dialog', { name: "Review the agent's edits" })
  await dialog.waitFor()
  const rows = dialog.getByRole('checkbox', { name: /^Include:/ })
  const n = await rows.count()
  step(`  ${n} proposed edits`)
  await page.waitForTimeout(1200)
  await shot('S29-review')
  await rows.first().click() // exclude the latest cut
  await page.waitForTimeout(500)
  await dialog.getByRole('button', { name: /^Apply \d+ edit/ }).click()
  await page.getByText(/^Applied \d+ edit/).first().waitFor({ timeout: 20_000 })
  await page.waitForTimeout(500)
  const after = await dur()
  const caps = await page.locator('[data-clip-id^="cap-"]').count()
  step(`  applied: duration ${before} → ${after}, ${caps} caption clips`)
  await shot('S20-after-agent')
  if (after === before || caps === 0) throw new Error('agent edits did not land')

  step('undo restores the original')
  await page.locator('body').click({ position: { x: 700, y: 900 } })
  await page.keyboard.press('Control+z')
  await page.waitForFunction((d) => document.querySelector('dt + dd') && [...document.querySelectorAll('dt')].find((x) => x.textContent === 'Duration')?.nextElementSibling?.textContent?.trim() === d, before, { timeout: 10_000 })
  step(`  duration back to ${await dur()}, ${await page.locator('[data-clip-id^="cap-"]').count()} caption clips`)
} catch (e) {
  await shot('FAILURE-agent').catch(() => {})
  console.error('FAILED:', e)
  process.exitCode = 1
} finally {
  const real = errors.filter((e) => !/Download the React DevTools|Electron Security Warning/.test(e))
  console.log(real.length ? `CONSOLE ERRORS (${real.length}):\n${real.join('\n')}` : 'no console errors')
  await app.close()
}
