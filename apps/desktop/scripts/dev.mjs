import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { createServer } from 'vite'
import { watchMainAndPreload } from './esbuild.mjs'

/** Dev: Vite serves the renderer with HMR; esbuild watches main/preload and restarts Electron on change. */
const require = createRequire(import.meta.url)
const electron = require('electron')

const server = await createServer({ configFile: 'vite.config.ts', mode: 'development' })
await server.listen()
const url = server.resolvedUrls.local[0]
let child = null
let restarting = false

function start() {
  child = spawn(electron, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, VITE_DEV_SERVER_URL: url } })
  child.on('exit', (code) => { if (!restarting) { server.close(); process.exit(code ?? 0) } })
}

let first = true
await watchMainAndPreload(() => {
  if (first) { first = false; start(); return }
  restarting = true
  child?.once('exit', () => { restarting = false; start() })
  child?.kill()
})
