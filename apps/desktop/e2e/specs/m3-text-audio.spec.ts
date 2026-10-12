import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { a11y, clips, expect, newProjectFromFiles, projectDuration, test, timeline } from '../fixtures'
import { files } from '../global-setup'

/** Milestone 3: text, fonts, text to speech, captions in/out, transcript editing, audio fades, clean-up, ducking, voiceover. */

const SRT = join(tmpdir(), 'framevane-e2e-import.srt')
const FONT = 'C:\\Windows\\Fonts\\consola.ttf'
writeFileSync(SRT, '1\n00:00:00,500 --> 00:00:02,000\nImported line one\n\n2\n00:00:02,500 --> 00:00:04,000\nImported line two\n')

const props = (page: Page) => page.getByRole('region', { name: 'Properties' })
const assetTab = (page: Page, name: string) => page.getByRole('region', { name: 'Media and assets' }).getByRole('tab', { name, exact: true })
async function setField(page: Page, label: string, value: string) {
  const f = props(page).getByRole('spinbutton', { name: label })
  await f.fill(value)
  await f.press('Enter')
  await page.waitForTimeout(450) // inspector commits 250 ms after the last change
}
async function home(page: Page) {
  await timeline(page).click({ position: { x: 160, y: 10 } })
  await page.keyboard.press('Home')
}
/** Make a project from the talk video through the API and open it (for tests whose file picker returns something else). */
async function openTalkProject(page: Page, name = 'M3 project') {
  await page.evaluate(async ({ name, file }) => { await window.framevane.projects.create({ name, files: [file] }) }, { name, file: files.talk })
  await page.reload()
  await page.getByRole('button', { name: `Open ${name}` }).click()
  await expect(clips(page)).toHaveCount(1)
}

test.describe('M3 text', () => {
  test.use({ pickFiles: [files.talk] })

  test('add a preset, edit words and style, animate, move it on the canvas', async ({ framevane }) => {
    const { page } = framevane
    await newProjectFromFiles(page)
    await home(page)
    await assetTab(page, 'Text').click()
    expect(await a11y(page, 'S06 text')).toEqual([])
    await page.getByRole('button', { name: 'Add Headline text' }).click()
    await expect(clips(page, 'text-')).toHaveCount(1)
    await expect(page.getByRole('rowheader', { name: /Text 1/ })).toBeVisible()

    const box = props(page).getByRole('textbox', { name: /^Text/ })
    await box.fill('Hello Framevane')
    await box.press('Enter')
    await expect(page.getByRole('gridcell', { name: /Hello Framevane/ })).toBeVisible()
    await expect(props(page).getByRole('combobox', { name: 'Font' })).toContainText('Anton')
    await props(page).getByRole('button', { name: 'Italic' }).click()
    await expect(props(page).getByRole('button', { name: 'Italic' })).toHaveAttribute('aria-pressed', 'true')
    await setField(page, 'Size', '200')
    await props(page).getByRole('switch', { name: 'Background box' }).click()
    await expect(props(page).getByRole('spinbutton', { name: 'Box opacity' })).toBeVisible()
    expect(await a11y(page, 'S19 text inspector')).toEqual([])

    // animation
    await props(page).getByRole('tab', { name: 'Animation' }).click()
    await props(page).getByRole('combobox', { name: 'In animation' }).click()
    await page.getByRole('option', { name: 'Typewriter' }).click()
    await expect(props(page).getByRole('combobox', { name: 'In animation' })).toContainText('Typewriter')
    await expect(props(page).getByRole('spinbutton', { name: 'In length' })).toBeVisible()

    // drag on the canvas moves it; undo puts it back
    await props(page).getByRole('tab', { name: 'Text', exact: true }).click()
    await page.keyboard.press('Shift+ArrowRight')
    const handles = page.getByRole('group', { name: /Selected text on canvas/ })
    await expect(handles).toBeVisible()
    const b = (await handles.boundingBox())!
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width / 2 + 60, b.y + b.height / 2 - 40, { steps: 8 })
    await page.mouse.up()
    await expect.poll(async () => Number(await props(page).getByRole('spinbutton', { name: 'Position X' }).inputValue())).toBeGreaterThan(100)
    await page.keyboard.press('Control+z')
    await expect.poll(async () => Number(await props(page).getByRole('spinbutton', { name: 'Position X' }).inputValue())).toBe(0)
  })

  test('text to speech: natural (Kokoro) and Windows voices land on audio tracks', async ({ framevane }) => {
    const { page } = framevane
    await newProjectFromFiles(page)
    await home(page)
    await assetTab(page, 'Text').click()
    await page.getByRole('button', { name: 'Add text', exact: true }).click()
    const box = props(page).getByRole('textbox', { name: /^Text/ })
    await box.fill('This was made on my own computer.')
    await box.press('Enter')
    await props(page).getByRole('tab', { name: 'Speech' }).click()
    const voice = props(page).getByRole('combobox', { name: 'Voice' })
    await expect(voice).toBeVisible({ timeout: 60_000 })
    expect(await a11y(page, 'S19 speech')).toEqual([])
    await voice.click()
    await page.getByRole('option', { name: /^Heart/ }).click()
    await props(page).getByRole('button', { name: 'Generate speech' }).click()
    await expect(page.getByText('Speech added').first()).toBeVisible({ timeout: 120_000 })
    await expect(clips(page)).toHaveCount(3)
    await voice.click()
    await page.getByRole('option', { name: /David|Zira|Mark/ }).first().click()
    await props(page).getByRole('button', { name: 'Generate speech' }).click()
    await expect(clips(page)).toHaveCount(4, { timeout: 120_000 })
    await expect(page.getByRole('rowheader', { name: /Audio 2/ })).toBeVisible()
  })
})

test.describe('M3 fonts', () => {
  test.use({ pickFiles: [FONT] })
  test('import a font file and use it', async ({ framevane }) => {
    const { page } = framevane
    await openTalkProject(page)
    await home(page)
    await assetTab(page, 'Text').click()
    await page.getByRole('button', { name: 'Add text', exact: true }).click()
    await props(page).getByRole('button', { name: 'Import a font file' }).click()
    await expect(props(page).getByRole('combobox', { name: 'Font' })).toContainText('Consolas')
    const custom = await page.evaluate(() => window.framevane.fonts.custom())
    expect(custom).toEqual([expect.objectContaining({ file: 'consola.ttf', family: 'Consolas', weight: 400, style: 'normal' })])
    // system fonts are listed too
    expect((await page.evaluate(() => window.framevane.fonts.system())).length).toBeGreaterThan(20)
  })
})

test.describe('M3 captions', () => {
  test.use({ pickFiles: [files.talk] })

  test('generate, restyle with a preset, export .srt and .txt, cut words from the transcript', async ({ framevane }) => {
    const { page } = framevane
    await newProjectFromFiles(page)
    await assetTab(page, 'Captions').click()
    await page.getByRole('button', { name: 'Generate captions' }).click()
    await expect.poll(() => clips(page, 'cap-').count(), { timeout: 180_000 }).toBeGreaterThan(3)

    await clips(page, 'cap-').first().click()
    await props(page).getByRole('button', { name: 'One word' }).click()
    await expect(props(page).getByRole('switch', { name: 'One word at a time' })).toBeChecked()
    await expect(props(page).getByRole('combobox', { name: 'Font' })).toContainText('Anton')
    expect(await a11y(page, 'S19 caption inspector')).toEqual([])

    await page.getByRole('button', { name: 'Export .srt' }).click()
    await expect(page.getByText('Saved the .srt file').first()).toBeVisible()
    const srt = readFileSync(join(framevane.exportsDir, 'talk.srt'), 'utf8')
    expect(srt).toMatch(/^1\n00:00:0\d,\d{3} --> 00:00:0\d,\d{3}\n\S/)
    await page.getByRole('button', { name: 'Export .txt' }).click()
    await expect(page.getByText('Saved the transcript text').first()).toBeVisible()
    expect(readFileSync(join(framevane.exportsDir, 'talk.txt'), 'utf8').split('\n').length).toBeGreaterThan(3)

    // edit by transcript: pick three words, cut them
    await page.getByRole('button', { name: 'Show transcript' }).click()
    const words = page.getByRole('listbox', { name: 'Transcript words' })
    await expect(words.getByRole('option').first()).toBeVisible({ timeout: 60_000 })
    expect(await a11y(page, 'S30 transcript')).toEqual([])
    const before = await words.getByRole('option').count()
    await words.getByRole('option').nth(0).click()
    await words.getByRole('option').nth(2).click({ modifiers: ['Shift'] })
    await expect(words.getByRole('option', { selected: true })).toHaveCount(3)
    await page.getByRole('button', { name: 'Cut 3 selected' }).click()
    await expect(page.getByText('Cut 3 words').first()).toBeVisible()
    await expect.poll(() => projectDuration(page)).not.toBe('0:29.1')
    await expect.poll(() => words.getByRole('option').count()).toBe(before - 3)
    await page.keyboard.press('Control+z')
    await expect.poll(() => projectDuration(page)).toBe('0:29.1')
  })
})

test.describe('M3 caption import', () => {
  test.use({ pickFiles: [SRT] })
  test('import an .srt as the caption track', async ({ framevane }) => {
    const { page } = framevane
    await openTalkProject(page)
    await assetTab(page, 'Captions').click()
    await page.getByRole('button', { name: 'Import .srt' }).click()
    await expect(page.getByText('Imported 2 caption lines').first()).toBeVisible()
    await expect(page.getByRole('gridcell', { name: /Imported line one/ })).toBeVisible()
  })
})

test.describe('M3 audio', () => {
  test.use({ pickFiles: [files.talk], reelEnv: { FRAMEVANE_FAKE_MEDIA: '1' } })

  test('fades, clean-up (detaches to a cleaned audio clip), ducking music under speech', async ({ framevane }) => {
    const { page } = framevane
    await newProjectFromFiles(page)
    await clips(page).first().click()
    await props(page).getByRole('tab', { name: 'Audio' }).click()
    await setField(page, 'Fade in', '1.5')
    await setField(page, 'Fade out', '2')
    await page.keyboard.press('Escape')
    await clips(page).first().click()
    await props(page).getByRole('tab', { name: 'Audio' }).click()
    await expect(props(page).getByRole('spinbutton', { name: 'Fade in' })).toHaveValue('1.5')
    expect(await a11y(page, 'S15 audio inspector')).toEqual([])

    await props(page).getByRole('button', { name: 'Apply' }).click()
    await expect(page.getByText('Reduce noise: done').first()).toBeVisible({ timeout: 120_000 })
    await expect(page.getByRole('gridcell', { name: /audio detached/ })).toBeVisible()
    await expect(page.getByRole('gridcell', { name: /talk \(clean\)\.m4a/ })).toBeVisible()

    // music under speech
    const projectId = await page.evaluate(async () => (await window.framevane.projects.list())[0]!.id)
    await page.evaluate(async ({ id, file }) => { await window.framevane.media.import(id, [file]) }, { id: projectId, file: files.music })
    await assetTab(page, 'Audio').click()
    const add = page.getByRole('button', { name: 'Add music.m4a at the playhead' })
    await expect(add).toBeEnabled({ timeout: 30_000 })
    await home(page)
    await add.click()
    await page.getByRole('gridcell', { name: /music\.m4a/ }).click()
    await props(page).getByRole('tab', { name: 'Audio' }).click()
    await props(page).getByRole('button', { name: 'Lower under speech' }).click()
    await expect(page.getByText('Music lowered under speech').first()).toBeVisible({ timeout: 120_000 })
    await expect(props(page).getByRole('button', { name: 'Clear keyframes' })).toBeVisible()
  })

  test('record a voiceover at the playhead', async ({ framevane }) => {
    const { page } = framevane
    await newProjectFromFiles(page)
    await home(page)
    await assetTab(page, 'Audio').click()
    await page.getByRole('checkbox', { name: 'Play the timeline while recording' }).click()
    expect(await a11y(page, 'S05 voiceover')).toEqual([])
    await page.getByRole('button', { name: 'Record at playhead' }).click()
    await page.waitForTimeout(2200)
    await page.getByRole('button', { name: /^Stop/ }).click()
    await expect(page.getByText('Voiceover added').first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('gridcell', { name: /Voiceover/ })).toBeVisible()
    await expect(clips(page)).toHaveCount(2)
  })
})

test.describe('M3 agent tools over MCP', () => {
  const PORT = 47898
  test.use({ pickFiles: [files.talk], reelEnv: { FRAMEVANE_MCP_PORT: String(PORT) } })

  test('add_text, edit_text, captions in/out, clean_audio, text_to_speech', async ({ framevane }) => {
    const { page } = framevane
    await newProjectFromFiles(page)
    const info = await page.evaluate(() => window.framevane.mcp.info())
    const client = new Client({ name: 'e2e', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${info.token}` } } }))
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = await client.callTool({ name, arguments: args }, undefined, { timeout: 180_000 })
      const text = (r.content as { type: string; text?: string }[]).map((c) => c.text ?? '').join('\n')
      expect(r.isError, `${name}: ${text}`).toBeFalsy()
      return text
    }
    const tools = (await client.listTools()).tools.map((t) => t.name)
    for (const t of ['add_text', 'edit_text', 'export_captions', 'import_captions', 'remove_filler_words', 'clean_audio', 'duck_music', 'list_voices', 'text_to_speech', 'set_canvas_size']) expect(tools).toContain(t)

    const { clipId } = JSON.parse(await call('add_text', { text: 'Big title', atSeconds: 1, position: 'upper-third', animIn: 'pop', style: { fontFamily: 'Bebas Neue', fontSize: 180, background: '#000000aa' } }))
    await expect(page.getByRole('gridcell', { name: /Big title/ })).toBeVisible()
    await call('edit_text', { clipId, text: 'Bigger title', style: { color: '#ff7a3d' } })
    await expect(page.getByRole('gridcell', { name: /Bigger title/ })).toBeVisible()

    expect(await call('export_captions')).toMatch(/no captions/i)
    await call('import_captions', { srt: readFileSync(SRT, 'utf8') })
    await expect.poll(() => clips(page, 'srt-').count()).toBe(2)
    expect(await call('export_captions', { format: 'srt' })).toContain('Imported line two')

    const voices = JSON.parse(await call('list_voices')) as { id: string; ready: boolean }[]
    const win = voices.find((v) => v.id.startsWith('windows:') && v.ready)!
    await call('text_to_speech', { text: 'Testing one two.', voice: win.id, atSeconds: 2 })
    await expect(page.getByRole('rowheader', { name: /Audio 1/ })).toBeVisible()

    const timelineJson = JSON.parse(await call('get_timeline'))
    const main = JSON.stringify(timelineJson).match(/"(clip-[^"]+)"/)![1]!
    await call('clean_audio', { clipId: main, mode: 'normalize' })
    await expect(page.getByRole('gridcell', { name: /talk \(normalized\)\.m4a/ })).toBeVisible()
    await client.close()
  })
})
