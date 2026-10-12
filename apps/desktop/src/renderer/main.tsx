import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { App } from './app/App'
import { EFFECTS, TRANSITIONS } from '@framevane/doc'
import { LookRenderer } from './engine/gl'

// diagnostics for tests and support: which look shaders fail to compile on this GPU (empty = all good)
;(window as unknown as { framevaneDiagnostics: unknown }).framevaneDiagnostics = {
  lookShaders: () => LookRenderer.get()?.compileAll({ effects: EFFECTS.map((e) => e.kind), transitions: TRANSITIONS.map((t) => t.kind) }) ?? ['webgl2 unavailable'],
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
