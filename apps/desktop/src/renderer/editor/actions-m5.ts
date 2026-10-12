import { findClip, type Follow, type MediaClip, type ReframeRatio } from '@framevane/doc'
import type { JobEvent } from '../../shared/api'
import { useApp } from '../app/store'

/** M5 editor actions: background removal and auto reframe (local AI in the sidecar). */

const st = () => useApp.getState()

/**
 * Turn background removal on for clips (one undo step) and start making their mattes. The picture updates by itself
 * when a matte is ready; resolves when all are done (or throws with the first failure).
 */
export async function removeBackground(clipIds: string[]) {
  const { doc } = st()
  if (!doc) return
  const clips = clipIds.map((id) => findClip(doc, id)?.clip).filter((c): c is MediaClip => !!c && (c.kind === 'video' || c.kind === 'image'))
  if (!clips.length) return
  await st().apply(clips.map((c) => ({ type: 'set_look', clipId: c.id, cutout: {} })))
  await Promise.all([...new Set(clips.map((c) => c.assetId))].map((assetId) => window.framevane.ai.matte(doc.id, assetId)))
}

export function restoreBackground(clipIds: string[]) {
  return st().apply(clipIds.map((clipId) => ({ type: 'set_look', clipId, cutout: null })))
}

/** The running matte job of an asset, if any. */
export function matteJob(jobs: Record<string, JobEvent>, assetId: string): JobEvent | undefined {
  return Object.values(jobs).find((j) => j.kind === 'matte' && j.assetId === assetId && (j.status === 'running' || j.status === 'queued'))
}

/** Switch the project to a ratio and reframe clips (all, or the given ones). One undo step. */
export async function autoReframe(ratio: ReframeRatio, follow: Follow, clipIds?: string[]) {
  const { doc } = st()
  if (!doc) return null
  const r = await window.framevane.ai.reframe(doc.id, { ratio, follow, clipIds })
  if (!(await st().apply(r.ops))) return null
  return r
}
