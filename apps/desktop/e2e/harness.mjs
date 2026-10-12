import { _electron as electron } from '@playwright/test'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/** Launch the built app with an isolated profile. Collects console errors so every run can assert "no console errors". */
export async function launch({ pickFiles = [], saveDir, env = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'reel-e2e-'))
  const out = saveDir ?? join(root, 'exports')
  mkdirSync(out, { recursive: true })
  const app = await electron.launch({
    args: [resolve('.')],
    env: {
      ...process.env,
      REEL_USER_DATA: join(root, 'userdata'),
      REEL_PROJECTS_DIR: join(root, 'projects'),
      REEL_MODELS_DIR: process.env.REEL_MODELS_DIR ?? join(process.env.APPDATA ?? '', 'Reel', 'models'),
      REEL_TEST_PICK_FILES: pickFiles.join(';'),
      REEL_TEST_SAVE_DIR: out,
      ...env,
    },
  })
  const page = await app.firstWindow()
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))
  return { app, page, errors, root, exportsDir: out }
}
