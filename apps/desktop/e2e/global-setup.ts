import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/** Edge-case media for the specs (generated once, never shipped). Seed media comes from scripts/make-seed-media.ps1. */
export const SEED = resolve(HERE, '../../../replica/seed-media')
export const EDGE = join(SEED, 'edge')
export const WEIRD_DIR = join(EDGE, 'folder with spaces & ünïcode')
export const files = {
  talk: join(SEED, 'talk.mp4'),
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
}

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
    const r = spawnSync('pwsh', ['-NoProfile', '-File', resolve(HERE, '../scripts/make-seed-media.ps1')], { stdio: 'inherit' })
    if (r.status !== 0) throw new Error('make-seed-media.ps1 failed')
  }
  mkdirSync(WEIRD_DIR, { recursive: true })
  if (!existsSync(files.weird)) ff(['-i', files.talk, '-t', '8', '-c', 'copy', files.weird])
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
  if (!existsSync(files.lut1d)) writeFileSync(files.lut1d, ['LUT_1D_SIZE 2', '0 0 0', '1 1 1', ''].join('\n'))
  if (!existsSync(files.fake)) writeFileSync(files.fake, 'This is a text file wearing an .mp4 name.\n')
  // a copy we can delete to test missing media
  const victim = join(EDGE, 'will-be-deleted.mp4')
  if (!existsSync(victim)) copyFileSync(files.broll, victim)
}
