// Smoke-test the release zip the way a user gets it: unzip into a fresh folder, start Framevane.exe with a clean
// profile, check the bundled FFmpeg and uv are used, import + export a clip, and start the local AI.
import { _electron as electron } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const zip = resolve(process.argv[2])
const root = mkdtempSync(join(tmpdir(), 'framevane-release-'))
const TAR = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
spawnSync(TAR, ['-xf', zip, '-C', root], { stdio: 'inherit' })
const exe = join(root, 'Framevane-win32-x64', 'Framevane.exe')
const talk = resolve('../../replica/seed-media/talk.mp4')
const out = join(root, 'exports')
mkdirSync(out, { recursive: true })
const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1 }
// a user's PATH: no FFmpeg, no uv
const PATH = (process.env.PATH ?? '').split(';').filter((p) => !/ffmpeg|\.local\\bin|uv/i.test(p)).join(';')
const app = await electron.launch({
  executablePath: exe,
  env: { ...process.env, PATH, FRAMEVANE_USER_DATA: join(root, 'userdata'), FRAMEVANE_PROJECTS_DIR: join(root, 'projects'), FRAMEVANE_TEST_PICK_FILES: talk, FRAMEVANE_TEST_SAVE_DIR: out },
})
const page = await app.firstWindow()
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
try {
  await page.getByRole('heading', { name: 'What are we making?' }).waitFor({ timeout: 60_000 })
  const info = await page.evaluate(() => window.framevane.app.info())
  console.log('version', info.version, '| ffmpeg', info.ffmpeg)
  if (!info.ffmpeg?.includes('resources')) fail('FFmpeg is not the bundled one')
  await page.getByRole('button', { name: 'or choose files' }).click()
  await page.locator('[data-clip-id]').first().waitFor({ timeout: 60_000 })
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const d = page.getByRole('dialog', { name: 'Export', exact: true })
  await d.getByRole('radio', { name: 'From… to…' }).click()
  const to = d.getByRole('spinbutton', { name: 'To', exact: true })
  await to.fill('3'); await to.press('Enter')
  await d.getByRole('button', { name: 'Export…' }).click()
  await d.waitFor({ state: 'hidden', timeout: 120_000 }).catch(async (e) => { console.log('dialog says:', (await d.innerText()).replace(/\s+/g, ' ').slice(0, 600)); console.log('errors so far:', JSON.stringify(errors)); throw e })
  const mp4 = existsSync(out) ? readdirSync(out).find((f) => f.endsWith('.mp4')) : null
  console.log('export', mp4 ?? 'missing')
  if (!mp4) fail('export failed')
  const t0 = Date.now()
  const health = await page.evaluate(() => window.framevane.storage.aiHealth())
  console.log(`local AI up in ${Math.round((Date.now() - t0) / 1000)} s:`, JSON.stringify(health))
  if (!existsSync(join(root, 'userdata', 'sidecar-env'))) fail('sidecar environment not in app data')
  console.log('console errors:', JSON.stringify(errors))
  if (errors.length) fail('console errors')
} finally {
  await app.close()
  setTimeout(() => { try { rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }) } catch { /* swept by the test teardown */ } }, 1000)
}
