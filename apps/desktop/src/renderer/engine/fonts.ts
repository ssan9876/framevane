import '@fontsource/anton'
import '@fontsource/bebas-neue'
import '@fontsource-variable/montserrat'
import '@fontsource-variable/montserrat/wght-italic.css'
import '@fontsource/permanent-marker'
import '@fontsource-variable/playfair-display'
import '@fontsource-variable/playfair-display/wght-italic.css'
import '@fontsource/pacifico'
import '@fontsource-variable/oswald'
import '@fontsource/bangers'
import type { CustomFont } from '../../shared/api'

/**
 * Fonts for text and captions: a few bundled open-licence families (OFL / Apache, shipped with the app, so presets look
 * the same on every PC), the fonts installed in Windows (usable by name), and font files the user imported.
 */

export const BUNDLED_FONTS: { family: string; weights: number[] }[] = [
  { family: 'Inter Variable', weights: [400, 700, 900] },
  { family: 'Montserrat Variable', weights: [400, 700, 900] },
  { family: 'Oswald Variable', weights: [400, 700] },
  { family: 'Playfair Display Variable', weights: [400, 700, 900] },
  { family: 'Anton', weights: [400] },
  { family: 'Bebas Neue', weights: [400] },
  { family: 'Bangers', weights: [400] },
  { family: 'Permanent Marker', weights: [400] },
  { family: 'Pacifico', weights: [400] },
]

let loaded: Promise<CustomFont[]> | null = null

/** Register the user's imported font files with the document (once per session, again after an import). */
export function loadCustomFonts(force = false): Promise<CustomFont[]> {
  if (loaded && !force) return loaded
  loaded = (async () => {
    const list = await window.framevane.fonts.custom()
    await Promise.all(list.map(async (f) => {
      if ([...document.fonts].some((x) => x.family === f.family && x.weight === String(f.weight) && x.style === f.style)) return
      try {
        const face = new FontFace(f.family, `url("${f.url}")`, { weight: String(f.weight), style: f.style })
        document.fonts.add(await face.load())
      } catch (e) {
        console.warn('[fonts] could not load', f.file, e)
      }
    }))
    return list
  })()
  return loaded
}
