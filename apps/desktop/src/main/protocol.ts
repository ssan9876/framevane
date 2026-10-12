import { protocol } from 'electron'
import { createReadStream, statSync } from 'node:fs'
import { extname } from 'node:path'
import { Readable } from 'node:stream'
import type { Media } from './media'

/**
 * framevane-media:// serves ONLY registered assets (by id), never arbitrary paths:
 *   asset/<id>  the playable file (original or mezzanine), with HTTP Range support for WebCodecs demuxing
 *   thumb/<id>  poster jpg · strip/<id> filmstrip jpg · peaks/<id> waveform peaks (Uint8, 100/s)
 */

export const SCHEME = 'framevane-media'

export function registerSchemePrivileges() {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
  ])
}

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.wav': 'audio/wav', '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.opus': 'audio/ogg',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.avif': 'image/avif',
}

export function handleMediaProtocol(media: Media) {
  protocol.handle(SCHEME, async (req) => {
    const url = new URL(req.url)
    const kind = url.host
    const id = decodeURIComponent(url.pathname.replace(/^\//, ''))
    const row = media.get(id)
    if (!row) return new Response('Not found', { status: 404 })
    let file: string | null = null
    if (kind === 'asset') file = (url.searchParams.get('proxy') === '1' && media.proxyPath(id)) || media.playablePath(id)
    else if (kind === 'thumb') file = row.thumbs_path
    else if (kind === 'strip') file = row.thumbs_path?.replace(/\.jpg$/, '.strip.jpg') ?? null
    else if (kind === 'peaks') file = row.waveform_path
    if (!file) return new Response('Not ready', { status: 404 })
    return serveFile(file, req.headers.get('range'), kind === 'peaks' ? 'application/octet-stream' : MIME[extname(file).toLowerCase()] ?? 'application/octet-stream')
  })
}

function serveFile(file: string, range: string | null, type: string): Response {
  let size: number
  try { size = statSync(file).size } catch { return new Response('Missing file', { status: 404 }) }
  const headers: Record<string, string> = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' }
  const m = range && /bytes=(\d*)-(\d*)/.exec(range)
  if (m) {
    let start = m[1] ? Number(m[1]) : 0
    let end = m[2] ? Number(m[2]) : size - 1
    if (!m[1] && m[2]) { start = Math.max(0, size - Number(m[2])); end = size - 1 } // suffix range
    end = Math.min(end, size - 1)
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } })
    const body = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream
    return new Response(body, { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) } })
  }
  const body = Readable.toWeb(createReadStream(file)) as ReadableStream
  return new Response(body, { status: 200, headers: { ...headers, 'Content-Length': String(size) } })
}
