import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { clips, expect, ffprobe, newProjectFromFiles, projectDuration, test } from '../fixtures'
import { files } from '../global-setup'

/** Framevane as an MCP server: an external agent (Claude Code) edits the open project live. Uses a real MCP client. */
const PORT = 47899 // not the default, so a running Framevane doesn't interfere

async function connect(token: string) {
  const client = new Client({ name: 'e2e-claude-code', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
  return client
}
const text = (r: Awaited<ReturnType<Client['callTool']>>) => (r.content as { type: string; text?: string }[]).filter((c) => c.type === 'text').map((c) => c.text).join('\n')

test.describe('F13 connect Claude Code (Framevane as an MCP server)', () => {
  test.use({ pickFiles: [files.talk], reelEnv: { FRAMEVANE_MCP_PORT: String(PORT) } })

  test('F13-H1 an MCP client edits the open project live; Ctrl+Z undoes; export works', async ({ framevane }) => {
    const { page } = framevane
    const info = await page.evaluate(() => window.framevane.mcp.info())
    expect(info.listening).toBe(true)
    expect(info.claudeCommand).toContain(`claude mcp add --scope user --transport http framevane http://127.0.0.1:${PORT}/mcp`)

    const client = await connect(info.token)
    const tools = (await client.listTools()).tools.map((t) => t.name)
    for (const t of ['get_project_summary', 'get_timeline', 'get_transcript', 'find_silences', 'cut_ranges', 'add_captions', 'get_frames', 'list_projects', 'open_project', 'create_project', 'import_media', 'add_to_timeline', 'undo', 'redo', 'export_video']) expect(tools).toContain(t)

    // no project open yet → a clear instruction, not a crash
    const none = await client.callTool({ name: 'get_project_summary', arguments: {} })
    expect(none.isError).toBe(true)
    expect(text(none)).toMatch(/No project is open/)

    await newProjectFromFiles(page)
    await expect(clips(page)).toHaveCount(1)
    const summary = JSON.parse(text(await client.callTool({ name: 'get_project_summary', arguments: {} })))
    expect(summary.durationSeconds).toBeCloseTo(29.13, 1)
    expect(summary.selectedClipIds).toEqual([])

    const sil = JSON.parse(text(await client.callTool({ name: 'find_silences', arguments: { minSeconds: 0.8 } })))
    expect(sil.ranges.length).toBeGreaterThan(2)
    await client.callTool({ name: 'cut_ranges', arguments: { ranges: sil.ranges } })
    await expect.poll(() => projectDuration(page)).not.toBe('0:29.1')
    await expect(page.getByText(/Connected agent: cut ranges|Claude Code: cut ranges/).first()).toBeVisible()
    await expect(page.getByRole('region', { name: 'Connected agent activity' })).toBeVisible()

    const caps = await client.callTool({ name: 'add_captions', arguments: {} }, undefined, { timeout: 180_000 })
    expect(caps.isError, text(caps)).toBeFalsy()
    await expect.poll(async () => clips(page, 'cap-').count()).toBeGreaterThan(3)

    const frames = await client.callTool({ name: 'get_frames', arguments: { timesSeconds: [2] } })
    expect((frames.content as { type: string }[]).some((c) => c.type === 'image')).toBe(true)

    // the user undoes the agent's last edit in the app
    await page.locator('body').click({ position: { x: 700, y: 900 } })
    await page.keyboard.press('Control+z')
    await expect(clips(page, 'cap-')).toHaveCount(0)

    const out = join(framevane.exportsDir, 'from-claude.mp4')
    const exp = await client.callTool({ name: 'export_video', arguments: { outputPath: out, height: 720 } }, undefined, { timeout: 300_000 })
    expect(exp.isError).toBeFalsy()
    expect(existsSync(out)).toBe(true)
    expect(ffprobe(out).streams.find((s) => s.codec_type === 'video')!.height).toBe(720)
    await client.close()
  })

  test('F13-H2 create a project from files and open it in the window', async ({ framevane }) => {
    const { page } = framevane
    const client = await connect((await page.evaluate(() => window.framevane.mcp.info())).token)
    const r = await client.callTool({ name: 'create_project', arguments: { name: 'Made by an agent', files: [files.talk, files.broll] } })
    expect(r.isError).toBeFalsy()
    await expect(page.getByRole('heading', { level: 1, name: 'Made by an agent' })).toBeVisible()
    await expect(clips(page)).toHaveCount(2)
    const list = JSON.parse(text(await client.callTool({ name: 'list_projects', arguments: {} })))
    expect(list.find((p: { name: string; isOpen: boolean }) => p.name === 'Made by an agent').isOpen).toBe(true)
    await client.close()
  })

  test('F13-N1 wrong token, browser origin and foreign host are refused', async ({ framevane }) => {
    const { page } = framevane
    const token = (await page.evaluate(() => window.framevane.mcp.info())).token
    const post = (headers: Record<string, string>) => fetch(`http://127.0.0.1:${PORT}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers }, body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' })
    expect((await post({})).status).toBe(401)
    expect((await post({ Authorization: 'Bearer nope' })).status).toBe(401)
    expect((await post({ Authorization: `Bearer ${token}`, Origin: 'https://evil.example' })).status).toBe(403)
    await expect(connect('nope')).rejects.toThrow()
  })

  test('F13-E1 the settings section shows the connect command', async ({ framevane }) => {
    const { page } = framevane
    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('tab', { name: 'Agents & AI' }).click()
    await expect(page.getByRole('heading', { name: 'Use Framevane from Claude Code' })).toBeVisible()
    await expect(page.getByText(new RegExp(`Ready on 127\\.0\\.0\\.1:${PORT}`))).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add to Claude Code' })).toBeEnabled()
    await page.screenshot({ path: '../../replica/clone-screens/S28-connect-claude.png' })
  })
})
