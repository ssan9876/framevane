import type { AgentDefInput, AgentDefView } from '../../shared/api'
import { now, uuid7, type Db } from '../db'

/**
 * The agent library (S31): saved agents = instructions + which tools they may use + model/effort + review mode.
 * Built-in agents are re-seeded on every start (so improvements ship with updates) and can't be edited, only
 * duplicated. allowedTools are globs over the tool names the model sees: "cut_ranges", "get_*", "higgsfield__*", "*".
 */

interface DefRow {
  id: string; name: string; description: string; system_prompt: string; model: string; effort: AgentDefView['effort']
  allowed_tools: string; review_mode: AgentDefView['reviewMode']; builtin: number; starter: string | null
}

const READ = ['get_project_summary', 'get_timeline', 'get_transcript', 'get_frames']

export const BUILTIN_AGENTS: AgentDefInput[] = [
  {
    name: 'Editor',
    description: 'General editing help with every tool, including tools from servers you added.',
    instructions: '',
    model: 'default',
    effort: 'medium',
    allowedTools: ['*'],
    reviewMode: 'propose',
    starter: 'Tighten this edit: cut the long pauses and add captions.',
  },
  {
    name: 'Silence cutter',
    description: 'Removes dead air and long pauses, keeping a natural rhythm.',
    instructions: 'Your only job is removing silences. Call find_silences (minSeconds 0.6, paddingSeconds 0.12 unless the user asks otherwise), then cut_ranges with the ranges. Do not caption, restyle or reorder anything.',
    model: 'default',
    effort: 'low',
    allowedTools: [...READ, 'find_silences', 'cut_ranges'],
    reviewMode: 'propose',
    starter: 'Cut the silences.',
  },
  {
    name: 'Captioner',
    description: 'Adds word-timed captions in a big, readable style.',
    instructions: 'Add captions with add_captions, then style_captions for a big readable look: bold (e.g. fontFamily "Montserrat Variable", fontWeight 900), white text with a dark outline, large size, highlightColor for the spoken word, placed in the lower third (above platform UI on vertical video). Keep lines short (max ~6 words). Fix obvious transcription mistakes in names with edit_caption only if you are sure.',
    model: 'default',
    effort: 'low',
    allowedTools: [...READ, 'add_captions', 'style_captions', 'edit_caption'],
    reviewMode: 'propose',
    starter: 'Caption this video.',
  },
  {
    name: 'Short-form maker',
    description: 'Turns a landscape talk into a vertical short: 9:16, blurred fill, no pauses, captions, hook marked.',
    instructions: [
      'Make a vertical short-form edit, in this order:',
      '1. set_canvas_size 9:16, then set_background blur (amount ~0.6) so the landscape video sits on a blurred fill.',
      '2. find_silences then cut_ranges to remove pauses (minSeconds 0.5).',
      '3. add_captions, then style_captions: large, bold, high-contrast, centred slightly below the middle.',
      '4. Read the transcript and add_marker (label "hook", red) at the strongest opening line within the first ~10 seconds, or where a better hook starts if it is later.',
      '5. If the user gave a title, add_text it at 0 s for ~2.5 s, position "upper-third", with animIn "pop".',
      'Do not delete content beyond silences unless the user asks.',
    ].join('\n'),
    model: 'default',
    effort: 'medium',
    allowedTools: [...READ, 'set_canvas_size', 'set_background', 'find_silences', 'cut_ranges', 'add_captions', 'style_captions', 'add_marker', 'set_clip', 'add_text'],
    reviewMode: 'propose',
    starter: 'Make this a vertical short.',
  },
  {
    name: 'Filler-word remover',
    description: 'Finds "um", "uh" and similar fillers in the transcript and cuts them out.',
    instructions: 'Call remove_filler_words to cut hesitation sounds. Then read the transcript (get_transcript) for verbal fillers the tool leaves alone ("like", "you know", "I mean", "so" at the start of a sentence) and cut only the ones clearly used as filler with cut_ranges, using timeline word times padded by ~0.03 s. Never cut meaningful words. Report how many you removed.',
    model: 'default',
    effort: 'medium',
    allowedTools: [...READ, 'remove_filler_words', 'cut_ranges'],
    reviewMode: 'propose',
    starter: 'Remove the filler words.',
  },
  {
    name: 'Sound fixer',
    description: 'Cleans up voice audio, evens out loudness, fades music and tucks it under speech.',
    instructions: [
      'Improve the sound without changing the edit:',
      '1. get_timeline. For each clip with speech on the main track (and linked audio clips), clean_audio with mode "enhance" (use "denoise-strong" only if the user says it is noisy).',
      '2. For music clips on other audio tracks: duck_music under speech, and set_clip fadeInSeconds 1 / fadeOutSeconds 2.',
      'Do not cut, move or caption anything.',
    ].join('\n'),
    model: 'default',
    effort: 'low',
    allowedTools: ['get_project_summary', 'get_timeline', 'clean_audio', 'duck_music', 'set_clip'],
    reviewMode: 'propose',
    starter: 'Make the audio sound good.',
  },
  {
    name: 'Look designer',
    description: 'Gives the edit one consistent look: colour, a filter or LUT, and transitions between cuts.',
    instructions: [
      'Give the whole edit a consistent, tasteful look without changing its content or timing:',
      '1. get_timeline and list_looks. Look at 2–4 frames with get_frames (they show the source footage, before any look).',
      '2. Even out exposure and white balance per clip with adjust_color (small values: |exposure| ≤ 25, |temperature| ≤ 30), so clips match each other.',
      '3. Pick ONE filter that suits the mood the user asked for (or "cinema" / "vivid" if they did not say) and apply_filter to every video/photo clip at intensity 0.5–0.8. If the user gave a .cube file path, apply_lut that instead.',
      '4. Only if the user asks for transitions: set_transition with allOnTrackId on the main track (dissolve 0.4–0.6 s unless they name a style).',
      'Do not add effects unless asked. Do not cut, move or caption anything.',
    ].join('\n'),
    model: 'default',
    effort: 'medium',
    allowedTools: [...READ, 'list_looks', 'adjust_color', 'apply_filter', 'apply_lut', 'set_transition', 'add_effect', 'remove_effect', 'chroma_key'],
    reviewMode: 'propose',
    starter: 'Give this a warm, cinematic look with soft transitions.',
  },
  {
    name: 'Highlight finder',
    description: 'Reads the transcript and marks the best moments. Changes nothing else.',
    instructions: 'Read the transcript and add_marker at the 3 to 6 strongest moments (quotable lines, reveals, jokes, key claims). Label each marker with a few words saying why (max 40 characters); use green for highlights and red for the single best hook. Do not cut or change anything else.',
    model: 'default',
    effort: 'medium',
    allowedTools: [...READ, 'add_marker'],
    reviewMode: 'propose',
    starter: 'Mark the highlights.',
  },
]

const NAME_MAX = 60
const TOOL_GLOB = /^[A-Za-z0-9_*-]{1,80}$/

export class AgentDefs {
  constructor(private db: Db) {}

  /** Upsert the built-in agents by name. A user agent that already took a built-in's name is left alone. */
  seed() {
    for (const d of BUILTIN_AGENTS) {
      const existing = this.db.prepare(`SELECT id, builtin FROM agent_defs WHERE name=?`).get(d.name) as { id: string; builtin: number } | undefined
      if (existing && !existing.builtin) continue
      if (existing) this.write(existing.id, d, true)
      else this.insert(d, true)
    }
  }

  list(): AgentDefView[] {
    const rows = this.db.prepare(`SELECT * FROM agent_defs ORDER BY builtin DESC, created_at`).all() as unknown as DefRow[]
    return rows.map(view)
  }

  get(id: string): AgentDefView {
    const r = this.db.prepare(`SELECT * FROM agent_defs WHERE id=?`).get(id) as unknown as DefRow | undefined
    if (!r) throw new Error('That agent no longer exists')
    return view(r)
  }

  save(id: string | null, input: AgentDefInput): AgentDefView {
    const d = validate(input)
    const clash = this.db.prepare(`SELECT id FROM agent_defs WHERE name=? COLLATE NOCASE`).get(d.name) as { id: string } | undefined
    if (clash && clash.id !== id) throw new Error(`An agent named "${d.name}" already exists.`)
    if (id === null) return this.get(this.insert(d, false))
    if (this.get(id).builtin) throw new Error('Built-in agents can’t be changed. Duplicate it to make your own version.')
    this.write(id, d, false)
    return this.get(id)
  }

  delete(id: string) {
    if (this.get(id).builtin) throw new Error('Built-in agents can’t be deleted.')
    this.db.prepare(`DELETE FROM agent_defs WHERE id=?`).run(id)
  }

  private insert(d: AgentDefInput, builtin: boolean): string {
    const id = uuid7()
    const t = now()
    this.db.prepare(
      `INSERT INTO agent_defs (id, name, description, system_prompt, model, effort, allowed_tools, review_mode, builtin, starter, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, d.name, d.description, d.instructions, d.model, d.effort, JSON.stringify(d.allowedTools), d.reviewMode, builtin ? 1 : 0, d.starter ?? null, t, t)
    return id
  }

  private write(id: string, d: AgentDefInput, builtin: boolean) {
    this.db.prepare(
      `UPDATE agent_defs SET name=?, description=?, system_prompt=?, model=?, effort=?, allowed_tools=?, review_mode=?, builtin=?, starter=?, updated_at=? WHERE id=?`,
    ).run(d.name, d.description, d.instructions, d.model, d.effort, JSON.stringify(d.allowedTools), d.reviewMode, builtin ? 1 : 0, d.starter ?? null, now(), id)
  }
}

function view(r: DefRow): AgentDefView {
  return {
    id: r.id, name: r.name, description: r.description, instructions: r.system_prompt, model: r.model, effort: r.effort,
    allowedTools: JSON.parse(r.allowed_tools) as string[], reviewMode: r.review_mode, builtin: r.builtin === 1, starter: r.starter ?? undefined,
  }
}

function validate(i: AgentDefInput): AgentDefInput {
  const name = i.name.trim()
  if (!name) throw new Error('Give the agent a name.')
  if (name.length > NAME_MAX) throw new Error(`Keep the name under ${NAME_MAX} characters.`)
  const allowedTools = [...new Set(i.allowedTools.map((t) => t.trim()).filter(Boolean))]
  if (!allowedTools.length) throw new Error('Pick at least one tool.')
  const bad = allowedTools.find((t) => !TOOL_GLOB.test(t))
  if (bad) throw new Error(`"${bad}" is not a tool name or pattern (letters, digits, _ and * only).`)
  if (i.instructions.length > 20_000) throw new Error('Instructions are too long (max 20,000 characters).')
  if (!['low', 'medium', 'high', 'xhigh', 'max'].includes(i.effort)) throw new Error('Unknown effort level')
  if (!['propose', 'auto_apply'].includes(i.reviewMode)) throw new Error('Unknown review mode')
  return { ...i, name, description: i.description.trim().slice(0, 300), allowedTools, starter: i.starter?.trim() || undefined }
}

/** Does a tool name match any of the agent's allowed-tool globs? */
export function toolAllowed(globs: string[], name: string) {
  return globs.some((g) => g === '*' || new RegExp(`^${g.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`).test(name))
}
