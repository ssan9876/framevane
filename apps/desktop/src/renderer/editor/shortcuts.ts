import { useEffect } from 'react'
import { projectDurationUs } from '@framevane/doc'
import { useApp } from '../app/store'
import { deleteSelection, rippleDeleteSide, splitAtPlayhead, stepFrames } from './actions'
import { addMarker, copySelection, cutSelection, detachAudio, duplicateSelection, groupSelection, markerJump, pasteClipboard, toggleEnabled, ungroupSelection } from './actions-m1'

/** Editor keyboard shortcuts (common NLE keys). Ignored while typing in a field. Listed in Settings → Shortcuts (S24). */
export const SHORTCUTS: { keys: string; action: string; group: string }[] = [
  { keys: 'Space', action: 'Play / pause', group: 'Playback' },
  { keys: '← / →', action: 'Previous / next frame', group: 'Playback' },
  { keys: 'Shift+← / →', action: 'Back / forward 1 second', group: 'Playback' },
  { keys: 'Home / End', action: 'Start / end of the timeline', group: 'Playback' },
  { keys: 'Ctrl+B', action: 'Split at the playhead', group: 'Editing' },
  { keys: 'Delete', action: 'Delete selected clips', group: 'Editing' },
  { keys: 'Q / W', action: 'Delete left / right of the playhead', group: 'Editing' },
  { keys: 'Ctrl+Z / Ctrl+Shift+Z', action: 'Undo / redo', group: 'Editing' },
  { keys: 'Ctrl+A', action: 'Select all clips', group: 'Editing' },
  { keys: 'Ctrl+C / Ctrl+X / Ctrl+V', action: 'Copy / cut / paste at the playhead', group: 'Editing' },
  { keys: 'Ctrl+D', action: 'Duplicate selected clips', group: 'Editing' },
  { keys: 'Ctrl+Shift+S', action: 'Detach audio', group: 'Editing' },
  { keys: 'V', action: 'Disable / enable selected clips', group: 'Editing' },
  { keys: 'Ctrl+G / Ctrl+Shift+G', action: 'Group / ungroup', group: 'Editing' },
  { keys: 'M', action: 'Add a marker at the playhead', group: 'Timeline' },
  { keys: 'Shift+M / Alt+Shift+M', action: 'Next / previous marker', group: 'Timeline' },
  { keys: '`', action: 'Linkage on / off', group: 'Timeline' },
  { keys: 'Esc', action: 'Clear selection', group: 'Editing' },
  { keys: 'P', action: 'Main track magnet on / off', group: 'Timeline' },
  { keys: 'N', action: 'Snapping on / off', group: 'Timeline' },
  { keys: 'Ctrl+= / Ctrl+-', action: 'Zoom the timeline in / out', group: 'Timeline' },
  { keys: 'Shift+Z', action: 'Fit the timeline to the window', group: 'Timeline' },
  { keys: 'Ctrl+E', action: 'Export', group: 'Project' },
  { keys: 'Ctrl+Space', action: 'Ask the agent', group: 'Agent' },
]

export function useEditorShortcuts(ctx: { seek(us: number): void; togglePlay(): void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useApp.getState()
      const doc = s.doc
      if (!doc || s.dialog) return
      const el = e.target as HTMLElement
      const typing = el.closest('input, textarea, select, [contenteditable="true"], [role="slider"], [role="spinbutton"]')
      const ctrl = e.ctrlKey || e.metaKey
      if (ctrl && e.code === 'Space') { e.preventDefault(); document.getElementById('agent-composer')?.focus(); return }
      if (typing) return
      const k = e.key
      const handled = () => { e.preventDefault(); e.stopPropagation() }
      if (k === ' ' && !el.closest('button')) { handled(); ctx.togglePlay(); return }
      if (ctrl && k.toLowerCase() === 'z' && !e.shiftKey) { handled(); void window.framevane.doc.undo(doc.id); return }
      if (ctrl && ((k.toLowerCase() === 'z' && e.shiftKey) || k.toLowerCase() === 'y')) { handled(); void window.framevane.doc.redo(doc.id); return }
      if (ctrl && k.toLowerCase() === 'b') { handled(); splitAtPlayhead(); return }
      if (ctrl && k.toLowerCase() === 'e') { handled(); s.openDialog('export'); return }
      if (ctrl && e.shiftKey && k.toLowerCase() === 's') { handled(); void detachAudio(); return }
      if (ctrl && e.shiftKey && k.toLowerCase() === 'g') { handled(); ungroupSelection(); return }
      if (ctrl && k.toLowerCase() === 'g') { handled(); groupSelection(); return }
      if (ctrl && k.toLowerCase() === 'c') { handled(); copySelection(); return }
      if (ctrl && k.toLowerCase() === 'x') { handled(); cutSelection(); return }
      if (ctrl && k.toLowerCase() === 'v') { handled(); void pasteClipboard(); return }
      if (ctrl && k.toLowerCase() === 'd') { handled(); void duplicateSelection(); return }
      if (ctrl && k.toLowerCase() === 'a') { handled(); s.select(doc.tracks.filter((t) => !t.locked).flatMap((t) => t.clips.map((c) => c.id))); return }
      if (ctrl && (k === '=' || k === '+')) { handled(); s.setZoom(s.pxPerSec * 1.25); return }
      if (ctrl && k === '-') { handled(); s.setZoom(s.pxPerSec / 1.25); return }
      if (ctrl) return
      if (k === 'Delete' || k === 'Backspace') { handled(); deleteSelection(); return }
      if (k === 'Escape') { s.select([]); return }
      if (k === 'q' || k === 'Q') { handled(); rippleDeleteSide('left'); return }
      if (k === 'w' || k === 'W') { handled(); rippleDeleteSide('right'); return }
      if ((k === 'm' || k === 'M') && e.shiftKey) { handled(); const t = markerJump(doc, s.playheadUs, e.altKey ? -1 : 1); if (t !== null) ctx.seek(t); return }
      if (k === 'm' && !e.altKey) { handled(); addMarker(); return }
      if (k === 'v' || k === 'V') { handled(); toggleEnabled(); return }
      if (k === '`') { handled(); useApp.setState({ linkage: !s.linkage }); return }
      if (k === 'p' || k === 'P') { handled(); useApp.setState({ magnet: !s.magnet }); return }
      if (k === 'n' || k === 'N') { handled(); useApp.setState({ snapping: !s.snapping }); return }
      if (k === 'Z' && e.shiftKey) { handled(); window.dispatchEvent(new CustomEvent('framevane:fit-timeline')); return }
      if (e.altKey && (k === 'k' || k === 'K')) { handled(); s.setError('The keyframe graph (S21) arrives in M1 with keyframes.'); return }
      const n = e.shiftKey ? Math.round(doc.canvas.fps.num / doc.canvas.fps.den) : 1
      if (k === 'ArrowLeft') { handled(); ctx.seek(stepFrames(doc, s.playheadUs, -n)); return }
      if (k === 'ArrowRight') { handled(); ctx.seek(stepFrames(doc, s.playheadUs, n)); return }
      if (k === 'Home') { handled(); ctx.seek(0); return }
      if (k === 'End') { handled(); ctx.seek(projectDurationUs(doc)); return }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ctx])
}
