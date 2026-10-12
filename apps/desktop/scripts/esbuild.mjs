import * as esbuild from 'esbuild'

/** Main + preload bundles (CommonJS for Electron). Everything is bundled except electron itself. */
export function configs({ dev = false } = {}) {
  const common = {
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    sourcemap: dev ? 'inline' : true,
    external: ['electron'],
    loader: { '.sql': 'text' },
    logLevel: 'warning',
    define: { 'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production') },
  }
  return [
    { ...common, entryPoints: ['src/main/index.ts'], outfile: 'dist/main/index.cjs' },
    { ...common, entryPoints: ['src/preload/index.ts'], outfile: 'dist/preload/index.cjs' },
  ]
}

export async function buildMainAndPreload(opts) {
  await Promise.all(configs(opts).map((c) => esbuild.build(c)))
}

export async function watchMainAndPreload(onRebuild) {
  const ctxs = await Promise.all(configs({ dev: true }).map((c) => esbuild.context({
    ...c,
    plugins: [{ name: 'notify', setup(b) { b.onEnd((r) => { if (!r.errors.length) onRebuild() }) } }],
  })))
  await Promise.all(ctxs.map((c) => c.watch()))
  return ctxs
}
