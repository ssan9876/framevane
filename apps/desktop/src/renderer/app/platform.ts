import { shortcutLabel } from '@framevane/ui'

/** Wording that differs between Windows and macOS. Shortcuts are written the Windows way and translated here. */

export const isMac = () => window.framevane.app.platform === 'darwin'

/** The modifier key's label: "Ctrl+" on Windows, "⌘" on a Mac (followed directly by the key). */
export const modKey = () => (isMac() ? '⌘' : 'Ctrl+')

/** A shortcut as this computer writes it ("Ctrl+Z" → "⌘Z" on a Mac). */
export const keys = (k: string) => shortcutLabel(k)

/** "Ctrl+Z undoes it." */
export const undoHint = (verb = 'undoes it') => `${keys('Ctrl+Z')} ${verb}.`

export const trashName = () => (isMac() ? 'Trash' : 'Recycle Bin')
