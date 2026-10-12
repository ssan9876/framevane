import { useEffect, useState } from 'react'
import { Upload } from 'lucide-react'
import { IconButton, Select, useToast } from '@framevane/ui'
import type { CustomFont } from '../../shared/api'
import { BUNDLED_FONTS, loadCustomFonts } from '../engine/fonts'

let systemFonts: Promise<string[]> | null = null

/** Font family picker: bundled fonts, fonts you imported, then the fonts installed in Windows. */
export function FontPicker({ value, onChange, label = 'Font' }: { value: string; onChange: (family: string) => void; label?: string }) {
  const [custom, setCustom] = useState<CustomFont[]>([])
  const [system, setSystem] = useState<string[]>([])
  const toast = useToast()
  useEffect(() => {
    let alive = true
    void loadCustomFonts().then((c) => alive && setCustom(c))
    systemFonts ??= window.framevane.fonts.system()
    void systemFonts.then((s) => alive && setSystem(s))
    return () => { alive = false }
  }, [])

  const seen = new Set<string>()
  const opt = (family: string, hint: string) => (seen.has(family) ? [] : (seen.add(family), [{ value: family, label: family.replace(/ Variable$/, ''), hint }]))
  const options = [
    ...BUNDLED_FONTS.flatMap((f) => opt(f.family, 'built in')),
    ...custom.flatMap((f) => opt(f.family, 'yours')),
    ...system.flatMap((f) => opt(f, '')),
    ...(seen.has(value) ? [] : [{ value, label: `${value.replace(/ Variable$/, '')} (missing)`, hint: '' }]),
  ]

  async function importFont() {
    const paths = await window.framevane.app.pickFiles({ kind: 'font' })
    if (!paths.length) return
    try {
      const before = new Set(custom.map((f) => f.file))
      await window.framevane.fonts.import(paths)
      const list = await loadCustomFonts(true)
      setCustom(list)
      const added = list.find((f) => !before.has(f.file))
      if (added) onChange(added.family)
      toast({ tone: 'success', title: `Added ${paths.length === 1 ? (added?.family ?? 'the font') : `${paths.length} fonts`}` })
    } catch (e) {
      toast({ tone: 'error', title: "That font couldn't be added", description: e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e) })
    }
  }

  return (
    <div className="flex items-center gap-1">
      <Select label={label} value={value} width={190} onValueChange={onChange} options={options} />
      <IconButton size="sm" label="Import a font file" icon={<Upload />} onClick={() => void importFont()} />
    </div>
  )
}
