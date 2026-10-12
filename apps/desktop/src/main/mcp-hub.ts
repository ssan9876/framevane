import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

/**
 * MCP client hub. Every external capability the agents use is an MCP server: the bundled local-AI sidecar
 * (Python, stdio) today, and any server the user adds in Settings → Agents (stdio or HTTP) in M2.
 */

export interface ToolInfo { provider: string; name: string; description: string; inputSchema: Record<string, unknown>; readOnly: boolean }

/** A user-added MCP server: a local command (stdio) or a URL (streamable HTTP) with optional headers. */
export interface ExternalServer {
  name: string
  kind: 'mcp_stdio' | 'mcp_http'
  command?: string | null
  args?: string[]
  env?: Record<string, string>
  url?: string | null
  headers?: Record<string, string>
}
export type SidecarStatus = 'unknown' | 'starting' | 'ready' | 'error'

interface Conn { client: Client; tools: ToolInfo[] }

export class McpHub {
  private conns = new Map<string, Promise<Conn>>()
  sidecarStatus: SidecarStatus = 'unknown'
  sidecarError: string | null = null
  /** Run the local AI on the CPU only (Settings → Performance); takes effect when the sidecar next starts. */
  forceCpu = false

  constructor(private opts: { sidecarDir: string; modelsDir: string }) {}

  /** The local AI sidecar, started on first use. */
  sidecar(): Promise<Conn> {
    return this.connect('local', () => {
      const uv = findUv()
      if (!uv) throw new Error('uv was not found. Install it from https://docs.astral.sh/uv/ to enable local AI.')
      if (!existsSync(join(this.opts.sidecarDir, 'pyproject.toml'))) throw new Error(`Local AI sidecar not found at ${this.opts.sidecarDir}`)
      return new StdioClientTransport({
        command: uv,
        args: ['run', '--project', this.opts.sidecarDir, '--frozen', 'python', '-m', 'framevane_sidecar'],
        cwd: this.opts.sidecarDir,
        env: { ...cleanEnv(), FRAMEVANE_MODELS_DIR: this.opts.modelsDir, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', ...(this.forceCpu ? { FRAMEVANE_FORCE_CPU: '1' } : {}) },
        stderr: 'pipe',
      })
    }, true)
  }

  /** Connect (or reconnect) a user-added server and list its tools. */
  async connectExternal(s: ExternalServer): Promise<ToolInfo[]> {
    await this.disconnect(s.name)
    const conn = await this.connect(s.name, () => {
      if (s.kind === 'mcp_stdio') {
        if (!s.command) throw new Error('A command is required')
        return new StdioClientTransport({ command: s.command, args: s.args ?? [], env: { ...cleanEnv(), ...(s.env ?? {}) }, stderr: 'pipe' })
      }
      if (!s.url || !/^https?:\/\//.test(s.url)) throw new Error('A http(s) URL is required')
      return new StreamableHTTPClientTransport(new URL(s.url), { requestInit: { headers: s.headers ?? {} } })
    })
    return conn.tools
  }

  async disconnect(provider: string) {
    const c = this.conns.get(provider)
    this.conns.delete(provider)
    if (c) await c.then((x) => x.client.close()).catch(() => {})
  }

  isConnected(provider: string) { return this.conns.has(provider) }

  /** Raw MCP call: returns the content blocks (text/image/…) for the agent to read. */
  async callRaw(provider: string, name: string, args: Record<string, unknown>, opts: { signal?: AbortSignal; timeoutMs?: number } = {}) {
    const conn = provider === 'local' ? await this.sidecar() : await this.conns.get(provider)
    if (!conn) throw new Error(`Tool provider "${provider}" is not connected`)
    const res = await conn.client.callTool({ name, arguments: args }, undefined, { signal: opts.signal, timeout: opts.timeoutMs ?? 10 * 60_000, resetTimeoutOnProgress: true })
    return { isError: !!res.isError, content: (res.content ?? []) as { type: string; text?: string; data?: string; mimeType?: string; resource?: { uri?: string; text?: string } }[], structured: res.structuredContent }
  }

  async callTool<T = unknown>(provider: string, name: string, args: Record<string, unknown>, opts: { signal?: AbortSignal; onProgress?: (p: number, message?: string) => void; timeoutMs?: number } = {}): Promise<T> {
    const conn = provider === 'local' ? await this.sidecar() : await this.conns.get(provider)
    if (!conn) throw new Error(`Tool provider "${provider}" is not connected`)
    const res = await conn.client.callTool({ name, arguments: args }, undefined, {
      signal: opts.signal,
      timeout: opts.timeoutMs ?? 120_000,
      resetTimeoutOnProgress: true,
      onprogress: (p) => opts.onProgress?.(p.total ? p.progress / p.total : p.progress, p.message),
    })
    if (res.isError) {
      const text = (res.content as { type: string; text?: string }[]).map((c) => c.text ?? '').join('\n')
      throw new Error(text || `${provider}.${name} failed`)
    }
    if (res.structuredContent) {
      const sc = res.structuredContent as Record<string, unknown>
      // tools returning a dict come back as {result: ...} when the SDK wraps non-object returns
      return (('result' in sc && Object.keys(sc).length === 1 ? sc.result : sc) as T)
    }
    const text = (res.content as { type: string; text?: string }[]).find((c) => c.type === 'text')?.text
    return (text ? JSON.parse(text) : null) as T
  }

  async tools(provider: string): Promise<ToolInfo[]> {
    const conn = provider === 'local' ? await this.sidecar() : await this.conns.get(provider)
    return conn?.tools ?? []
  }

  async closeAll() {
    for (const c of this.conns.values()) await c.then((x) => x.client.close()).catch(() => {})
    this.conns.clear()
  }

  private connect(provider: string, makeTransport: () => Transport, isSidecar = false): Promise<Conn> {
    const existing = this.conns.get(provider)
    if (existing) return existing
    const p = (async () => {
      if (isSidecar) this.sidecarStatus = 'starting'
      const transport = makeTransport()
      if (transport instanceof StdioClientTransport) transport.stderr?.on('data', (d: Buffer) => process.stderr.write(`[${provider}] ${d}`))
      const client = new Client({ name: 'framevane', version: '0.1.0' })
      transport.onclose = () => { this.conns.delete(provider); if (isSidecar) this.sidecarStatus = 'unknown' }
      await client.connect(transport)
      const { tools } = await client.listTools()
      if (isSidecar) { this.sidecarStatus = 'ready'; this.sidecarError = null }
      return { client, tools: tools.map((t) => ({ provider, name: t.name, description: t.description ?? '', inputSchema: t.inputSchema as Record<string, unknown>, readOnly: !!t.annotations?.readOnlyHint })) }
    })()
    this.conns.set(provider, p)
    p.catch((e) => {
      this.conns.delete(provider)
      if (isSidecar) { this.sidecarStatus = 'error'; this.sidecarError = e instanceof Error ? e.message : String(e) }
    })
    return p
  }
}

export function findUv(): string | null {
  if (process.env.FRAMEVANE_UV && existsSync(process.env.FRAMEVANE_UV)) return process.env.FRAMEVANE_UV
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['uv'], { encoding: 'utf8' })
  if (r.status === 0) {
    const first = r.stdout.split(/\r?\n/).find(Boolean)
    if (first && existsSync(first)) return first
  }
  const local = join(homedir(), '.local', 'bin', process.platform === 'win32' ? 'uv.exe' : 'uv')
  return existsSync(local) ? local : null
}

export function defaultSidecarDir(appPath: string, resourcesPath?: string) {
  if (process.env.FRAMEVANE_SIDECAR_DIR) return process.env.FRAMEVANE_SIDECAR_DIR
  const packaged = resourcesPath ? join(resourcesPath, 'sidecar') : null
  if (packaged && existsSync(packaged)) return packaged
  return resolve(appPath, '..', '..', 'sidecar')
}

function cleanEnv(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith('ELECTRON_')) out[k] = v
  return out
}
