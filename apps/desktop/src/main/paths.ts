import { app } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

/** All app-owned locations. Projects default to Documents\Framevane Projects; caches live under %LOCALAPPDATA%-style userData. */
export function appPaths() {
  const userData = app.getPath('userData')
  const projectsDir = process.env.FRAMEVANE_PROJECTS_DIR ?? join(app.getPath('documents'), 'Framevane Projects')
  const cacheDir = process.env.FRAMEVANE_CACHE_DIR ?? join(userData, 'cache')
  const p = {
    userData,
    db: join(userData, 'app.db'),
    projectsDir,
    cacheDir,
    thumbs: join(cacheDir, 'thumbs'),
    peaks: join(cacheDir, 'peaks'),
    mezzanine: join(cacheDir, 'mezzanine'),
    transcripts: join(cacheDir, 'transcripts'),
    models: process.env.FRAMEVANE_MODELS_DIR ?? join(userData, 'models'),
  }
  for (const d of [p.projectsDir, p.thumbs, p.peaks, p.mezzanine, p.transcripts, p.models]) mkdirSync(d, { recursive: true })
  return p
}
export type AppPaths = ReturnType<typeof appPaths>
