import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/** Edge-case media for the specs (generated once, never shipped). Seed media comes from scripts/make-seed-media.ps1 (.sh on a Mac). */
export const SEED = resolve(HERE, '../../../replica/seed-media')
export const EDGE = join(SEED, 'edge')
export const WEIRD_DIR = join(EDGE, 'folder with spaces & ünïcode')
export const files = {
  talk: join(SEED, 'talk.mp4'),
  /** The first 8 s of talk.mp4, for checks that run an AI model on every frame (CPU-only CI Macs matte ~2 fps). */
  talkShort: join(EDGE, 'talk-8s.mp4'),
  broll: join(SEED, 'broll.mp4'),
  music: join(SEED, 'music.m4a'),
  still: join(SEED, 'still.png'),
  weird: join(WEIRD_DIR, 'Tést 🎬 clip (copy).mp4'),
  avi: join(EDGE, 'legacy-mpeg4.avi'),
  hevc10: join(EDGE, 'hevc-10bit.mp4'),
  rotated: join(EDGE, 'phone-portrait-rotated.mp4'),
  vfr: join(EDGE, 'variable-frame-rate.mp4'),
  fake: join(EDGE, 'not-really-a-video.mp4'),
  uhd: join(EDGE, 'uhd-4k.mp4'),
  relink: join(EDGE, 'relink-me.mp4'),
  greenscreen: join(EDGE, 'greenscreen.mp4'),
  lut: join(EDGE, 'Swap RB.cube'),
  lut1d: join(EDGE, 'one-dimensional.cube'),
  /** 10 s of a real person (C-SPAN floor speech, public domain in the US), for background removal and reframe. */
  person: join(SEED, 'person.mp4'),
  personStill: join(SEED, 'person.png'),
  /** A 4 s vertical "post" to copy: cuts at 1.0, 2.0 and 3.2 s, a title (0–2 s), a boxed caption (2–4 s) and a tone. */
  edit: join(EDGE, 'edit-to-copy.mp4'),
  /** Whether the post above got its on-screen text, and why not: `{ text: boolean, reason?: string }`. */
  editInfo: join(EDGE, 'edit-to-copy.json'),
}

/** What global setup could put into edit-to-copy.mp4 (read by the template spec). */
export function editInfo(): { text: boolean; reason?: string } {
  try { return JSON.parse(readFileSync(files.editInfo, 'utf8')) } catch { return { text: false, reason: 'edit-to-copy.json is missing (made by an older global setup)' } }
}

/** A bold system font for drawtext (Windows, macOS, Linux). FreeType reads .ttc collections too (first face). */
const FONT_CANDIDATES = [
  'C:/Windows/Fonts/arialbd.ttf',
  '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
  '/Library/Fonts/Arial Bold.ttf',
  '/System/Library/Fonts/Supplemental/Arial.ttf',
  '/System/Library/Fonts/Supplemental/Verdana Bold.ttf',
  '/System/Library/Fonts/Helvetica.ttc',
  '/System/Library/Fonts/SFNS.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
]
function boldFont() {
  return FONT_CANDIDATES.find((f) => existsSync(f)) ?? null
}

const PERSON_URL = 'https://upload.wikimedia.org/wikipedia/commons/7/77/Bill_Posey_speaking%2C_2021-10-21.webm'

/** A 3D LUT that swaps red and blue (easy to check in pixels). */
function swapLut(n: number) {
  const rows: string[] = []
  for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) rows.push(`${(b / (n - 1)).toFixed(4)} ${(g / (n - 1)).toFixed(4)} ${(r / (n - 1)).toFixed(4)}`)
  return ['TITLE "Swap red and blue"', `LUT_3D_SIZE ${n}`, ...rows, ''].join('\n')
}

function ff(args: string[]) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`ffmpeg ${args.join(' ')} failed: ${r.stderr}`)
}

export default function globalSetup() {
  if (!existsSync(files.talk)) {
    // Windows voices (PowerShell) or macOS voices (say) speak the seed script
    const r = process.platform === 'win32'
      ? spawnSync('pwsh', ['-NoProfile', '-File', resolve(HERE, '../scripts/make-seed-media.ps1')], { stdio: 'inherit' })
      : spawnSync('bash', [resolve(HERE, '../scripts/make-seed-media.sh')], { stdio: 'inherit' })
    if (r.status !== 0) throw new Error('making the seed media failed')
  }
  mkdirSync(WEIRD_DIR, { recursive: true })
  if (!existsSync(files.weird)) ff(['-i', files.talk, '-t', '8', '-c', 'copy', files.weird])
  if (!existsSync(files.talkShort)) ff(['-i', files.talk, '-t', '8', '-c', 'copy', files.talkShort])
  if (!existsSync(files.avi)) ff(['-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=25:duration=6', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-c:v', 'mpeg4', '-q:v', '5', '-c:a', 'pcm_s16le', files.avi])
  if (!existsSync(files.hevc10)) ff(['-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=4', '-c:v', 'libx265', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p10le', '-tag:v', 'hvc1', '-c:a', 'aac', files.hevc10])
  if (!existsSync(files.rotated)) {
    const tmp = join(EDGE, '_landscape.mp4')
    ff(['-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=550:duration=4', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', tmp])
    ff(['-display_rotation', '90', '-i', tmp, '-c', 'copy', files.rotated])
  }
  if (!existsSync(files.vfr)) ff(['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=6', '-vf', "setpts='if(lt(N,60),N/30,2+(N-60)/12)/TB'", '-fps_mode', 'vfr', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', files.vfr])
  if (!existsSync(files.uhd)) ff(['-f', 'lavfi', '-i', 'testsrc2=size=3840x2160:rate=30:duration=3', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', files.uhd])
  if (!existsSync(files.greenscreen)) ff(['-f', 'lavfi', '-i', 'color=c=0x10c040:s=640x360:r=25:d=4', '-f', 'lavfi', '-i', 'testsrc=size=240x180:rate=25:duration=4', '-filter_complex', '[0][1]overlay=200:90,format=yuv420p', '-c:v', 'libx264', '-preset', 'veryfast', files.greenscreen])
  if (!existsSync(files.lut)) writeFileSync(files.lut, swapLut(9))
  if (!existsSync(files.person)) {
    // downloaded once; tests that need a person skip if this isn't possible (offline)
    const raw = join(EDGE, '_person-source.webm')
    const r = spawnSync('curl', ['-sSL', '-A', 'FramevaneTest/0.1 (local test fixture)', '-o', raw, PERSON_URL], { encoding: 'utf8' })
    if (r.status === 0 && existsSync(raw)) {
      ff(['-ss', '20', '-t', '10', '-i', raw, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', files.person])
      rmSync(raw, { force: true })
    }
  }
  if (existsSync(files.person) && !existsSync(files.personStill)) ff(['-ss', '3', '-i', files.person, '-frames:v', '1', files.personStill])
  if (!existsSync(files.edit) || !existsSync(files.editInfo)) {
    // some FFmpeg builds (Homebrew's) leave out drawtext; then the post has no text and the text checks are skipped
    // (this regex once held literal backspace bytes instead of word boundaries, so it never matched and every post
    // lost its text)
    const filters = spawnSync('ffmpeg', ['-hide_banner', '-filters'], { encoding: 'utf8', maxBuffer: 16 << 20 })
    const hasDrawtext = /\bdrawtext\b/.test(filters.stdout ?? '')
    // which ffmpeg this is, for the reason below (a PATH can hold more than one)
    const which = process.platform === 'win32' ? spawnSync('where', ['ffmpeg'], { encoding: 'utf8' }) : spawnSync('sh', ['-c', 'command -v ffmpeg'], { encoding: 'utf8' })
    const version = spawnSync('ffmpeg', ['-hide_banner', '-version'], { encoding: 'utf8' }).stdout?.split('\n')[0] ?? '?'
    const ffmpegId = `${(which.stdout ?? '').trim().split(/\r?\n/)[0] || 'ffmpeg'} (${version}; -filters exit ${filters.status}, ${(filters.stdout ?? '').length} chars)`
    const font = hasDrawtext ? boldFont() : null
    const info: { text: boolean; reason?: string } = font ? { text: true } : { text: false, reason: hasDrawtext ? `no font for drawtext (looked for ${FONT_CANDIDATES.join(', ')})` : `this FFmpeg has no drawtext filter: ${ffmpegId}` }
    // inside a filtergraph a drive colon must be escaped (C\:/Windows/…)
    const fontArg = font ? `fontfile='${font.replace(/:/g, '\\:')}'` : ''
    const text = font
      ? `,drawtext=${fontArg}:text='POV you finally':fontcolor=white:fontsize=84:x=(w-tw)/2:y=480:enable='lt(t,2)',drawtext=${fontArg}:text='Step 1':fontcolor=black:fontsize=96:box=1:boxcolor=white:boxborderw=24:x=(w-tw)/2:y=1400:enable='gte(t,2)'`
      : ''
    ff([
      '-f', 'lavfi', '-i', 'testsrc2=s=1080x1920:r=30:d=1',
      '-f', 'lavfi', '-i', 'smptebars=s=1080x1920:r=30:d=1',
      '-f', 'lavfi', '-i', 'color=c=0xd04020:s=1080x1920:r=30:d=1.2',
      '-f', 'lavfi', '-i', 'rgbtestsrc=s=1080x1920:r=30:d=0.8',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
      '-filter_complex', `[0][1][2][3]concat=n=4:v=1:a=0,format=yuv420p${text}[v]`,
      '-map', '[v]', '-map', '4:a', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-shortest', files.edit,
    ])
    // check the title really is in the pixels: the band it sits in at 0.5 s against the same band of bare testsrc2
    if (info.text) {
      const band = (input: string[]) => spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...input, '-vf', 'crop=1080:160:0:460,format=gray', '-frames:v', '1', '-f', 'rawvideo', 'pipe:1'], { maxBuffer: 8 << 20 }).stdout as Buffer
      const drawn = band(['-ss', '0.5', '-i', files.edit])
      const bare = band(['-f', 'lavfi', '-i', 'testsrc2=s=1080x1920:r=30:d=1', '-ss', '0.5'])
      let changed = 0
      for (let i = 0; i < Math.min(drawn.length, bare.length); i++) if (Math.abs(drawn[i]! - bare[i]!) > 60) changed++
      if (!drawn.length || changed < 1500) Object.assign(info, { text: false, reason: `drawtext with ${font} ran but the title isn't in the frame (${changed} px changed)` })
    }
    if (!info.text) console.warn(`[global-setup] edit-to-copy.mp4 has no on-screen text: ${info.reason}`)
    writeFileSync(files.editInfo, JSON.stringify(info))
  }
  if (!existsSync(files.lut1d)) writeFileSync(files.lut1d, ['LUT_1D_SIZE 2', '0 0 0', '1 1 1', ''].join('\n'))
  if (!existsSync(files.fake)) writeFileSync(files.fake, 'This is a text file wearing an .mp4 name.\n')
  // a copy we can delete to test missing media
  const victim = join(EDGE, 'will-be-deleted.mp4')
  if (!existsSync(victim)) copyFileSync(files.broll, victim)
}
