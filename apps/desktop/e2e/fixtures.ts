import { test as base, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
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

export const test = base.extend<Options & { framevane: Framevane }>({
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
      FRAMEVANE_MODELS_DIR: process.env.FRAMEVANE_MODELS_DIR ?? join(process.env.APPDATA ?? '', 'Framevane', 'models'),
      FRAMEVANE_TEST_PICK_FILES: pickFiles.join(';'),
      FRAMEVANE_TEST_SAVE_DIR: exportsDir,
      ...reelEnv,
    } as Record<string, string>

    const start = async () => {
      const app = await electron.launch({ args: [resolve(HERE, '..')], env })
      const page = await app.firstWindow()
      page.on('console', (m) => {
        if (m.type() !== 'error') return
        const text = m.text()
        if (/Download the React DevTools|Electron Security Warning/.test(text)) return
        if (allowConsoleErrors.some((r) => r.test(text))) return
        errors.push(text)
      })
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
      page.on('response', (r) => { if (r.status() >= 400) failedRequests.push({ url: r.url(), status: r.status() }) })
      await page.getByRole('heading', { name: 'What are we making?' }).waitFor()
      return { app, page }
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
        if (opts.kill) cur.app.process().kill('SIGKILL')
        else await cur.app.close()
        await new Promise((r) => setTimeout(r, 500))
        cur = await start()
        return cur.page
      },
    }
    await use(framevane)
    if (testInfo.status !== testInfo.expectedStatus) await cur.page.screenshot({ path: testInfo.outputPath('failure.png') }).catch(() => {})
    await cur.app.close().catch(() => {})
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
