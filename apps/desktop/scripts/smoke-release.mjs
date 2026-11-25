// Smoke-test the release zip the way a user gets it: unzip into a fresh folder, start Framevane (Framevane.exe, or
// Framevane.app on a Mac) with a clean profile, check the bundled FFmpeg and uv are used, import + export a clip, and
// start the local AI. Usage: node scripts/smoke-release.mjs release/Framevane-<version>-<platform>.zip
import { _electron as electron } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const MAC = process.platform === 'darwin'
const zip = resolve(process.argv[2])
const root = mkdtempSync(join(tmpdir(), 'framevane-release-'))
if (MAC) spawnSync('ditto', ['-x', '-k', zip, root], { stdio: 'inherit' })
else spawnSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', root], { stdio: 'inherit' })
const exe = MAC ? join(root, 'Framevane.app', 'Contents', 'MacOS', 'Framevane') : join(root, 'Framevane-win32-x64', 'Framevane.exe')
if (!existsSync(exe)) throw new Error(`${exe} is not in the zip`)
// the clip to import: the e2e seed media when it's there; otherwise (CI's package job runs apart from the tests) a
// 6 s test clip with sound, made with the release's own bundled FFmpeg, which also shows that FFmpeg runs
let talk = resolve('../../replica/seed-media/talk.mp4')
if (!existsSync(talk)) {
  const ff = MAC ? join(root, 'Framevane.app', 'Contents', 'Resources', 'ffmpeg', 'ffmpeg') : join(root, 'Framevane-win32-x64', 'resources', 'ffmpeg', 'ffmpeg.exe')
  talk = join(root, 'smoke-clip.mp4')
  const r = spawnSync(ff, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=6', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', talk], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`the bundled FFmpeg couldn't make a test clip: ${r.stderr || r.error?.message}`)
  console.log('made a test clip with the bundled FFmpeg')
}
const out = join(root, 'exports')
mkdirSync(out, { recursive: true })
const fail = (m) => { console.error('FAIL:', m); process.exitCode = 1 }
// a user's PATH: no FFmpeg, no uv (on a Mac also no Homebrew; the app adds those folders itself, so hide them)
const SEP = MAC ? ':' : ';'
const PATH = (process.env.PATH ?? '').split(SEP).filter((p) => !/ffmpeg|\.local[\\/]bin|uv|homebrew|\/usr\/local\/bin/i.test(p)).join(SEP)
const app = await electron.launch({
  executablePath: exe,
  env: {
    ...process.env, PATH, FRAMEVANE_USER_DATA: join(root, 'userdata'), FRAMEVANE_PROJECTS_DIR: join(root, 'projects'), FRAMEVANE_TEST_PICK_FILES: talk, FRAMEVANE_TEST_SAVE_DIR: out,
    // the app widens PATH with Homebrew's folders on a Mac; point it at a home with none, so only the bundled tools exist
    ...(MAC ? { HOME: join(root, 'home') } : {}),
  },
})
const page = await app.firstWindow()
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
try {
  await page.getByRole('heading', { name: 'What are we making?' }).waitFor({ timeout: 60_000 })
  const info = await page.evaluate(() => window.framevane.app.info())
  console.log('version', info.version, '| platform', info.platform, '| ffmpeg', info.ffmpeg)
  if (!/resources/i.test(info.ffmpeg ?? '')) fail('FFmpeg is not the bundled one')
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
  if (process.env.FRAMEVANE_SMOKE_SKIP_AI !== '1') {
    const t0 = Date.now()
    const health = await page.evaluate(() => window.framevane.storage.aiHealth())
    console.log(`local AI up in ${Math.round((Date.now() - t0) / 1000)} s:`, JSON.stringify(health))
    if (!existsSync(join(root, 'userdata', 'sidecar-env'))) fail('sidecar environment not in app data')
  }
  console.log('console errors:', JSON.stringify(errors))
  if (errors.length) fail('console errors')
} finally {
  await app.close()
  setTimeout(() => { try { rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }) } catch { /* swept by the test teardown */ } }, 1000)
}
