import { _electron as electron } from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/** Launch the built app with an isolated profile. Collects console errors so every run can assert "no console errors". */
export async function launch({ pickFiles = [], saveDir, env = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'framevane-e2e-'))
  const out = saveDir ?? join(root, 'exports')
  mkdirSync(out, { recursive: true })
  const app = await electron.launch({
    args: [resolve('.')],
    env: {
      ...process.env,
      FRAMEVANE_USER_DATA: join(root, 'userdata'),
      FRAMEVANE_PROJECTS_DIR: join(root, 'projects'),
      FRAMEVANE_MODELS_DIR: process.env.FRAMEVANE_MODELS_DIR ?? join(process.env.APPDATA ?? '', 'Framevane', 'models'),
      FRAMEVANE_TEST_PICK_FILES: pickFiles.join(';'),
      FRAMEVANE_TEST_SAVE_DIR: out,
      ...env,
    },
  })
  // the temp profile goes when the script ends (FRAMEVANE_KEEP_TEST_DIRS=1 keeps it)
  app.on('close', () => { if (!process.env.FRAMEVANE_KEEP_TEST_DIRS) setTimeout(() => { try { rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }) } catch { /* the next test run sweeps it */ } }, 800) })
  const page = await app.firstWindow()
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))
  return { app, page, errors, root, exportsDir: out }
}
