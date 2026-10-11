// Generates CSS from tokens.json. No dependencies.
//   node replica/design/build-tokens.mjs
// Writes:
//   replica/design/tokens.css               raw custom properties (--reel-*), framework-free
//   replica/design/tailwind-theme.css       Tailwind v4 @theme mapping onto those properties
//   packages/ui/src/styles/tokens.css       copy used by the app
//   packages/ui/src/styles/tailwind-theme.css
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const t = JSON.parse(readFileSync(join(here, 'tokens.json'), 'utf8'))

const px = (n) => (typeof n === 'number' ? `${n}px` : n)
const header = '/* GENERATED from replica/design/tokens.json by build-tokens.mjs. Do not edit by hand. */\n'

// ── tokens.css ──
const raw = []
for (const [k, v] of Object.entries(t.color)) raw.push(`  --reel-color-${k}: ${v};`)
for (const [k, v] of Object.entries(t.font)) raw.push(`  --reel-font-${k}: ${v};`)
for (const [k, v] of Object.entries(t.type)) {
  raw.push(`  --reel-text-${k}: ${px(v.size)};`)
  raw.push(`  --reel-text-${k}-line: ${px(v.line)};`)
  raw.push(`  --reel-text-${k}-weight: ${v.weight};`)
}
t.space.forEach((v, i) => raw.push(`  --reel-space-${i}: ${px(v)};`))
for (const [k, v] of Object.entries(t.radius)) raw.push(`  --reel-radius-${k}: ${px(v)};`)
for (const [k, v] of Object.entries(t.shadow)) raw.push(`  --reel-shadow-${k}: ${v};`)
for (const [k, v] of Object.entries(t.motion)) raw.push(`  --reel-${k === 'ease' ? 'ease' : 'dur-' + k}: ${v};`)
for (const [k, v] of Object.entries(t.layout)) {
  if (Array.isArray(v)) continue
  if (typeof v === 'object') {
    for (const [k2, v2] of Object.entries(v)) raw.push(`  --reel-${k}-${k2}: ${px(v2)};`)
  } else raw.push(`  --reel-${k}: ${px(v)};`)
}
for (const [k, v] of Object.entries(t.z)) raw.push(`  --reel-z-${k}: ${v};`)
const tokensCss = `${header}:root {\n  color-scheme: dark;\n${raw.join('\n')}\n}\n`

// ── tailwind-theme.css ── utilities: bg-surface, text-muted, border-input, rounded-md, shadow-pop, text-sm…
const th = ['  --color-*: initial;', '  --color-transparent: transparent;', '  --color-current: currentColor;']
for (const k of Object.keys(t.color)) {
  // text-muted / text-disabled read better as utilities "text-muted", so alias those roles without the "text-" prefix
  const name = k.startsWith('text-') ? k.slice(5) : k === 'text' ? 'fg' : k
  th.push(`  --color-${name}: var(--reel-color-${k});`)
}
th.push('  --font-*: initial;')
for (const k of Object.keys(t.font)) th.push(`  --font-${k}: var(--reel-font-${k});`)
th.push('  --text-*: initial;')
for (const k of Object.keys(t.type)) {
  th.push(`  --text-${k}: var(--reel-text-${k});`)
  th.push(`  --text-${k}--line-height: var(--reel-text-${k}-line);`)
  th.push(`  --text-${k}--font-weight: var(--reel-text-${k}-weight);`)
}
th.push('  --radius-*: initial;')
for (const k of Object.keys(t.radius)) th.push(`  --radius-${k}: var(--reel-radius-${k});`)
th.push('  --shadow-*: initial;')
for (const k of Object.keys(t.shadow)) th.push(`  --shadow-${k}: var(--reel-shadow-${k});`)
th.push('  --ease-soft: var(--reel-ease);')
const themeCss = `${header}/* Spacing uses Tailwind's 4px step (p-1 = 4px, p-0.5 = 2px, p-1.5 = 6px), matching tokens.space. */\n@theme inline {\n${th.join('\n')}\n}\n`

const out = [
  [join(here, 'tokens.css'), tokensCss],
  [join(here, 'tailwind-theme.css'), themeCss],
  [join(root, 'packages', 'ui', 'src', 'styles', 'tokens.css'), tokensCss],
  [join(root, 'packages', 'ui', 'src', 'styles', 'tailwind-theme.css'), themeCss],
]
for (const [file, css] of out) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, css)
  console.log('wrote', file)
}
