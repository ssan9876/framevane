import type { TextAnim, TextStyle } from '@framevane/doc'

/** Our own text looks (S06). Each is a style patch + an in/out animation; the text and timing come from the user. */
export interface TextPreset { id: string; name: string; sample: string; style: Partial<TextStyle>; anim?: Partial<{ in: Partial<TextAnim['in']>; out: Partial<TextAnim['out']> }> }

export const TEXT_PRESETS: TextPreset[] = [
  { id: 'plain', name: 'Plain', sample: 'Add text', style: { fontFamily: 'Inter Variable', fontWeight: 700, fontSize: 96, strokeWidth: 0, shadow: { color: '#000000', blur: 16, x: 0, y: 4 } } },
  { id: 'headline', name: 'Headline', sample: 'BIG NEWS', style: { fontFamily: 'Anton', fontWeight: 400, fontSize: 160, strokeWidth: 0, letterSpacing: 2, shadow: { color: '#000000', blur: 24, x: 0, y: 6 } }, anim: { in: { kind: 'pop' }, out: { kind: 'fade' } } },
  { id: 'outline-pop', name: 'Outline pop', sample: 'Wait for it…', style: { fontFamily: 'Montserrat Variable', fontWeight: 900, fontSize: 110, color: '#ffffff', strokeColor: '#000000', strokeWidth: 10 }, anim: { in: { kind: 'pop' } } },
  { id: 'boxed', name: 'Boxed', sample: 'Step 1', style: { fontFamily: 'Inter Variable', fontWeight: 700, fontSize: 80, color: '#111111', strokeWidth: 0, background: '#ffffff', backgroundRadius: 0.3 }, anim: { in: { kind: 'slide-up' }, out: { kind: 'fade' } } },
  { id: 'ember', name: 'Ember', sample: 'Limited offer', style: { fontFamily: 'Montserrat Variable', fontWeight: 800, fontSize: 90, color: '#ffffff', strokeWidth: 0, background: '#ff7a3d', backgroundRadius: 0.15 }, anim: { in: { kind: 'wipe' }, out: { kind: 'wipe' } } },
  { id: 'lower-third', name: 'Lower third', sample: 'Alex Rivera · Founder', style: { fontFamily: 'Inter Variable', fontWeight: 600, fontSize: 56, color: '#ffffff', strokeWidth: 0, background: '#000000cc', backgroundRadius: 0.1, align: 'left', y: 0.84 }, anim: { in: { kind: 'slide-right' }, out: { kind: 'slide-left' } } },
  { id: 'comic', name: 'Comic', sample: 'BOOM!', style: { fontFamily: 'Bangers', fontWeight: 400, fontSize: 150, color: '#ffd84d', strokeColor: '#1a1a1a', strokeWidth: 8, letterSpacing: 3 }, anim: { in: { kind: 'pop' } } },
  { id: 'marker', name: 'Marker', sample: 'note to self', style: { fontFamily: 'Permanent Marker', fontWeight: 400, fontSize: 100, color: '#ffffff', strokeWidth: 0, shadow: { color: '#000000', blur: 10, x: 2, y: 3 } }, anim: { in: { kind: 'typewriter', durationUs: 900_000 } } },
  { id: 'elegant', name: 'Elegant', sample: 'Chapter One', style: { fontFamily: 'Playfair Display Variable', fontWeight: 700, fontSize: 110, italic: true, color: '#fff7e8', strokeWidth: 0, shadow: { color: '#000000', blur: 20, x: 0, y: 2 } }, anim: { in: { kind: 'fade', durationUs: 800_000 }, out: { kind: 'fade', durationUs: 800_000 } } },
  { id: 'script', name: 'Script', sample: 'Summer vibes', style: { fontFamily: 'Pacifico', fontWeight: 400, fontSize: 120, color: '#ffffff', strokeWidth: 0, shadow: { color: '#ff7a3d', blur: 0, x: 4, y: 4 } }, anim: { in: { kind: 'zoom-out' } } },
  { id: 'condensed', name: 'Condensed', sample: 'TOP 5 TIPS', style: { fontFamily: 'Bebas Neue', fontWeight: 400, fontSize: 170, color: '#ffffff', strokeWidth: 0, letterSpacing: 6 }, anim: { in: { kind: 'slide-up' }, out: { kind: 'slide-up' } } },
  { id: 'subtitle', name: 'Subtitle', sample: 'Said it like this', style: { fontFamily: 'Inter Variable', fontWeight: 600, fontSize: 64, color: '#ffffff', strokeWidth: 0, background: '#000000aa', backgroundRadius: 0.2, y: 0.85 } },
]

/** Caption looks (apply to the whole caption track). */
export const CAPTION_PRESETS: { id: string; name: string; style: Partial<TextStyle> }[] = [
  { id: 'classic', name: 'Classic', style: { fontFamily: 'Inter Variable', fontWeight: 700, fontSize: 64, color: '#ffffff', strokeColor: '#000000', strokeWidth: 6, background: null, shadow: null, highlightColor: '#ffd84d', wordByWord: false } },
  { id: 'bold-pop', name: 'Bold pop', style: { fontFamily: 'Montserrat Variable', fontWeight: 900, fontSize: 84, color: '#ffffff', strokeColor: '#000000', strokeWidth: 9, background: null, shadow: { color: '#000000', blur: 12, x: 0, y: 4 }, highlightColor: '#ff7a3d', wordByWord: false } },
  { id: 'boxed', name: 'Boxed', style: { fontFamily: 'Inter Variable', fontWeight: 700, fontSize: 58, color: '#ffffff', strokeWidth: 0, background: '#000000b3', backgroundRadius: 0.25, shadow: null, highlightColor: '#ffd84d', wordByWord: false } },
  { id: 'one-word', name: 'One word', style: { fontFamily: 'Anton', fontWeight: 400, fontSize: 130, color: '#ffffff', strokeColor: '#000000', strokeWidth: 8, background: null, shadow: null, highlightColor: null, wordByWord: true, y: 0.6 } },
  { id: 'minimal', name: 'Minimal', style: { fontFamily: 'Inter Variable', fontWeight: 500, fontSize: 52, color: '#ffffff', strokeWidth: 0, background: null, shadow: { color: '#000000', blur: 8, x: 0, y: 2 }, highlightColor: null, wordByWord: false } },
]
