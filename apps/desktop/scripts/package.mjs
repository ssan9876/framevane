// Build a portable Windows release: release/Framevane-<version>-win-x64.zip (+ .sha256).
// Bundles pinned, checksum-verified FFmpeg (GPL shared build) and uv, plus the local-AI sidecar source.
import { packager } from '@electron/packager'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const APP = resolve(HERE, '..')
const ROOT = resolve(APP, '../..')
const VENDOR = join(APP, 'vendor') // downloads (git-ignored)
const STAGE = join(APP, 'release', 'stage')
const pkg = JSON.parse(readFileSync(join(APP, 'package.json'), 'utf8'))
const version = pkg.version

/** Pinned third-party binaries. Bump deliberately; the checksum files come from the same releases. */
const FFMPEG = {
  url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-09-28-13-06/ffmpeg-n9.0.2-14-gebafaee10a-win64-gpl-shared-9.0.zip',
  sums: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-09-28-13-06/checksums.sha256',
  source: 'https://github.com/BtbN/FFmpeg-Builds (build scripts) and https://git.ffmpeg.org/ffmpeg.git at n9.0.2-14-gebafaee10a (source)',
}
const UV = {
  url: 'https://github.com/astral-sh/uv/releases/download/0.11.28/uv-x86_64-pc-windows-msvc.zip',
  sums: 'https://github.com/astral-sh/uv/releases/download/0.11.28/uv-x86_64-pc-windows-msvc.zip.sha256',
}

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed`)
}
// Windows' own bsdtar (Git Bash's GNU tar reads "D:" as a remote host and can't write zips)
const TAR = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')

async function fetchVerified({ url, sums }, name) {
  const dir = join(VENDOR, name)
  const file = join(dir, url.split('/').pop())
  mkdirSync(dir, { recursive: true })
  const list = await (await fetch(sums)).text()
  const want = list.split(/\r?\n/).map((l) => l.trim().split(/\s+\*?/)).find(([, n]) => !n || n === url.split('/').pop())?.[0]
  if (!want || !/^[0-9a-f]{64}$/.test(want)) throw new Error(`No checksum for ${url}`)
  if (!existsSync(file) || sha256(file) !== want) {
    console.log(`downloading ${url}`)
    const r = await fetch(url)
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`)
    writeFileSync(file, Buffer.from(await r.arrayBuffer()))
  }
  if (sha256(file) !== want) throw new Error(`${file} failed its checksum check`)
  const out = join(dir, 'x')
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
  run(TAR, ['-xf', file, '-C', out])
  return out
}

console.log('1/5 build')
run(process.execPath, [join(HERE, 'build.mjs')], { cwd: APP })

console.log('2/5 third-party binaries')
const ff = await fetchVerified(FFMPEG, 'ffmpeg')
const ffRoot = join(ff, readdirSync(ff)[0])
const uv = await fetchVerified(UV, 'uv')

console.log('3/5 stage resources')
rmSync(join(APP, 'release'), { recursive: true, force: true })
const res = (p) => join(STAGE, p)
mkdirSync(res('ffmpeg'), { recursive: true })
for (const f of readdirSync(join(ffRoot, 'bin'))) if (/\.(exe|dll)$/i.test(f) && f !== 'ffplay.exe') cpSync(join(ffRoot, 'bin', f), res(`ffmpeg/${f}`))
cpSync(join(ffRoot, 'LICENSE.txt'), res('ffmpeg/LICENSE.txt'))
writeFileSync(res('ffmpeg/SOURCE.txt'), `FFmpeg ${FFMPEG.url.split('/').pop()}\nLicensed under the GPL (see LICENSE.txt). Source: ${FFMPEG.source}\n`)
mkdirSync(res('uv'), { recursive: true })
for (const f of readdirSync(uv)) cpSync(join(uv, f), res(`uv/${f}`), { recursive: true })
// the sidecar: source + lockfile only (its Python environment is created in app data on first use)
const side = join(ROOT, 'sidecar')
mkdirSync(res('sidecar/framevane_sidecar'), { recursive: true })
for (const f of ['pyproject.toml', 'uv.lock']) cpSync(join(side, f), res(`sidecar/${f}`))
for (const f of readdirSync(join(side, 'framevane_sidecar'))) if (f.endsWith('.py')) cpSync(join(side, 'framevane_sidecar', f), res(`sidecar/framevane_sidecar/${f}`))

console.log('4/5 package')
const [appDir] = await packager({
  dir: APP,
  out: join(APP, 'release'),
  name: 'Framevane',
  executableName: 'Framevane',
  platform: 'win32',
  arch: 'x64',
  electronVersion: pkg.dependencies.electron,
  appVersion: version,
  icon: join(APP, 'build', 'icon.ico'),
  asar: true,
  prune: false,
  overwrite: true,
  // everything the app needs is bundled into dist/ (main, preload, renderer)
  ignore: (p) => p !== '' && !/^\/(dist(\/|$)|package\.json$)/.test(p),
  extraResource: [res('ffmpeg'), res('uv'), res('sidecar')],
  win32metadata: { CompanyName: 'Framevane', ProductName: 'Framevane', FileDescription: 'Framevane video and photo editor' },
})
writeFileSync(join(appDir, 'README.txt'), [
  `Framevane ${version} — a free video and photo editor with built-in AI agents.`,
  '',
  'Run Framevane.exe. Nothing needs installing; your projects go to Documents\\Framevane Projects.',
  'Local AI (captions, voices, background removal) sets itself up the first time you use it: it downloads',
  'Python packages (about 1.5 GB) and each model once. Settings → AI models shows and manages them.',
  '',
  'Bundled: FFmpeg (GPL, see resources\\ffmpeg\\LICENSE.txt and SOURCE.txt) and uv (Apache-2.0/MIT).',
  'The video background model (Robust Video Matting) is GPL-3.0 and is downloaded, not bundled.',
].join('\r\n'))

console.log('5/5 zip')
const zip = join(APP, 'release', `Framevane-${version}-win-x64.zip`)
run(TAR, ['-a', '-c', '-f', zip, '-C', join(APP, 'release'), 'Framevane-win32-x64'])
writeFileSync(`${zip}.sha256`, `${sha256(zip)}  ${zip.split(/[\\/]/).pop()}\n`)
console.log(`done: ${zip}`)
