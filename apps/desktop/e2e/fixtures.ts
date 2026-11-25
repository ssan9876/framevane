import { test as base, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { spawnSync, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * Electron fixture: every test gets a fresh, isolated profile (userData, projects, exports) unless it asks to reuse one.
 * Every test fails on console errors and on media-protocol 5xx responses. a11y() runs axe on the current screen.
 */

export interface Framevane {
  app: ElectronApplication
  page: Page
  errors: string[]
  failedRequests: { url: string; status: number }[]
  root: string
  exportsDir: string
  /** Close and start again with the same profile (restart / crash-recovery tests). */
  relaunch(opts?: { kill?: boolean }): Promise<Page>
}

type Options = { pickFiles: string[]; reelEnv: Record<string, string>; allowConsoleErrors: RegExp[] }

/**
 * Windows doesn't end a process's children when it exits, so a closed or killed app can leave FFmpeg, the AI sidecar
 * (uv → python) or Chromium helpers running. Every Windows CI run then ended with "Worker teardown timeout" after all
 * tests passed. These list an app's descendants while it runs and end the ones still alive after it has closed.
 *
 * A process is identified by its id AND its start time: Windows reuses ids quickly, and ending a recorded id that now
 * belongs to something else (the CI runner's own process, say) is how a runner "loses communication with the server".
 */
type Proc = { pid: number; parent: number; started: string }
function processTable(): Map<number, Proc> {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $($_.CreationDate.Ticks)" }'], { encoding: 'utf8', windowsHide: true, timeout: 20_000 })
  const table = new Map<number, Proc>()
  for (const line of (r.stdout ?? '').split(/\r?\n/)) {
    const [pid, parent, started] = line.trim().split(' ')
    if (pid && parent && started && /^\d+$/.test(pid) && /^\d+$/.test(parent) && /^\d+$/.test(started)) table.set(Number(pid), { pid: Number(pid), parent: Number(parent), started })
  }
  return table
}
function descendantsOf(pid: number): Proc[] {
  if (process.platform !== 'win32' || !pid) return []
  const table = processTable()
  const children = new Map<number, Proc[]>()
  for (const p of table.values()) children.set(p.parent, [...(children.get(p.parent) ?? []), p])
  const out: Proc[] = []
  const queue = [pid]
  while (queue.length) for (const c of children.get(queue.shift()!) ?? []) if (c.pid !== pid && !out.some((o) => o.pid === c.pid)) { out.push(c); queue.push(c.pid) }
  return out
}
function endAll(procs: Proc[]) {
  if (!procs.length) return
  const now = processTable()
  const never = new Set([process.pid, process.ppid])
  for (const p of procs) {
    const cur = now.get(p.pid)
    // only the very process recorded: same id and same start time (an id Windows has reused is left alone)
    if (!cur || cur.started !== p.started || never.has(p.pid)) continue
    try { process.kill(p.pid) } catch { /* exited meanwhile */ }
  }
}

export const test = base.extend<Options & { framevane: Framevane }, { openHandles: void }>({
  // after the worker's last test: list what could still keep it alive (shows in the CI log), to diagnose a hang
  openHandles: [async ({}, use) => {
    await use()
    const handles = (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles?.() ?? []
    const described = handles.map((h) => {
      const o = h as { constructor?: { name?: string }; pid?: number; spawnfile?: string; fd?: number; _type?: string }
      return [o.constructor?.name ?? typeof h, o.pid !== undefined ? `pid ${o.pid} ${o.spawnfile ?? ''}` : '', o.fd !== undefined ? `fd ${o.fd}` : ''].filter(Boolean).join(' ')
    })
    console.log(`[worker] after the last test: ${handles.length} open handles${described.length ? `: ${described.join('; ')}` : ''}`)
  }, { scope: 'worker', auto: true }],
  pickFiles: [[], { option: true }],
  reelEnv: [{}, { option: true }],
  allowConsoleErrors: [[], { option: true }],
  framevane: async ({ pickFiles, reelEnv, allowConsoleErrors }, use, testInfo) => {
    const root = mkdtempSync(join(tmpdir(), 'framevane-test-'))
    const exportsDir = join(root, 'exports')
    mkdirSync(exportsDir, { recursive: true })
    const errors: string[] = []
    const failedRequests: { url: string; status: number }[] = []
    const env = {
      ...process.env,
      FRAMEVANE_USER_DATA: join(root, 'userdata'),
      FRAMEVANE_PROJECTS_DIR: join(root, 'projects'),
      FRAMEVANE_MODELS_DIR: process.env.FRAMEVANE_MODELS_DIR ?? join(process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support') : process.env.APPDATA ?? '', 'Framevane', 'models'),
      FRAMEVANE_TEST_PICK_FILES: pickFiles.join(';'),
      FRAMEVANE_TEST_SAVE_DIR: exportsDir,
      ...reelEnv,
    } as Record<string, string>

    // the main process's output, with the local AI sidecar's log in it ("[local] ..."), saved with a failed test
    const mainLog: string[] = []
    const t0 = Date.now()
    const start = async () => {
      const app = await electron.launch({ args: [resolve(HERE, '..')], env })
      // kept now: once the app is closed, Playwright's app.process() no longer works
      const proc = app.process()
      for (const s of [proc.stdout, proc.stderr]) {
        s?.on('data', (d: Buffer) => { for (const line of d.toString('utf8').split(/\r?\n/)) if (line) mainLog.push(`+${((Date.now() - t0) / 1000).toFixed(1)}s ${line}`) })
      }
      const page = await app.firstWindow()
      page.on('console', (m) => {
        // everything the renderer logs goes into main-process.log too, timed alongside the main process's lines
        mainLog.push(`+${((Date.now() - t0) / 1000).toFixed(1)}s [renderer:${m.type()}] ${m.text()}`)
        if (m.type() !== 'error') return
        const text = m.text()
        if (/Download the React DevTools|Electron Security Warning/.test(text)) return
        if (allowConsoleErrors.some((r) => r.test(text))) return
        errors.push(text)
      })
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
      page.on('response', (r) => { if (r.status() >= 400) failedRequests.push({ url: r.url(), status: r.status() }) })
      await page.getByRole('heading', { name: 'What are we making?' }).waitFor()
      return { app, page, proc }
    }

    // Close our end of the app's output pipes once it has exited. On Windows a closed or killed app's child processes
    // (FFmpeg, the AI sidecar, Chromium helpers) can outlive it and keep those pipes open, and with the log listeners
    // above still attached the worker never exits ("Worker teardown timeout" after every Windows CI run).
    const release = (proc: ChildProcess) => {
      for (const s of [proc.stdout, proc.stderr]) { s?.removeAllListeners('data'); s?.destroy() }
    }
    let cur = await start()
    const framevane: Framevane = {
      get app() { return cur.app },
      get page() { return cur.page },
      errors,
      failedRequests,
      root,
      exportsDir,
      async relaunch(opts = {}) {
        const left = descendantsOf(cur.proc.pid ?? 0)
        if (opts.kill) cur.proc.kill('SIGKILL')
        else await cur.app.close()
        await new Promise((r) => setTimeout(r, 500))
        endAll(left)
        release(cur.proc)
        cur = await start()
        return cur.page
      },
    }
    await use(framevane)
    if (testInfo.status !== testInfo.expectedStatus) {
      await cur.page.screenshot({ path: testInfo.outputPath('failure.png') }).catch(() => {})
      // written as a file in the test's output folder (uploaded by CI): a body-only attachment lives only in reports
      try { writeFileSync(testInfo.outputPath('main-process.log'), mainLog.join('\n')) } catch { /* best effort */ }
    }
    const left = descendantsOf(cur.proc.pid ?? 0)
    await cur.app.close().catch(() => {})
    endAll(left)
    release(cur.proc)
    // each test's profile, projects and exports live in a temp folder: remove it (set FRAMEVANE_KEEP_TEST_DIRS=1 to inspect)
    // best effort: a killed app's helpers can still hold files; the global teardown sweeps what's left
    if (!process.env.FRAMEVANE_KEEP_TEST_DIRS) { try { rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }) } catch { /* swept later */ } }
    expect(errors, `console errors (failed requests: ${JSON.stringify(failedRequests)})`).toEqual([])
    expect(failedRequests.filter((r) => r.status >= 500), '5xx responses').toEqual([])
  },
})

export { expect }

/* ───────── helpers (roles and labels only, no CSS classes) ───────── */

/** Home → "choose files" with the files given to test.use({ pickFiles }) → editor with clips placed. */
export async function newProjectFromFiles(page: Page) {
  await page.getByRole('button', { name: 'or choose files' }).click()
  await page.getByRole('tab', { name: 'Media' }).waitFor()
}

export const timeline = (page: Page) => page.getByRole('grid', { name: 'Timeline tracks' })
export const clips = (page: Page, prefix = '') => page.locator(prefix ? `[data-clip-id^="${prefix}"]` : '[data-clip-id]')

/** Timeline length as "M:SS.s", read from the player's timecode (visible whatever is selected). Assumes 30 fps media. */
export async function projectDuration(page: Page) {
  const label = await page.getByRole('timer', { name: /^Timecode / }).getAttribute('aria-label')
  const m = / of (\d+):(\d+):(\d+):(\d+)$/.exec(label ?? '')
  if (!m) return undefined
  const s = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 30
  const min = Math.floor(s / 60)
  return `${min}:${(s - min * 60).toFixed(1).padStart(4, '0')}`
}

/** Center pixel of the preview canvas; [0,0,0,255] means nothing was drawn. */
export async function previewPixel(page: Page, fx = 0.25, fy = 0.25) {
  return page.evaluate(([fx, fy]: [number, number]) => {
    const c = document.querySelector('canvas[role="img"]') as HTMLCanvasElement | null
    if (!c) return null
    const d = c.getContext('2d')!.getImageData(Math.floor(c.width * fx), Math.floor(c.height * fy), 1, 1).data
    return { w: c.width, h: c.height, rgba: [...d] }
  }, [fx, fy] as [number, number])
}

export const isBlank = (p: { rgba: number[] } | null) => !p || (p.rgba[0]! < 8 && p.rgba[1]! < 8 && p.rgba[2]! < 8)

/** axe scan of the current screen (WCAG 2.2 A/AA). Returns violations summarized for readable failures. */
export async function a11y(page: Page, screen: string) {
  const r = await new AxeBuilder({ page }).setLegacyMode(true).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  return r.violations.map((v) => ({ screen, id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, target: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }))
}

export interface Probe { format: { duration: string }; streams: { codec_type: string; codec_name: string; width?: number; height?: number; r_frame_rate?: string; duration?: string; sample_rate?: string }[] }
export function ffprobe(file: string): Probe {
  const r = spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(r.stderr)
  return JSON.parse(r.stdout) as Probe
}
