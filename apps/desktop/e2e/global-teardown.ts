import { readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Sweep what the run left in the temp folder (framevane-*: test profiles, scratch files). Each test removes its own
 * profile, but a killed app's helper processes can hold files a moment longer. FRAMEVANE_KEEP_TEST_DIRS=1 keeps them.
 */
export default async function globalTeardown() {
  if (process.env.FRAMEVANE_KEEP_TEST_DIRS) return
  await new Promise((r) => setTimeout(r, 1500))
  for (const name of readdirSync(tmpdir())) {
    if (!name.startsWith('framevane-')) continue
    try { rmSync(join(tmpdir(), name), { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }) } catch { /* still locked: the next run sweeps it */ }
  }
}
