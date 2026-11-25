/**
 * Inspector fields commit a change 250 ms after the last keystroke or drag (useCommitted). Leaving the editor inside
 * that window used to fire the commit after the project was closed: the edit was lost, and code that read the closed
 * project threw ("Cannot read properties of null (reading 'tracks')", seen on macOS CI). Each waiting commit registers
 * here, and the store flushes them all before it closes a project.
 */
const pending = new Set<() => void>()

/** Register a waiting commit; returns a function that unregisters it. */
export function trackPendingEdit(flush: () => void): () => void {
  pending.add(flush)
  return () => { pending.delete(flush) }
}

/** Apply every waiting commit now (before the project they belong to is closed). */
export function flushPendingEdits() {
  for (const flush of [...pending]) {
    pending.delete(flush)
    try { flush() } catch (e) { console.error('[edits] a pending edit failed to apply', e) }
  }
}
