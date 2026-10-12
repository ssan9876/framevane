import { safeStorage } from 'electron'
import type { ProviderInput, ProviderTool, ToolPermission, ToolProviderView } from '../shared/api'
import { now, uuid7, type Db } from './db'
import type { McpHub, ToolInfo } from './mcp-hub'

/**
 * User-added MCP servers (S28). Each is a tool provider with a short name that namespaces its tools for the agent
 * ("higgsfield__generate_video"). Secrets (env vars, HTTP headers) are encrypted with the OS keychain (DPAPI) and only
 * the key names are stored in tool_providers. Every tool has a permission: auto, ask (default) or never; read-only
 * tools default to auto; tools marked "costs money" always ask, whatever their permission says.
 */

interface ProviderRow {
  id: string; kind: 'builtin' | 'local_ai' | 'mcp_stdio' | 'mcp_http'; name: string; command: string | null; args: string; url: string | null
  env_keys: string; enabled: number; status: ToolProviderView['status']; last_error: string | null
}
interface ToolRow { id: string; provider_id: string; name: string; description: string; input_schema: string; mutates: number; costs_money: number; permission: ToolPermission }

export interface AgentExternalTool {
  provider: string
  name: string
  /** provider__tool, ≤64 chars, [a-zA-Z0-9_-] */
  fullName: string
  description: string
  inputSchema: Record<string, unknown>
  permission: ToolPermission
  costsMoney: boolean
}

const NAME = /^[a-z][a-z0-9_]{0,23}$/
const RESERVED = new Set(['editor', 'local', 'framevane'])

export class ToolRegistry {
  constructor(private db: Db, private hub: McpHub) {}

  /* ── queries ── */

  list(): ToolProviderView[] {
    const rows = this.db.prepare(`SELECT * FROM tool_providers WHERE kind IN ('mcp_stdio','mcp_http') ORDER BY created_at`).all() as unknown as ProviderRow[]
    return [this.localView(), ...rows.map((r) => this.view(r))]
  }

  get(id: string): ToolProviderView {
    const r = this.row(id)
    return this.view(r)
  }

  /** Tools the agent may be offered (enabled providers, permission ≠ never), in a stable order for prompt caching. */
  agentTools(): AgentExternalTool[] {
    const rows = this.db.prepare(
      `SELECT p.name AS provider, t.* FROM provider_tools t JOIN tool_providers p ON p.id = t.provider_id
       WHERE p.enabled = 1 AND p.kind IN ('mcp_stdio','mcp_http') AND t.permission != 'never' ORDER BY p.name, t.name`,
    ).all() as unknown as (ToolRow & { provider: string })[]
    return rows.map((t) => ({
      provider: t.provider,
      name: t.name,
      fullName: fullToolName(t.provider, t.name),
      description: t.description,
      inputSchema: JSON.parse(t.input_schema) as Record<string, unknown>,
      permission: t.permission,
      costsMoney: t.costs_money === 1,
    }))
  }

  /** Make sure an enabled provider is connected (lazy: servers start on first use). */
  async ensureConnected(providerName: string) {
    if (this.hub.isConnected(providerName)) return
    const r = this.db.prepare(`SELECT * FROM tool_providers WHERE name = ?`).get(providerName) as unknown as ProviderRow | undefined
    if (!r) throw new Error(`No tool provider named ${providerName}`)
    await this.connectRow(r)
  }

  /** Call an external tool for an agent run. Returns the raw MCP content blocks. */
  async call(providerName: string, tool: string, args: Record<string, unknown>, signal?: AbortSignal) {
    await this.ensureConnected(providerName)
    return this.hub.callRaw(providerName, tool, args, { signal })
  }

  /** Look up an agent-facing tool name ("provider__tool"). */
  resolve(fullName: string): AgentExternalTool | undefined {
    return this.agentTools().find((t) => t.fullName === fullName)
  }

  /** Connect every enabled server in the background at startup so tool lists are fresh. */
  async connectAll() {
    const rows = this.db.prepare(`SELECT id FROM tool_providers WHERE enabled=1 AND kind IN ('mcp_stdio','mcp_http')`).all() as { id: string }[]
    await Promise.allSettled(rows.map((r) => this.refresh(r.id)))
  }

  /* ── changes ── */

  async add(input: ProviderInput): Promise<ToolProviderView> {
    const name = input.name.trim().toLowerCase()
    if (!NAME.test(name)) throw new Error('Use a short name: lowercase letters, digits and _ (max 24), starting with a letter.')
    if (RESERVED.has(name)) throw new Error(`"${name}" is reserved. Pick another name.`)
    if (this.db.prepare(`SELECT 1 FROM tool_providers WHERE name = ?`).get(name)) throw new Error(`A server named "${name}" already exists.`)
    const id = uuid7()
    const t = now()
    this.db.prepare(
      `INSERT INTO tool_providers (id, kind, name, command, args, url, env_keys, enabled, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'unknown', ?, ?)`,
    ).run(id, input.kind, name, input.kind === 'mcp_stdio' ? input.command?.trim() || null : null, JSON.stringify(input.args ?? []),
      input.kind === 'mcp_http' ? input.url?.trim() || null : null, JSON.stringify(Object.keys(input.env ?? {})), t, t)
    this.saveSecrets(id, { env: input.env ?? {}, headers: input.headers ?? {} })
    return this.refresh(id)
  }

  async update(id: string, input: ProviderInput): Promise<ToolProviderView> {
    const r = this.row(id)
    const old = this.secrets(id)
    const env = { ...old.env, ...(input.env ?? {}) }
    const headers = { ...old.headers, ...(input.headers ?? {}) }
    for (const [k, v] of Object.entries(input.env ?? {})) if (v === '') delete env[k]
    for (const [k, v] of Object.entries(input.headers ?? {})) if (v === '') delete headers[k]
    this.db.prepare(`UPDATE tool_providers SET command = ?, args = ?, url = ?, env_keys = ?, updated_at = ? WHERE id = ?`)
      .run(r.kind === 'mcp_stdio' ? input.command?.trim() || r.command : null, JSON.stringify(input.args ?? JSON.parse(r.args)), r.kind === 'mcp_http' ? input.url?.trim() || r.url : null,
        JSON.stringify(Object.keys(env)), now(), id)
    this.saveSecrets(id, { env, headers })
    return this.refresh(id)
  }

  async remove(id: string) {
    const r = this.row(id)
    await this.hub.disconnect(r.name)
    this.db.prepare(`DELETE FROM tool_providers WHERE id = ?`).run(id)
    this.db.prepare(`DELETE FROM settings WHERE key = ?`).run(`secret.provider.${id}`)
  }

  /** Reconnect and re-list tools. New tools get defaults; existing ones keep the user's choices. */
  async refresh(id: string): Promise<ToolProviderView> {
    const r = this.row(id)
    if (!r.enabled) return this.view(r)
    try {
      const tools = await this.connectRow(r)
      this.syncTools(id, tools)
      this.db.prepare(`UPDATE tool_providers SET status='connected', last_error=NULL, updated_at=? WHERE id=?`).run(now(), id)
    } catch (e) {
      this.db.prepare(`UPDATE tool_providers SET status='error', last_error=?, updated_at=? WHERE id=?`).run(e instanceof Error ? e.message : String(e), now(), id)
    }
    return this.get(id)
  }

  async setEnabled(id: string, enabled: boolean): Promise<ToolProviderView> {
    const r = this.row(id)
    this.db.prepare(`UPDATE tool_providers SET enabled=?, status=?, updated_at=? WHERE id=?`).run(enabled ? 1 : 0, enabled ? 'unknown' : 'disabled', now(), id)
    if (!enabled) { await this.hub.disconnect(r.name); return this.get(id) }
    return this.refresh(id)
  }

  setToolPermission(providerId: string, tool: string, permission: ToolPermission): ToolProviderView {
    this.db.prepare(`UPDATE provider_tools SET permission=?, updated_at=? WHERE provider_id=? AND name=?`).run(permission, now(), providerId, tool)
    return this.get(providerId)
  }

  setToolCostsMoney(providerId: string, tool: string, costsMoney: boolean): ToolProviderView {
    this.db.prepare(`UPDATE provider_tools SET costs_money=?, updated_at=? WHERE provider_id=? AND name=?`).run(costsMoney ? 1 : 0, now(), providerId, tool)
    return this.get(providerId)
  }

  /** "Always allow" / "never" chosen in a permission prompt. */
  rememberPermission(providerName: string, tool: string, permission: ToolPermission) {
    this.db.prepare(`UPDATE provider_tools SET permission=?, updated_at=? WHERE name=? AND provider_id=(SELECT id FROM tool_providers WHERE name=?)`).run(permission, now(), tool, providerName)
  }

  /* ── internals ── */

  private async connectRow(r: ProviderRow): Promise<ToolInfo[]> {
    const s = this.secrets(r.id)
    return this.hub.connectExternal({ name: r.name, kind: r.kind as 'mcp_stdio' | 'mcp_http', command: r.command, args: JSON.parse(r.args) as string[], url: r.url, env: s.env, headers: s.headers })
  }

  private syncTools(providerId: string, tools: ToolInfo[]) {
    const existing = new Map((this.db.prepare(`SELECT * FROM provider_tools WHERE provider_id=?`).all(providerId) as unknown as ToolRow[]).map((t) => [t.name, t]))
    const seen = new Set<string>()
    for (const t of tools) {
      seen.add(t.name)
      const prev = existing.get(t.name)
      if (prev) {
        this.db.prepare(`UPDATE provider_tools SET description=?, input_schema=?, mutates=?, updated_at=? WHERE id=?`).run(t.description, JSON.stringify(t.inputSchema), t.readOnly ? 0 : 1, now(), prev.id)
      } else {
        this.db.prepare(`INSERT INTO provider_tools (id, provider_id, name, description, input_schema, mutates, costs_money, permission, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`)
          .run(uuid7(), providerId, t.name, t.description, JSON.stringify(t.inputSchema), t.readOnly ? 0 : 1, t.readOnly ? 'auto' : 'ask', now())
      }
    }
    for (const [name, t] of existing) if (!seen.has(name)) this.db.prepare(`DELETE FROM provider_tools WHERE id=?`).run(t.id)
  }

  private row(id: string): ProviderRow {
    const r = this.db.prepare(`SELECT * FROM tool_providers WHERE id=?`).get(id) as unknown as ProviderRow | undefined
    if (!r) throw new Error('That server no longer exists')
    return r
  }

  private view(r: ProviderRow): ToolProviderView {
    const tools = (this.db.prepare(`SELECT * FROM provider_tools WHERE provider_id=? ORDER BY name`).all(r.id) as unknown as ToolRow[]).map((t): ProviderTool => ({
      name: t.name, description: t.description, permission: t.permission, costsMoney: t.costs_money === 1, readOnly: t.mutates === 0,
    }))
    const s = this.secrets(r.id)
    return {
      id: r.id, name: r.name, kind: r.kind as ToolProviderView['kind'], command: r.command, args: JSON.parse(r.args) as string[], url: r.url,
      envKeys: Object.keys(s.env), headerKeys: Object.keys(s.headers), enabled: r.enabled === 1, status: r.status, error: r.last_error, tools, builtin: false,
    }
  }

  /** The bundled local-AI sidecar, shown read-only (its tools reach agents through the editor's own tools). */
  private localView(): ToolProviderView {
    return {
      id: 'local', name: 'local', kind: 'local_ai', command: null, args: [], url: null, envKeys: [], headerKeys: [], enabled: true,
      status: this.hub.sidecarStatus === 'ready' ? 'connected' : this.hub.sidecarStatus === 'error' ? 'error' : 'unknown', error: this.hub.sidecarError,
      tools: [{ name: 'transcribe', description: 'Speech to text with word timings (Whisper on your GPU). Used by captions, transcript and silence tools.', permission: 'auto', costsMoney: false, readOnly: true }],
      builtin: true,
    }
  }

  private secrets(id: string): { env: Record<string, string>; headers: Record<string, string> } {
    const r = this.db.prepare(`SELECT value FROM settings WHERE key=?`).get(`secret.provider.${id}`) as { value: string } | undefined
    if (!r) return { env: {}, headers: {} }
    try {
      const enc = JSON.parse(r.value) as string
      return JSON.parse(safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(enc, 'base64')) : Buffer.from(enc, 'base64').toString('utf8'))
    } catch {
      return { env: {}, headers: {} }
    }
  }

  private saveSecrets(id: string, s: { env: Record<string, string>; headers: Record<string, string> }) {
    const plain = JSON.stringify(s)
    const enc = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(plain).toString('base64') : Buffer.from(plain).toString('base64')
    this.db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`)
      .run(`secret.provider.${id}`, JSON.stringify(enc), now())
  }
}

export function fullToolName(provider: string, tool: string) {
  return `${provider}__${tool.replace(/[^a-zA-Z0-9_-]/g, '_')}`.slice(0, 64)
}
