import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import { a11y, clips, expect, newProjectFromFiles, test, timeline } from '../fixtures'
import { files } from '../global-setup'

/** Milestone 2: MCP servers for the built-in agent, per-tool permissions, the agent library, batch runs, "Ask again". */

const HERE = dirname(fileURLToPath(import.meta.url))
const SERVER = resolve(HERE, '../test-mcp-server.mjs')

async function addServerViaApi(page: Page, name = 'testtools') {
  return page.evaluate(({ name, command, script }) => window.framevane.tools.add({ name, kind: 'mcp_stdio', command, args: [script] }), { name, command: process.execPath, script: SERVER })
}
async function ask(page: Page, text: string) {
  const box = page.getByRole('textbox', { name: 'Message the agent' })
  await box.fill(text)
  await box.press('Enter')
}
const makeClipPermission = (page: Page) => page.evaluate(async () => (await window.framevane.tools.providers()).find((p) => p.name === 'testtools')?.tools.find((t) => t.name === 'make_clip')?.permission)

test.describe('M2 tools from other apps (MCP)', () => {
  test('add a server in Settings: connects, lists tools with safe defaults, keeps secrets out of view', async ({ framevane }) => {
    const { page } = framevane
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('tab', { name: 'Agents & AI' }).click()
    await page.getByRole('button', { name: 'Add server' }).click()
    const form = page.getByRole('form', { name: 'Add an MCP server' })
    // a reserved name is refused with a readable message
    await form.getByRole('textbox', { name: 'Name' }).fill('local')
    await form.getByRole('textbox', { name: 'Command' }).fill(process.execPath)
    await form.getByRole('textbox', { name: 'Arguments (one per line)' }).fill(SERVER)
    await form.getByRole('textbox', { name: 'Environment variables' }).fill('TEST_MCP_SECRET=hunter22')
    await form.getByRole('button', { name: 'Add and connect' }).click()
    await expect(form.getByRole('alert')).toContainText('reserved')
    await form.getByRole('textbox', { name: 'Name' }).fill('testtools')
    await form.getByRole('button', { name: 'Add and connect' }).click()

    const card = page.getByRole('article', { name: 'Server testtools' })
    await expect(card.getByText('Connected')).toBeVisible({ timeout: 20_000 })
    const tools = card.getByRole('list', { name: 'Tools from testtools' })
    await expect(tools.getByRole('listitem')).toHaveCount(2)
    await expect(card.getByRole('combobox', { name: 'Permission for ping' })).toContainText('Auto') // read-only → auto
    await expect(card.getByRole('combobox', { name: 'Permission for make_clip' })).toContainText('Ask') // writes → ask
    // the secret reached the server, but only its name comes back to the window
    const view = await page.evaluate(async () => (await window.framevane.tools.providers()).find((p) => p.name === 'testtools')!)
    expect(view.envKeys).toEqual(['TEST_MCP_SECRET'])
    expect(JSON.stringify(view)).not.toContain('hunter22')
    // the bundled local AI shows as a built-in provider
    await expect(page.getByRole('article', { name: 'Server local' })).toBeVisible()
    expect(await a11y(page, 'S28 MCP servers')).toEqual([])

    // per-tool settings persist
    await card.getByRole('combobox', { name: 'Permission for ping' }).click()
    await page.getByRole('option', { name: 'Never' }).click()
    await card.getByRole('checkbox', { name: 'make_clip costs money' }).click()
    await expect.poll(async () => (await page.evaluate(async () => (await window.framevane.tools.providers()).find((p) => p.name === 'testtools')!.tools))).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'ping', permission: 'never' }), expect.objectContaining({ name: 'make_clip', costsMoney: true })]))
    // off, on, remove
    await card.getByRole('switch', { name: 'Enabled' }).click()
    await expect(card.getByText('Off')).toBeVisible()
    await card.getByRole('switch', { name: 'Enabled' }).click()
    await expect(card.getByText('Connected')).toBeVisible({ timeout: 20_000 })
    await card.getByRole('button', { name: 'Remove testtools' }).click()
    await expect(card).toHaveCount(0)
  })
})

test.describe('M2 permission prompts', () => {
  test.use({ pickFiles: [files.talk], reelEnv: { FRAMEVANE_FAKE_AGENT: '1' } })

  test('Allow once, Deny, Always allow and Never', async ({ framevane }) => {
    const { page } = framevane
    await addServerViaApi(page)
    await newProjectFromFiles(page)
    await expect(clips(page)).toHaveCount(1)
    const prompt = page.getByRole('alertdialog', { name: 'Allow make_clip?' })

    // Allow once → the tool runs, its clip is imported and placed, the proposal applies
    await ask(page, 'Use the test tool to make a clip')
    await expect(prompt).toBeVisible({ timeout: 30_000 })
    await expect(prompt).toContainText('testtools.make_clip')
    expect(await a11y(page, 'S27 permission prompt')).toEqual([])
    await prompt.getByRole('button', { name: 'Allow once' }).click()
    await page.getByRole('button', { name: 'Review edits' }).click({ timeout: 60_000 })
    await page.getByRole('dialog', { name: "Review the agent's edits" }).getByRole('button', { name: /^Apply \d+ edit/ }).click()
    await expect(clips(page)).toHaveCount(2)
    expect(await makeClipPermission(page)).toBe('ask')

    // Deny → the agent carries on without it, nothing changes
    await ask(page, 'Use the test tool again')
    await prompt.getByRole('button', { name: 'Deny' }).click({ timeout: 30_000 })
    await expect(page.getByText('The clip tool was not allowed')).toBeVisible({ timeout: 30_000 })
    await expect(clips(page)).toHaveCount(2)

    // Always allow → remembered as auto, the next run doesn't ask
    await ask(page, 'Use the test tool once more')
    await prompt.getByRole('button', { name: 'Always allow' }).click({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: 'Review edits' })).toBeVisible({ timeout: 60_000 })
    await page.getByRole('button', { name: 'Discard' }).click()
    expect(await makeClipPermission(page)).toBe('auto')
    await ask(page, 'Use the test tool without asking')
    await expect(page.getByRole('button', { name: 'Review edits' })).toBeVisible({ timeout: 60_000 })
    await expect(prompt).toHaveCount(0)
    await page.getByRole('button', { name: 'Discard' }).click()

    // Never → the tool is no longer offered to agents
    await page.evaluate(async () => {
      const p = (await window.framevane.tools.providers()).find((x) => x.name === 'testtools')!
      await window.framevane.tools.setToolPermission(p.id, 'make_clip', 'ask')
    })
    await ask(page, 'Use the test tool one last time')
    await prompt.getByRole('button', { name: 'Never' }).click({ timeout: 30_000 })
    await expect.poll(() => makeClipPermission(page)).toBe('never')
    await expect(page.getByText('The clip tool was not allowed')).toHaveCount(2, { timeout: 30_000 }) // that run has finished
    await ask(page, 'Use the test tool after never')
    await expect(page.getByText('No clip-making tool is available.')).toBeVisible({ timeout: 30_000 })
  })

  test('a tool marked "costs money" asks even when set to Auto, and has no Always allow', async ({ framevane }) => {
    const { page } = framevane
    const p = await addServerViaApi(page)
    await page.evaluate(async (id) => {
      await window.framevane.tools.setToolPermission(id, 'make_clip', 'auto')
      await window.framevane.tools.setToolCostsMoney(id, 'make_clip', true)
    }, p.id)
    await newProjectFromFiles(page)
    await ask(page, 'Use the test tool')
    const prompt = page.getByRole('alertdialog', { name: 'Allow make_clip?' })
    await expect(prompt).toBeVisible({ timeout: 30_000 })
    await expect(prompt).toContainText('Uses paid credits')
    await expect(prompt.getByRole('button', { name: 'Always allow' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Stop' }).click()
    await expect(page.getByText('Stopped.')).toBeVisible()
  })
})

test.describe('M2 agent library', () => {
  test('create, edit, duplicate a built-in, delete; survives a restart', async ({ framevane }) => {
    let page = framevane.page
    await page.getByRole('button', { name: 'Agent library' }).click()
    const dialog = page.getByRole('dialog', { name: 'Agent library' })
    for (const name of ['Editor', 'Silence cutter', 'Captioner', 'Short-form maker', 'Filler-word remover', 'Highlight finder']) {
      await expect(dialog.getByRole('navigation', { name: 'Agents' }).getByRole('button', { name })).toBeVisible()
    }
    await dialog.getByRole('button', { name: 'New agent' }).click()
    const form = dialog.getByRole('form', { name: 'New agent' })
    await form.getByRole('textbox', { name: 'Name' }).fill('Hook marker')
    await form.getByRole('textbox', { name: 'What it does' }).fill('Marks the opening hook.')
    await form.getByRole('textbox', { name: 'Instructions' }).fill('Find the hook and add a red marker there.')
    await form.getByRole('radio', { name: 'Only these' }).click()
    await form.getByRole('checkbox', { name: 'add_marker' }).click()
    await form.getByRole('button', { name: 'Create agent' }).click()
    await expect(dialog.getByRole('form', { name: 'Edit Hook marker' })).toBeVisible()
    expect(await a11y(page, 'S31 agent library')).toEqual([])
    // a duplicate name is refused
    await dialog.getByRole('button', { name: 'New agent' }).click()
    await dialog.getByRole('form', { name: 'New agent' }).getByRole('textbox', { name: 'Name' }).fill('hook marker')
    await dialog.getByRole('form', { name: 'New agent' }).getByRole('button', { name: 'Create agent' }).click()
    await expect(dialog.getByRole('alert')).toContainText('already exists')
    // built-ins are read-only but can be duplicated
    await dialog.getByRole('button', { name: 'Captioner' }).click()
    await dialog.getByRole('button', { name: 'Duplicate to edit' }).click()
    await expect(dialog.getByRole('form', { name: 'Edit Captioner (my copy)' })).toBeVisible()

    page = await framevane.relaunch()
    await page.getByRole('button', { name: 'Agent library' }).click()
    const again = page.getByRole('dialog', { name: 'Agent library' })
    await again.getByRole('button', { name: 'Hook marker' }).click()
    const edit = again.getByRole('form', { name: 'Edit Hook marker' })
    await expect(edit.getByRole('textbox', { name: 'Instructions' })).toHaveValue('Find the hook and add a red marker there.')
    await expect(edit.getByRole('checkbox', { name: 'add_marker' })).toBeChecked()
    await edit.getByRole('textbox', { name: 'What it does' }).fill('Marks the hook in red.')
    await edit.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Agent saved')).toBeVisible()
    await edit.getByRole('button', { name: 'Delete' }).click()
    await expect(again.getByRole('button', { name: 'Hook marker' })).toHaveCount(0)
    await expect(again.getByRole('button', { name: 'Captioner (my copy)' })).toBeVisible()
  })
})

test.describe('M2 batch and review', () => {
  test.use({ pickFiles: [files.talk], reelEnv: { FRAMEVANE_FAKE_AGENT: '1' } })

  test('run one agent over two projects: auto-apply, then leave proposals for review', async ({ framevane }) => {
    const { page } = framevane
    await page.evaluate(async (file) => {
      await window.framevane.projects.create({ name: 'Batch one', files: [file] })
      await window.framevane.projects.create({ name: 'Batch two', files: [file] })
    }, files.talk)
    await page.reload()
    await page.getByRole('button', { name: 'Select for an agent' }).click()
    await page.getByRole('button', { name: 'Select all' }).click()
    await expect(page.getByText('2 selected')).toBeVisible()
    await page.getByRole('button', { name: 'Run an agent on 2 projects' }).click()
    const dialog = page.getByRole('dialog', { name: 'Run an agent on 2 projects' })
    await dialog.getByRole('combobox', { name: 'Agent' }).click()
    await page.getByRole('option', { name: 'Highlight finder' }).click()
    await expect(dialog.getByRole('textbox', { name: 'Request' })).toHaveValue('Mark the highlights.')
    await dialog.getByRole('switch', { name: 'Apply the edits automatically' }).click()
    expect(await a11y(page, 'F14 batch')).toEqual([])
    await dialog.getByRole('button', { name: 'Run on 2 projects' }).click()
    const progress = dialog.getByRole('list', { name: 'Batch progress' })
    await expect(progress.getByRole('listitem', { name: 'Batch one: Edited' })).toBeVisible({ timeout: 60_000 })
    await expect(progress.getByRole('listitem', { name: 'Batch two: Edited' })).toBeVisible({ timeout: 60_000 })
    await dialog.getByRole('button', { name: 'Done' }).click()
    await page.getByRole('button', { name: 'Open Batch two' }).click()
    await expect(page.getByRole('button', { name: /^Marker at / })).toHaveCount(1)

    // without auto-apply the edit waits in the project's agent panel
    await page.getByRole('button', { name: 'Projects' }).click()
    await page.getByRole('button', { name: 'Select for an agent' }).click()
    await page.getByRole('button', { name: 'Select Batch one' }).click()
    await page.getByRole('button', { name: 'Run an agent on 1 project' }).click()
    const d2 = page.getByRole('dialog', { name: 'Run an agent on 1 project' })
    await d2.getByRole('combobox', { name: 'Agent' }).click()
    await page.getByRole('option', { name: 'Highlight finder' }).click()
    await d2.getByRole('button', { name: 'Run on 1 project' }).click()
    await expect(d2.getByRole('listitem', { name: 'Batch one: Ready to review' })).toBeVisible({ timeout: 60_000 })
    await d2.getByRole('button', { name: 'Done' }).click()
    await page.getByRole('button', { name: 'Open Batch one' }).click()
    await expect(page.getByText('Highlight finder ran on this project in a batch.')).toBeVisible()
    await page.getByRole('button', { name: 'Review edits' }).click()
    await page.getByRole('dialog', { name: "Review the agent's edits" }).getByRole('button', { name: /^Apply \d+ edit/ }).click()
    await expect(page.getByRole('button', { name: /^Marker at / })).toHaveCount(2)
  })

  test('picking an agent in the panel limits its tools', async ({ framevane }) => {
    const { page } = framevane
    await newProjectFromFiles(page)
    await page.getByRole('combobox', { name: 'Agent' }).click()
    await page.getByRole('option', { name: 'Silence cutter' }).click()
    await expect(page.getByRole('button', { name: 'Cut the silences.' })).toBeVisible()
    await ask(page, 'Add a marker at the hook') // add_marker is not one of the Silence cutter's tools
    await expect(page.getByText('I can’t add markers with my tools.')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('to Silence cutter')).toBeVisible()
  })

  test('Ask again after the timeline changed', async ({ framevane }) => {
    const { page } = framevane
    await newProjectFromFiles(page)
    await ask(page, 'Add a marker at the hook')
    await page.getByRole('button', { name: 'Review edits' }).waitFor({ timeout: 60_000 })
    await timeline(page).click({ position: { x: 160, y: 10 } })
    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('Control+b')
    await expect(clips(page)).toHaveCount(2)
    await page.getByRole('button', { name: 'Review edits' }).click()
    const review = page.getByRole('dialog', { name: "Review the agent's edits" })
    await review.getByRole('button', { name: /^Apply \d+ edit/ }).click()
    // markers are time-based: blocked, with a way forward
    await expect(review.getByRole('alert')).toContainText('timeline changed')
    await review.getByRole('button', { name: 'Ask again' }).click()
    await expect(page.getByText('Edits discarded.')).toBeVisible()
    await page.getByRole('button', { name: 'Review edits' }).click({ timeout: 60_000 })
    await page.getByRole('dialog', { name: "Review the agent's edits" }).getByRole('button', { name: /^Apply \d+ edit/ }).click()
    await expect(page.getByRole('button', { name: /^Marker at / })).toHaveCount(1)
  })
})
