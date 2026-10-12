import { build } from 'vite'
import { buildMainAndPreload } from './esbuild.mjs'

await buildMainAndPreload({ dev: false })
await build({ configFile: 'vite.config.ts', mode: 'production' })
console.log('built dist/main, dist/preload, dist/renderer')
