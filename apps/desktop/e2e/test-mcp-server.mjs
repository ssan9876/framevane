// A tiny MCP server (stdio) for the M2 tests: stands in for a user-added tool provider such as a generation service.
//   ping       read-only, answers "pong"
//   make_clip  renders a short solid-colour mp4 with FFmpeg and returns its absolute path (like a "generate video" tool)
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const outDir = process.env.TEST_MCP_OUT ?? join(tmpdir(), 'framevane-test-mcp')
mkdirSync(outDir, { recursive: true })

const server = new McpServer({ name: 'test-tools', version: '1.0.0' })

server.registerTool('ping', {
  description: 'Check the server is alive.',
  inputSchema: {},
  annotations: { readOnlyHint: true },
}, async () => ({ content: [{ type: 'text', text: `pong${process.env.TEST_MCP_SECRET ? ` (secret ${process.env.TEST_MCP_SECRET.length} chars)` : ''}` }] }))

server.registerTool('make_clip', {
  description: 'Generate a short video clip of a solid colour. Returns the path of the mp4.',
  inputSchema: { seconds: z.number().min(0.5).max(10).default(2), color: z.string().default('orange') },
}, async ({ seconds, color }) => {
  const file = join(outDir, `clip-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.mp4`)
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=640x360:r=30:d=${seconds}`,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file], { encoding: 'utf8' })
  if (r.status !== 0) return { isError: true, content: [{ type: 'text', text: `ffmpeg failed: ${r.stderr}` }] }
  return { content: [{ type: 'text', text: file }] }
})

await server.connect(new StdioServerTransport())
