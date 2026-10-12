import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { TtsVoice } from '../shared/api'
import type { McpHub } from './mcp-hub'

/**
 * Text to speech. Two local engines:
 *  - "windows": the voices built into Windows (SAPI via System.Speech). Instant, no download, robotic.
 *  - "kokoro":  natural voices from the Kokoro model in the local AI sidecar (downloaded once, ~340 MB, runs on CPU).
 * Output is a WAV in the cache, keyed by engine + voice + speed + text, so asking twice costs nothing.
 */

const PS_LIST = '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { $v=$_.VoiceInfo; "$($v.Name)`t$($v.Culture)`t$($v.Gender)" }'
// inputs come in through environment variables, never through the command text
const PS_SPEAK = 'Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; if ($env:FV_VOICE) { $s.SelectVoice($env:FV_VOICE) }; $s.Rate=[int]$env:FV_RATE; $s.SetOutputToWaveFile($env:FV_OUT); $s.Speak([IO.File]::ReadAllText($env:FV_TEXT, [Text.Encoding]::UTF8)); $s.Dispose()'

function ps(command: string, env: Record<string, string> = {}, timeout = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout, env: { ...process.env, ...env }, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim().split('\n').slice(-2).join(' ')))
      else resolve(stdout)
    })
  })
}

export class Tts {
  private windows: Promise<TtsVoice[]> | null = null

  constructor(private cacheDir: string, private hub: McpHub) {}

  async voices(): Promise<TtsVoice[]> {
    this.windows ??= process.platform !== 'win32' ? Promise.resolve([]) : ps(PS_LIST).then((out) => out.split(/\r?\n/).filter(Boolean).map((line) => {
      const [name, culture, gender] = line.split('\t')
      return { id: `windows:${name!.trim()}`, engine: 'windows' as const, name: name!.trim().replace(/^Microsoft /, '').replace(/ Desktop$/, ''), language: culture?.trim() ?? '', gender: (gender?.trim().toLowerCase() === 'female' ? 'female' : gender?.trim().toLowerCase() === 'male' ? 'male' : 'neutral') as TtsVoice['gender'], ready: true }
    })).catch(() => [])
    const kokoro = await this.kokoroVoices()
    return [...kokoro, ...(await this.windows)]
  }

  /** Kokoro voices (always listed; `ready` is false until the model is downloaded). */
  async kokoroVoices(): Promise<TtsVoice[]> {
    let ready = false
    try { ready = (await this.hub.callTool<{ ready: boolean }>('local', 'tts_status', {}, { timeoutMs: 60_000 })).ready } catch { return [] }
    return KOKORO_VOICES.map((v) => ({ ...v, engine: 'kokoro' as const, ready }))
  }

  /** Download the Kokoro model (once). */
  async installKokoro(onProgress?: (p: number, message?: string) => void) {
    await this.hub.callTool('local', 'tts_install', {}, { timeoutMs: 30 * 60_000, onProgress })
  }

  /** Speak `text` with a voice; returns a WAV path. speed: 0.5–2 (1 = normal). */
  async synthesize(text: string, voiceId: string, speed = 1, signal?: AbortSignal): Promise<string> {
    const clean = text.trim()
    if (!clean) throw new Error('There is no text to speak.')
    if (clean.length > 5000) throw new Error('That text is too long to speak in one go (max 5,000 characters).')
    const dir = join(this.cacheDir, 'tts')
    await mkdir(dir, { recursive: true })
    const out = join(dir, `${createHash('sha1').update(`${voiceId}\u0000${speed}\u0000${clean}`).digest('hex').slice(0, 16)}.wav`)
    if (existsSync(out)) return out
    const [engine, ...rest] = voiceId.split(':')
    const voice = rest.join(':')
    if (engine === 'kokoro') {
      await this.hub.callTool('local', 'tts', { text: clean, voice, speed, out }, { signal, timeoutMs: 10 * 60_000 })
    } else if (engine === 'windows') {
      const textFile = `${out}.txt`
      await writeFile(textFile, clean, 'utf8')
      try {
        // SAPI rate is −10…10; map speed 0.5–2 onto it
        const rate = Math.round(Math.max(-10, Math.min(10, Math.log2(speed) * 6)))
        await ps(PS_SPEAK, { FV_VOICE: voice, FV_RATE: String(rate), FV_OUT: out, FV_TEXT: textFile })
      } finally {
        await rm(textFile, { force: true })
      }
    } else {
      throw new Error(`Unknown voice ${voiceId}`)
    }
    if (!existsSync(out)) throw new Error('The voice did not produce any audio.')
    return out
  }
}

/** A selection of Kokoro v1.0 voices (Apache-2.0 model). Ids match the voice pack. */
export const KOKORO_VOICES: Omit<TtsVoice, 'engine' | 'ready'>[] = [
  { id: 'kokoro:af_heart', name: 'Heart', language: 'en-US', gender: 'female' },
  { id: 'kokoro:af_bella', name: 'Bella', language: 'en-US', gender: 'female' },
  { id: 'kokoro:af_nicole', name: 'Nicole (soft)', language: 'en-US', gender: 'female' },
  { id: 'kokoro:af_sarah', name: 'Sarah', language: 'en-US', gender: 'female' },
  { id: 'kokoro:am_michael', name: 'Michael', language: 'en-US', gender: 'male' },
  { id: 'kokoro:am_fenrir', name: 'Fenrir', language: 'en-US', gender: 'male' },
  { id: 'kokoro:am_puck', name: 'Puck', language: 'en-US', gender: 'male' },
  { id: 'kokoro:am_adam', name: 'Adam', language: 'en-US', gender: 'male' },
  { id: 'kokoro:bf_emma', name: 'Emma', language: 'en-GB', gender: 'female' },
  { id: 'kokoro:bf_isabella', name: 'Isabella', language: 'en-GB', gender: 'female' },
  { id: 'kokoro:bm_george', name: 'George', language: 'en-GB', gender: 'male' },
  { id: 'kokoro:bm_fable', name: 'Fable', language: 'en-GB', gender: 'male' },
]
