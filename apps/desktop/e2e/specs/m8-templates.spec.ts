import { existsSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { MediaClip, Project, TextClip } from '@framevane/doc'
import { a11y, expect, test } from '../fixtures'
import { files } from '../global-setup'

/**
 * Templates: copy the edit of a video (edit-to-copy.mp4: cuts at 1.0 / 2.0 / 3.2 s, a title 0–2 s, a boxed caption
 * 2–4 s, a tone) and fill it with other clips. On-screen text needs the local AI; the first run sets it up.
 */

const AI_TIMEOUT = 20 * 60_000

async function openDoc(page: Page, name: string): Promise<Project> {
  return page.evaluate(async (n) => {
    const p = (await window.framevane.projects.list()).find((x) => x.name === n)!
    return (await window.framevane.projects.open(p.id)).doc
  }, name)
}

test.describe('M8 templates', () => {
  test.use({ pickFiles: [files.edit, files.talk, files.broll] })

  test('copy an edit from a video file, then fill it with my clips', async ({ framevane }) => {
    test.setTimeout(AI_TIMEOUT + 120_000)
    const { page } = framevane
    await page.getByRole('button', { name: /Copy an edit/ }).click()
    const make = page.getByRole('dialog', { name: 'Template from a video' })
    await make.getByRole('button', { name: 'Make template' }).waitFor()
    await page.waitForTimeout(400) // let the dialog finish fading in before measuring contrast
    expect(await a11y(page, 'new template')).toEqual([])
    await make.getByRole('button', { name: 'or choose a video' }).click()
    await expect(make).toContainText('edit-to-copy.mp4')
    await make.getByRole('button', { name: 'Make template' }).click()
    await expect(make.getByRole('progressbar', { name: 'Making the template' })).toBeVisible()

    const use = page.getByRole('dialog', { name: 'Use “edit-to-copy”' })
    await expect(use).toBeVisible({ timeout: AI_TIMEOUT })
    const slots = use.getByRole('list', { name: 'Template slots' }).getByRole('listitem')
    await expect(slots).toHaveCount(4)
    await expect(slots.nth(0)).toContainText('1.0 s')
    await expect(slots.nth(2)).toContainText('1.2 s')
    await expect(use).toContainText('4 shots')
    await expect(use.getByLabel('The original video')).toBeVisible()
    await page.waitForTimeout(400)
    expect(await a11y(page, 'use template')).toEqual([])

    // my clips: the round-robin preview shows where each goes
    await use.getByRole('button', { name: 'or choose files' }).click()
    await expect(use.getByRole('list', { name: 'Clips to fill the slots with' }).getByRole('listitem')).toHaveCount(3)
    await expect(slots.nth(1)).toContainText('talk.mp4')
    await expect(slots.nth(3)).toContainText('edit-to-copy.mp4')
    await use.getByRole('textbox', { name: 'Project name' }).fill('My copied edit')
    await use.getByRole('button', { name: 'Create video' }).click()
    await expect(page.getByRole('grid', { name: 'Timeline tracks' })).toBeVisible({ timeout: 60_000 })

    const doc = await openDoc(page, 'My copied edit')
    expect(doc.canvas).toMatchObject({ width: 1080, height: 1920 })
    const main = doc.tracks.find((t) => t.main)!
    expect(main.clips.map((c) => [c.startUs, c.durationUs])).toEqual([[0, 1_000_000], [1_000_000, 1_000_000], [2_000_000, 1_200_000], [3_200_000, 800_000]])
    const talk = main.clips[1] as MediaClip
    expect(doc.assets[talk.assetId]!.name).toBe('talk.mp4')
    expect(talk.audioEnabled).toBe(false) // the template's sound plays instead
    expect(talk.transform.scale).toBeGreaterThan(3) // 16:9 clip scaled to cover 9:16
    const sound = doc.tracks.find((t) => t.kind === 'audio')!
    expect(sound.clips[0]).toMatchObject({ startUs: 0, durationUs: 4_000_000 })
    const texts = doc.tracks.filter((t) => t.kind === 'text').flatMap((t) => t.clips) as TextClip[]
    if (!texts.length) test.info().annotations.push({ type: 'note', description: 'no on-screen text found (local AI or drawtext unavailable)' })
    else {
      const title = texts.find((t) => /POV you finally/i.test(t.text))
      const step = texts.find((t) => /Step 1/i.test(t.text))
      expect(title, JSON.stringify(texts.map((t) => t.text))).toBeTruthy()
      expect(step).toBeTruthy()
      expect(title!.startUs).toBe(0)
      expect(title!.startUs + title!.durationUs).toBe(2_000_000)
      expect(step!.startUs).toBe(2_000_000)
      expect(step!.style.background).toMatch(/^#f/i) // the white box behind it
      expect(step!.style.color).toMatch(/^#[0-3]/) // dark letters
    }

    // the template stays in the library on the home screen
    await page.getByRole('button', { name: 'Projects', exact: true }).click()
    await expect(page.getByRole('list', { name: 'Templates' }).getByRole('listitem')).toHaveCount(1)
    expect(await a11y(page, 'home with templates')).toEqual([])
  })

  test('a link that is not a post explains itself', async ({ framevane }) => {
    const { page } = framevane
    await page.getByRole('button', { name: /Copy an edit/ }).click()
    const make = page.getByRole('dialog', { name: 'Template from a video' })
    await make.getByRole('radio', { name: 'A link' }).click()
    const field = make.getByRole('textbox', { name: 'Post link' })
    await field.fill('not a link')
    await expect(make).toContainText('doesn’t look like a link')
    await expect(make.getByRole('button', { name: 'Make template' })).toBeDisabled()
    await expect(make.getByRole('combobox', { name: 'Use my sign-in from' })).toBeVisible()
  })
})

test.describe('M8 templates over MCP', () => {
  const PORT = 47903
  test.use({ reelEnv: { FRAMEVANE_MCP_PORT: String(PORT) } })

  test('make a template without text and fill it from Claude Code', async ({ framevane }) => {
    test.skip(!existsSync(files.edit), 'edit-to-copy.mp4 missing')
    const { page } = framevane
    const info = await page.evaluate(() => window.framevane.mcp.info())
    const client = new Client({ name: 'e2e', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${info.token}` } } }))
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 180_000 })
      const text = (r.content as { type: string; text?: string }[]).map((c) => c.text ?? '').join('\n')
      expect(r.isError, `${name}: ${text}`).toBeFalsy()
      return text
    }
    const made = JSON.parse(await call('make_template', { path: files.edit, readText: false, name: 'Agent template' })) as { id: string; slotSeconds: number[]; hasSound: boolean }
    expect(made.slotSeconds).toEqual([1, 1, 1.2, 0.8])
    expect(made.hasSound).toBe(true)
    expect(JSON.parse(await call('list_templates'))).toMatchObject([{ id: made.id, slots: 4, texts: 0 }])
    const used = JSON.parse(await call('use_template', { templateId: made.id, files: [files.broll], sound: 'clips', name: 'Agent fill' })) as { projectId: string; filled: number }
    expect(used.filled).toBe(4)
    await expect(page.getByRole('grid', { name: 'Timeline tracks' })).toBeVisible()
    const tl = JSON.parse(await call('get_timeline')) as { tracks: { kind: string; clips: { start: number; duration: number }[] }[] }
    expect(tl.tracks.filter((t) => t.kind === 'audio')).toHaveLength(0)
    await client.close()
  })
})
