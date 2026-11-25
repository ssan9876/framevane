import { spawn } from 'node:child_process'
import { dirname } from 'node:path'
import { ffmpegPaths } from './ffmpeg'
import { findUv } from './mcp-hub'

/**
 * Fetch a public video from a post link (TikTok, Instagram Reels, YouTube Shorts and the other sites yt-dlp knows) for
 * personal use as a template reference. yt-dlp runs through the bundled uv (`uv tool run`), so nothing extra ships with
 * the app and site fixes arrive with each new yt-dlp release. The link always goes after `--`, never as an option.
 */

export const BROWSERS = ['chrome', 'edge', 'firefox', 'safari', 'brave'] as const
export type Browser = (typeof BROWSERS)[number]

export interface Downloaded { path: string; title?: string; uploader?: string }

/** A link the downloader will try: http(s) with a host. Normalizes "tiktok.com/…" without a scheme. */
export function parseLink(input: string): URL | null {
  const s = input.trim()
  if (!s || /\s/.test(s)) return null
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`)
    if ((u.protocol !== 'https:' && u.protocol !== 'http:') || !u.hostname.includes('.')) return null
    if (/^(localhost|127\.|10\.|192\.168\.|\[)/.test(u.hostname)) return null
    return u
  } catch {
    return null
  }
}

export function downloadVideo(link: string, outDir: string, opts: { cookiesFrom?: Browser | null; signal?: AbortSignal; onProgress?: (p: number) => void } = {}): Promise<Downloaded> {
  const url = parseLink(link)
  if (!url) return Promise.reject(new Error('That doesn\'t look like a link to a post. Paste the full link (Share → Copy link).'))
  const uv = findUv()
  if (!uv) return Promise.reject(new Error('Downloading links needs uv, which wasn\'t found. Save the video to a file and drop it in instead.'))
  const ff = ffmpegPaths()
  const args = [
    'tool', 'run', '--from', 'yt-dlp[default,curl-cffi]@latest', 'yt-dlp',
    '--ignore-config', '--no-playlist', '--no-mtime', '--newline', '--progress', '--restrict-filenames',
    '--max-filesize', '1G',
    // H.264 first: it plays and decodes everywhere; anything else gets a mezzanine like any other import
    '-f', 'bv*[vcodec^=avc1][height<=1920]+ba[acodec^=mp4a]/b[vcodec^=avc1]/bv*[height<=1920]+ba/b',
    '--merge-output-format', 'mp4',
    '-o', `${outDir}/reference.%(ext)s`,
    '--print', 'after_move:%(.{filepath,title,uploader})j',
    ...(ff ? ['--ffmpeg-location', dirname(ff.ffmpeg)] : []),
    ...(opts.cookiesFrom ? ['--cookies-from-browser', opts.cookiesFrom] : []),
    '--', url.toString(),
  ]
  return new Promise((resolve, reject) => {
    const p = spawn(uv, args, { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8', UV_NO_PROGRESS: '1' } })
    let out = ''
    let err = ''
    const progress = (s: string) => {
      for (const m of s.matchAll(/\[download\]\s+([\d.]+)%/g)) opts.onProgress?.(Math.min(1, Number(m[1]) / 100))
    }
    p.stdout.setEncoding('utf8').on('data', (s: string) => { out += s; progress(s) })
    p.stderr.setEncoding('utf8').on('data', (s: string) => { err = (err + s).slice(-20_000); progress(s) })
    const abort = () => p.kill()
    opts.signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(() => p.kill(), 15 * 60_000)
    p.on('error', (e) => { clearTimeout(timer); reject(e) })
    p.on('close', (code) => {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', abort)
      if (opts.signal?.aborted) return reject(new Error('cancelled'))
      const line = out.split(/\r?\n/).reverse().find((l) => l.trim().startsWith('{'))
      if (code === 0 && line) {
        try {
          const j = JSON.parse(line) as { filepath?: string; title?: string; uploader?: string }
          if (j.filepath) return resolve({ path: j.filepath, ...(j.title ? { title: j.title } : {}), ...(j.uploader ? { uploader: j.uploader } : {}) })
        } catch { /* fall through */ }
      }
      reject(new Error(friendlyError(err, url, !!opts.cookiesFrom)))
    })
  })
}

/** yt-dlp's error, said plainly (the raw line is kept at the end for anything we don't recognise). */
export function friendlyError(stderr: string, url: URL, usedCookies: boolean): string {
  const last = stderr.split(/\r?\n/).filter((l) => /ERROR|error:/i.test(l)).pop()?.replace(/^.*?ERROR:\s*/, '').trim() ?? stderr.trim().split(/\r?\n/).pop() ?? ''
  const site = /instagram/i.test(url.hostname) ? 'Instagram' : /tiktok/i.test(url.hostname) ? 'TikTok' : 'The site'
  if (/login|log in|sign in|cookies|rate-limit|not available.*account|private/i.test(stderr)) {
    return usedCookies
      ? `${site} still wants a signed-in account for this post. Make sure you're signed in to ${site} in that browser (and that it's closed), or save the video and drop the file in.`
      : `${site} only shows this post to signed-in accounts. Choose your browser under "Use my sign-in from" and try again, or save the video and drop the file in.`
  }
  if (/could not (copy|find).*cookie|cookie.*(database|keyring|decrypt)/i.test(stderr)) return `Couldn't read that browser's sign-in. Close the browser and try again, or pick another one.`
  if (/unsupported url/i.test(stderr)) return 'That link isn\'t a video post Framevane can fetch. Copy the link from the post\'s Share menu.'
  if (/max-filesize|larger than/i.test(stderr)) return 'That video is over 1 GB.'
  if (/unable to download|HTTP Error 404|not found|removed|unavailable/i.test(stderr)) return `${site} says this video isn't available (removed, private or region-locked).`
  if (/getaddrinfo|network|timed out|connection/i.test(stderr)) return 'Couldn\'t reach the site. Check your internet connection.'
  return `Download failed: ${last.slice(0, 300) || 'yt-dlp stopped without saying why'}`
}
