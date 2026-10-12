import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: fileURLToPath(new URL('./src/renderer', import.meta.url)),
  base: './',
  plugins: [react(), tailwindcss()],
  server: { port: 5280, strictPort: true },
  build: { outDir: fileURLToPath(new URL('./dist/renderer', import.meta.url)), emptyOutDir: true, target: 'chrome150', sourcemap: true },
  worker: { format: 'es' },
})
