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
  if (!existsSync(files.fake)) writeFileSync(files.fake, 'This is a text file wearing an .mp4 name.\n')
  // a copy we can delete to test missing media
  const victim = join(EDGE, 'will-be-deleted.mp4')
  if (!existsSync(victim)) copyFileSync(files.broll, victim)
}
