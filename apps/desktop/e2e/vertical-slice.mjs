// M0 vertical slice, end to end through the UI: import → cut → auto-caption → export, plus screenshots for replica-diff.
// Usage: node e2e/vertical-slice.mjs   (after `node scripts/build.mjs`; needs replica/seed-media from make-seed-media.ps1)
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { launch } from './harness.mjs'

const SEED = resolve('../../replica/seed-media')
const SHOTS = resolve('../../replica/clone-screens')
mkdirSync(SHOTS, { recursive: true })
const talk = resolve(SEED, 'talk.mp4')
if (!existsSync(talk)) throw new Error('Run scripts/make-seed-media.ps1 first')

const { app, page, errors, exportsDir } = await launch({ pickFiles: [talk, resolve(SEED, 'music.m4a'), resolve(SEED, 'broll.mp4')] })
const shot = async (id) => {
  try {
    await page.screenshot({ path: `${SHOTS}/${id}.png`, timeout: 10_000 })
  } catch (e) {
    const js = await Promise.race([page.evaluate(() => 'responsive'), new Promise((r) => setTimeout(() => r('JS FROZEN'), 3000))])
    throw new Error(`screenshot ${id} failed (renderer ${js}): ${e.message.split('\n')[0]}`)
  }
}
const step = (s) => console.log(`· ${s}`)
const clips = (prefix = '') => page.locator(prefix ? `[data-clip-id^="${prefix}"]` : '[data-clip-id]')
const waitCount = (n, prefix = '') => page.waitForFunction(([n, p]) => document.querySelectorAll(p ? `[data-clip-id^="${p}"]` : '[data-clip-id]').length === n, [n, prefix])
const timeline = () => page.getByRole('grid', { name: 'Timeline tracks' })

try {
  step('S01 home (empty)')
  await page.getByRole('heading', { name: 'What are we making?' }).waitFor()
  await shot('S01-empty')

  step('F01 new project + import via the media panel')
  await page.getByRole('button', { name: /New project/ }).click()
  await page.getByRole('tab', { name: 'Media' }).waitFor()
  await shot('S03-empty')
  await page.getByRole('button', { name: 'Import', exact: true }).first().click()
  await page.getByText('talk.mp4').first().waitFor()
  await page.waitForFunction(() => document.querySelectorAll('[aria-label="Add talk.mp4 to timeline"]').length > 0, null, { timeout: 60_000 })
  await page.waitForTimeout(1500)
  await shot('S04-media')

  step('add talk.mp4 to the timeline')
  await page.getByRole('button', { name: 'Add talk.mp4 to timeline' }).click({ force: true })
  await clips().first().waitFor()
  await page.waitForTimeout(1000)
  await shot('S03-filled')

  step('F02 split at 5 s with Ctrl+B, delete the first part, undo, redo')
  await timeline().click({ position: { x: 160, y: 10 } })
  await page.keyboard.press('Home')
  for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('Control+b')
  await waitCount(2)
  await clips().first().click()
  await page.keyboard.press('Delete')
  await waitCount(1)
  await page.keyboard.press('Control+z')
  await waitCount(2)
  await page.keyboard.press('Control+Shift+z')
  await waitCount(1)
  await shot('S20-after-cut')

  step('F04 auto captions (local Whisper)')
  await page.getByRole('tab', { name: 'Captions' }).click()
  await page.getByRole('button', { name: /Generate captions/ }).click()
  await page.getByText(/Added \d+ caption lines/).first().waitFor({ timeout: 180_000 })
  step(`  ${await clips('cap-').count()} caption clips`)
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+ArrowRight')
  await page.waitForTimeout(1000)
  await shot('S11-captions')

  step('select a caption → inspector')
  await clips('cap-').nth(1).click()
  await page.getByText('Style · applies to all captions').waitFor()
  await shot('S19-caption-inspector')

  step('S02 project settings')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Modify canvas…' }).click()
  await page.getByRole('dialog', { name: 'Project settings' }).waitFor()
  await shot('S02-project-settings')
  await page.getByRole('button', { name: 'Cancel' }).click()

  step('S27 agent panel, S23/S28/S24 settings')
  await shot('S27-agent-empty')
  await page.getByRole('button', { name: 'Settings' }).first().click()
  await page.getByRole('tab', { name: 'Agents & AI' }).click()
  await shot('S28-agents-settings')
  await page.getByRole('tab', { name: 'Shortcuts' }).click()
  await shot('S24-shortcuts')
  await page.keyboard.press('Escape')

  step('F10 export (H.264)')
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await page.getByRole('dialog', { name: 'Export video' }).waitFor()
  await shot('S22-export')
  await page.getByRole('button', { name: 'Export…' }).click()
  await page.getByText('Your video is ready').first().waitFor({ timeout: 300_000 })
  const out = readdirSync(exportsDir).find((f) => f.endsWith('.mp4'))
  const file = resolve(exportsDir, out)
  step(`  exported ${file} (${(statSync(file).size / 1e6).toFixed(2)} MB)`)
  console.log(`EXPORT=${file}`)

  step('back home (S01 filled)')
  await page.getByRole('button', { name: 'Projects' }).click()
  await page.getByRole('heading', { name: 'What are we making?' }).waitFor()
  await page.waitForTimeout(800)
  await shot('S01-filled')
} catch (e) {
  await shot('FAILURE').catch(() => {})
  console.error('FAILED:', e)
  process.exitCode = 1
} finally {
  const real = errors.filter((e) => !/Download the React DevTools|Electron Security Warning/.test(e))
  console.log(real.length ? `CONSOLE ERRORS (${real.length}):\n${real.join('\n')}` : 'no console errors')
  await app.close()
}
