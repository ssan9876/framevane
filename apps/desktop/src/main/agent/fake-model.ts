import type Anthropic from '@anthropic-ai/sdk'

/**
 * TEST DOUBLE for the Messages API, enabled only with FRAMEVANE_FAKE_AGENT=1 (e2e runs without an API key).
 * Fixed policies picked by the request text, played through the real tools so the whole pipeline (tool execution,
 * permission prompts, forked doc, proposal, review, apply, undo) is exercised. It is not an AI.
 *  - "test tool": call <server>__make_clip, import the file it made, put it on the timeline
 *  - "mark…":     drop a marker at 1 s
 *  - otherwise:   cut the silences and add captions
 */

type Params = { messages: Anthropic.Beta.BetaMessageParam[]; tools?: { name: string }[] }

function lastToolResult(messages: Anthropic.Beta.BetaMessageParam[]): { text: string; isError: boolean } {
  const last = messages[messages.length - 1]
  if (!last || typeof last.content === 'string') return { text: '', isError: false }
  const r = last.content.find((b) => b.type === 'tool_result') as Anthropic.Beta.BetaToolResultBlockParam | undefined
  const text = typeof r?.content === 'string' ? r.content : (r?.content ?? []).map((b) => (b.type === 'text' ? b.text : '')).join('\n')
  return { text, isError: !!r?.is_error }
}

function requestText(messages: Anthropic.Beta.BetaMessageParam[]) {
  const first = messages[0]
  if (!first) return ''
  return typeof first.content === 'string' ? first.content : first.content.map((b) => (b.type === 'text' ? b.text : '')).join('\n')
}

function nextTurn(p: Params): Anthropic.Beta.BetaMessage {
  const toolTurns = p.messages.filter((m) => m.role === 'assistant').length
  const has = (name: string) => (p.tools ?? []).some((t) => t.name === name)
  const use = (name: string, input: Record<string, unknown>): Anthropic.Beta.BetaContentBlock[] => [
    { type: 'thinking', thinking: `Calling ${name}.`, signature: '' } as Anthropic.Beta.BetaContentBlock,
    { type: 'tool_use', id: `toolu_fake_${toolTurns}_${Math.random().toString(36).slice(2, 8)}`, name, input } as Anthropic.Beta.BetaContentBlock,
  ]
  const say = (text: string) => [{ type: 'text', text, citations: null } as Anthropic.Beta.BetaContentBlock]
  const req = requestText(p.messages).toLowerCase()
  const last = lastToolResult(p.messages)
  let content: Anthropic.Beta.BetaContentBlock[]

  if (req.includes('test tool')) {
    const maker = (p.tools ?? []).find((t) => t.name.endsWith('__make_clip'))?.name
    switch (toolTurns) {
      case 0: content = maker ? use(maker, { seconds: 2, color: 'orange' }) : say('No clip-making tool is available.'); break
      case 1: content = last.isError ? say('The clip tool was not allowed, so I left the timeline alone.') : use('import_media', { paths: [last.text.trim()] }); break
      case 2: {
        const rows = JSON.parse(last.text || '[]') as { assetId: string }[]
        content = use('add_to_timeline', { assetId: rows[0]?.assetId ?? 'missing' })
        break
      }
      default: content = say('Made a 2 second clip and added it to the end of the timeline.')
    }
  } else if (/\bmark/.test(req)) {
    switch (toolTurns) {
      case 0: content = use('get_project_summary', {}); break
      case 1: content = has('add_marker') ? use('add_marker', { atSeconds: 1, label: 'hook', color: 'red' }) : say('I can’t add markers with my tools.'); break
      default: content = say('Marked the hook at 1 second.')
    }
  } else {
    switch (toolTurns) {
      case 0: content = use('get_project_summary', {}); break
      case 1: content = use('find_silences', { minSeconds: 0.8, paddingSeconds: 0.12 }); break
      case 2: {
        const ranges = (JSON.parse(last.text || '{"ranges":[]}') as { ranges: { start: number; end: number }[] }).ranges
        content = ranges.length ? use('cut_ranges', { ranges, reason: 'silence' }) : has('add_captions') ? use('add_captions', {}) : say('There were no long pauses.')
        break
      }
      case 3: content = has('add_captions') ? use('add_captions', {}) : say('Removed the long pauses.'); break
      default: content = say('Removed the long pauses and captioned the video.')
    }
  }
  const stop: Anthropic.Beta.BetaMessage['stop_reason'] = content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn'
  return {
    id: `msg_fake_${toolTurns}`, type: 'message', role: 'assistant', model: 'fake-agent', content, stop_reason: stop, stop_sequence: null,
    usage: { input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  } as unknown as Anthropic.Beta.BetaMessage
}

class FakeStream {
  private listeners: ((t: string) => void)[] = []
  constructor(private msg: Anthropic.Beta.BetaMessage) {}
  on(event: string, cb: (t: string) => void) { if (event === 'text') this.listeners.push(cb); return this }
  async finalMessage() {
    await new Promise((r) => setTimeout(r, 150))
    for (const b of this.msg.content) if (b.type === 'text') for (const w of b.text.split(/(?<= )/)) this.listeners.forEach((l) => l(w))
    return this.msg
  }
}

export function fakeClient() {
  return { beta: { messages: { stream: (p: Params) => new FakeStream(nextTurn(p)) } } } as unknown as Anthropic
}
