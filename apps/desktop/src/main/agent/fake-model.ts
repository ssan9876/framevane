import type Anthropic from '@anthropic-ai/sdk'

/**
 * TEST DOUBLE for the Messages API, enabled only with REEL_FAKE_AGENT=1 (e2e runs without an API key).
 * A fixed policy that plays the "cut the silences and add captions" request through the real tools, so the whole
 * pipeline (tool execution, forked doc, proposal, review, apply, undo) is exercised. It is not an AI.
 */

type Params = { messages: Anthropic.Beta.BetaMessageParam[] }

function lastToolResult(messages: Anthropic.Beta.BetaMessageParam[]): string {
  const last = messages[messages.length - 1]
  if (!last || typeof last.content === 'string') return ''
  const r = last.content.find((b) => b.type === 'tool_result') as Anthropic.Beta.BetaToolResultBlockParam | undefined
  return typeof r?.content === 'string' ? r.content : ''
}

function nextTurn(p: Params): Anthropic.Beta.BetaMessage {
  const toolTurns = p.messages.filter((m) => m.role === 'assistant').length
  const use = (name: string, input: Record<string, unknown>): Anthropic.Beta.BetaContentBlock[] => [
    { type: 'thinking', thinking: `Calling ${name}.`, signature: '' } as Anthropic.Beta.BetaContentBlock,
    { type: 'tool_use', id: `toolu_fake_${toolTurns}`, name, input } as Anthropic.Beta.BetaContentBlock,
  ]
  let content: Anthropic.Beta.BetaContentBlock[]
  let stop: Anthropic.Beta.BetaMessage['stop_reason'] = 'tool_use'
  switch (toolTurns) {
    case 0: content = use('get_project_summary', {}); break
    case 1: content = use('find_silences', { minSeconds: 0.8, paddingSeconds: 0.12 }); break
    case 2: {
      const ranges = (JSON.parse(lastToolResult(p.messages) || '{"ranges":[]}') as { ranges: { start: number; end: number }[] }).ranges
      content = ranges.length ? use('cut_ranges', { ranges, reason: 'silence' }) : use('add_captions', {})
      break
    }
    case 3: content = use('add_captions', {}); break
    default: {
      content = [{ type: 'text', text: 'Removed the long pauses and captioned the video.', citations: null } as Anthropic.Beta.BetaContentBlock]
      stop = 'end_turn'
    }
  }
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
