// Build a release for this computer's platform:
//   Windows → release/Framevane-<version>-win-x64.zip (portable folder)
//   macOS   → release/Framevane-<version>-mac-arm64.dmg and .zip (Framevane.app, Apple Silicon, ad-hoc signed)
// (+ .sha256 next to each). Bundles pinned, checksum-verified FFmpeg and uv, plus the local-AI sidecar source.
// The Mac build must run on a Mac (the app bundle's symlinks and code signature can't be made on Windows).
import { packager } from '@electron/packager'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const APP = resolve(HERE, '..')
const ROOT = resolve(APP, '../..')
const VENDOR = join(APP, 'vendor') // downloads (git-ignored)
const RELEASE = join(APP, 'release')
const STAGE = join(RELEASE, 'stage')
const pkg = JSON.parse(readFileSync(join(APP, 'package.json'), 'utf8'))
const version = pkg.version
const MAC = process.platform === 'darwin'
if (!MAC && process.platform !== 'win32') throw new Error('Releases are built on Windows or macOS')
if (MAC && process.arch !== 'arm64') throw new Error('The Mac release is Apple Silicon only (the local AI has no Intel Mac build); run this on an arm64 Mac')

/**
 * Pinned third-party binaries with their SHA-256 (taken from each release's own checksum file when it was pinned, kept
 * here so a cached download verifies offline and a release that later disappears can't swap the bytes). Bump deliberately.
 */
const BIN = MAC
  ? {
    // Martin Riedl's static, signed macOS builds (GPL v3): https://ffmpeg.martin-riedl.de
    ffmpeg: [
      { name: 'ffmpeg', url: 'https://ffmpeg.martin-riedl.de/download/macos/arm64/1795207104_9.1/ffmpeg.zip', sha256: '1f66e9a690a7f1c9e60b012379f8869c11818d1797f45b21dbb2f2564ba61ae1' },
      { name: 'ffprobe', url: 'https://ffmpeg.martin-riedl.de/download/macos/arm64/1795207104_9.1/ffprobe.zip', sha256: '6ef2df5f575042923a28537ab37adf936f28bf3e7b85de23a1447ed447ec1dbd' },
    ],
    ffmpegSource: 'https://ffmpeg.martin-riedl.de (static macOS arm64 release build of FFmpeg 9.1; build scripts: https://gitlab.com/martinr92/ffmpeg) and https://git.ffmpeg.org/ffmpeg.git at n9.1 (source)',
    uv: { name: 'uv', url: 'https://github.com/astral-sh/uv/releases/download/0.11.28/uv-aarch64-apple-darwin.tar.gz', sha256: '33540eb7c883ab857eff79bd5ac2aa31fe27b595abecb4a9c003a2c998447232' },
  }
  : {
    // BtbN prunes old autobuilds, so this URL stops working after a while; a cached copy in vendor/ still verifies
    ffmpeg: [{
      name: 'ffmpeg',
      url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-09-28-13-06/ffmpeg-n9.0.2-14-gebafaee10a-win64-gpl-shared-9.0.zip',
      sha256: '7997f62b2b20e386620ff25d70edc92763341e2d28bdadadfb9d5ac4f109332f',
    }],
    ffmpegSource: 'https://github.com/BtbN/FFmpeg-Builds (build scripts) and https://git.ffmpeg.org/ffmpeg.git at n9.0.2-14-gebafaee10a (source)',
    uv: { name: 'uv', url: 'https://github.com/astral-sh/uv/releases/download/0.11.28/uv-x86_64-pc-windows-msvc.zip', sha256: '0a23463216d09c6a72ff80ef5dc5a795f07dc1575cb84d24596c2f124a441b7b' },
  }

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed`)
}
// Windows' own bsdtar (Git Bash's GNU tar reads "D:" as a remote host and can't write zips); macOS tar is bsdtar too
const TAR = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')

async function fetchVerified({ name, url, sha256: want }) {
  const fileName = url.split('/').pop()
  const dir = join(VENDOR, name)
  const file = join(dir, fileName)
  mkdirSync(dir, { recursive: true })
  if (!existsSync(file) || sha256(file) !== want) {
    console.log(`downloading ${url}`)
    const r = await fetch(url)
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}${r.status === 404 ? ' (the release is gone: pin a newer build and its SHA-256)' : ''}`)
    writeFileSync(file, Buffer.from(await r.arrayBuffer()))
  }
  if (sha256(file) !== want) throw new Error(`${file} failed its checksum check`)
  const out = join(dir, 'x')
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
  run(TAR, ['-xf', file, '-C', out])
  return out
}

/** Every file under a folder (archives nest their contents differently). */
function walk(dir) {
  return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p] })
}

console.log('1/5 build')
run(process.execPath, [join(HERE, 'build.mjs')], { cwd: APP })

console.log('2/5 third-party binaries')
const ffDirs = []
for (const spec of BIN.ffmpeg) ffDirs.push(await fetchVerified(spec))
const uvDir = await fetchVerified(BIN.uv)

console.log('3/5 stage resources')
rmSync(RELEASE, { recursive: true, force: true })
const res = (p) => join(STAGE, p)
mkdirSync(res('ffmpeg'), { recursive: true })
mkdirSync(res('uv'), { recursive: true })
if (MAC) {
  for (const d of ffDirs) for (const f of walk(d)) if (/\/(ffmpeg|ffprobe)$/.test(f)) cpSync(f, res(`ffmpeg/${f.split('/').pop()}`))
  for (const f of ['ffmpeg', 'ffprobe']) { if (!existsSync(res(`ffmpeg/${f}`))) throw new Error(`${f} missing from the download`); chmodSync(res(`ffmpeg/${f}`), 0o755) }
  writeFileSync(res('ffmpeg/LICENSE.txt'), 'FFmpeg is licensed under the GNU General Public License version 3 (this build uses --enable-gpl --enable-version3).\nSee https://www.gnu.org/licenses/gpl-3.0.txt and https://ffmpeg.org/legal.html\n')
  for (const f of walk(uvDir)) if (/\/(uv|uvx)$/.test(f)) { cpSync(f, res(`uv/${f.split('/').pop()}`)); chmodSync(res(`uv/${f.split('/').pop()}`), 0o755) }
} else {
  const ffRoot = join(ffDirs[0], readdirSync(ffDirs[0])[0])
  for (const f of readdirSync(join(ffRoot, 'bin'))) if (/\.(exe|dll)$/i.test(f) && f !== 'ffplay.exe') cpSync(join(ffRoot, 'bin', f), res(`ffmpeg/${f}`))
  cpSync(join(ffRoot, 'LICENSE.txt'), res('ffmpeg/LICENSE.txt'))
  for (const f of readdirSync(uvDir)) cpSync(join(uvDir, f), res(`uv/${f}`), { recursive: true })
}
writeFileSync(res('ffmpeg/SOURCE.txt'), `FFmpeg ${BIN.ffmpeg.map((s) => s.url.split('/').slice(-2).join('/')).join(', ')}\nLicensed under the GPL (see LICENSE.txt). Source: ${BIN.ffmpegSource}\n`)
if (!existsSync(res(MAC ? 'uv/uv' : 'uv/uv.exe'))) throw new Error('uv missing from the download')
// the sidecar: source + lockfile only (its Python environment is created in app data on first use)
const side = join(ROOT, 'sidecar')
mkdirSync(res('sidecar/framevane_sidecar'), { recursive: true })
for (const f of ['pyproject.toml', 'uv.lock']) cpSync(join(side, f), res(`sidecar/${f}`))
for (const f of readdirSync(join(side, 'framevane_sidecar'))) if (f.endsWith('.py')) cpSync(join(side, 'framevane_sidecar', f), res(`sidecar/framevane_sidecar/${f}`))

/** A macOS .icns from the 1024 px PNG (sips + iconutil ship with macOS). */
function makeIcns() {
  const set = join(STAGE, 'icon.iconset')
  mkdirSync(set, { recursive: true })
  for (const s of [16, 32, 128, 256, 512]) {
    run('sips', ['-z', String(s), String(s), join(APP, 'build', 'icon.png'), '--out', join(set, `icon_${s}x${s}.png`)], { stdio: 'ignore' })
    run('sips', ['-z', String(s * 2), String(s * 2), join(APP, 'build', 'icon.png'), '--out', join(set, `icon_${s}x${s}@2x.png`)], { stdio: 'ignore' })
  }
  const icns = join(STAGE, 'icon.icns')
  run('iconutil', ['-c', 'icns', set, '-o', icns])
  return icns
}

console.log('4/5 package')
const [appDir] = await packager({
  dir: APP,
  out: RELEASE,
  name: 'Framevane',
  executableName: 'Framevane',
  platform: MAC ? 'darwin' : 'win32',
  arch: MAC ? 'arm64' : 'x64',
  electronVersion: pkg.dependencies.electron,
  appVersion: version,
  icon: MAC ? makeIcns() : join(APP, 'build', 'icon.ico'),
  asar: true,
  prune: false,
  overwrite: true,
  // everything the app needs is bundled into dist/ (main, preload, renderer)
  ignore: (p) => p !== '' && !/^\/(dist(\/|$)|package\.json$)/.test(p),
  extraResource: [res('ffmpeg'), res('uv'), res('sidecar')],
  ...(MAC
    ? {
      appBundleId: 'app.framevane.desktop',
      appCategoryType: 'public.app-category.video',
      darwinDarkModeSupport: true,
      // what macOS shows when Framevane asks (voiceover recording; projects in Documents; media you open)
      extendInfo: {
        NSMicrophoneUsageDescription: 'Framevane records voiceovers from your microphone.',
        NSDocumentsFolderUsageDescription: 'Framevane keeps your projects in Documents › Framevane Projects.',
        NSDesktopFolderUsageDescription: 'Framevane opens the media you choose from your Desktop.',
        NSDownloadsFolderUsageDescription: 'Framevane opens the media you choose from Downloads.',
        LSMinimumSystemVersion: '14.0',
      },
    }
    : { win32metadata: { CompanyName: 'Framevane', ProductName: 'Framevane', FileDescription: 'Framevane video and photo editor' } }),
})

const readme = (lines) => lines.join(MAC ? '\n' : '\r\n')
const common = [
  'Local AI (captions, voices, background removal, on-screen text for templates) sets itself up the first time you',
  'use it: it downloads Python packages (about 1.5 GB) and each model once. Settings → AI models shows and manages them.',
  '',
  'Bundled: FFmpeg (GPL, see the ffmpeg folder\'s LICENSE.txt and SOURCE.txt) and uv (Apache-2.0/MIT).',
  'The video background model (Robust Video Matting) is GPL-3.0 and is downloaded, not bundled.',
]

console.log('5/5 archive')
const outputs = []
if (MAC) {
  const bundle = join(appDir, 'Framevane.app')
  // ad-hoc signature: Apple Silicon only runs signed code. Inner tools first, then the bundle.
  for (const f of ['ffmpeg/ffmpeg', 'ffmpeg/ffprobe', 'uv/uv', 'uv/uvx']) {
    const p = join(bundle, 'Contents', 'Resources', f)
    if (existsSync(p)) run('codesign', ['--force', '--sign', '-', '--timestamp=none', p])
  }
  run('codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', bundle])
  run('codesign', ['--verify', '--deep', '--strict', bundle])
  const readmeText = readme([
    `Framevane ${version} for macOS (Apple Silicon, macOS 14 or later) — a free video and photo editor with built-in AI agents.`,
    '',
    'Drag Framevane into Applications. The app isn\'t notarized by Apple yet, so the first time:',
    '  open it, then System Settings → Privacy & Security → "Framevane was blocked" → Open Anyway,',
    '  or in Terminal: xattr -dr com.apple.quarantine /Applications/Framevane.app',
    'Your projects go to Documents/Framevane Projects.',
    '',
    ...common,
  ])
  writeFileSync(join(appDir, 'README.txt'), readmeText)
  const zip = join(RELEASE, `Framevane-${version}-mac-arm64.zip`)
  run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', bundle, zip])
  outputs.push(zip)
  // the disk image: the app, a link to Applications, and the read-me
  const dmgDir = join(RELEASE, 'dmg')
  mkdirSync(dmgDir, { recursive: true })
  run('ditto', [bundle, join(dmgDir, 'Framevane.app')])
  symlinkSync('/Applications', join(dmgDir, 'Applications'))
  writeFileSync(join(dmgDir, 'Read me.txt'), readmeText)
  const dmg = join(RELEASE, `Framevane-${version}-mac-arm64.dmg`)
  run('hdiutil', ['create', '-volname', 'Framevane', '-srcfolder', dmgDir, '-ov', '-format', 'UDZO', dmg])
  outputs.push(dmg)
} else {
  writeFileSync(join(appDir, 'README.txt'), readme([
    `Framevane ${version} — a free video and photo editor with built-in AI agents.`,
    '',
    'Run Framevane.exe. Nothing needs installing; your projects go to Documents\\Framevane Projects.',
    ...common,
  ]))
  const zip = join(RELEASE, `Framevane-${version}-win-x64.zip`)
  run(TAR, ['-a', '-c', '-f', zip, '-C', RELEASE, 'Framevane-win32-x64'])
  outputs.push(zip)
}
for (const f of outputs) writeFileSync(`${f}.sha256`, `${sha256(f)}  ${f.split(/[\\/]/).pop()}\n`)
console.log(`done:\n${outputs.join('\n')}`)
