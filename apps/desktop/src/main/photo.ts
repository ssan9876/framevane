import { PHOTO_DURATION_US, type OpInput } from '@framevane/doc'
import { uuid7 } from './db'
import type { Media } from './media'
import type { Projects } from './projects'

/**
 * A photo project (S25): the canvas takes the first image's size and each image becomes a layer at 0 (bottom first).
 * Used by the Home screen and by agents (create_project with kind "photo").
 */
export async function createPhotoProject(projects: Projects, media: Media, name: string, files: string[], size: { width?: number; height?: number } = {}) {
  const projectId = projects.create(name, { width: size.width ?? 1080, height: size.height ?? 1080 }, 'photo')
  if (!files.length) return projectId
  const infos = (await media.import(projectId, files)).filter((m) => m.status !== 'unsupported' && m.asset.kind === 'image')
  const doc = projects.get(projectId)
  const first = infos.find((m) => m.asset.width && m.asset.height)
  const ops: OpInput[] = first ? [{ type: 'set_canvas', canvas: { width: first.asset.width!, height: first.asset.height! } }] : []
  infos.forEach((m, i) => {
    ops.push({ type: 'add_asset', asset: m.asset })
    const trackId = i === 0 ? 'track-main' : `track-layer-${uuid7().slice(-8)}`
    if (i > 0) ops.push({ type: 'add_track', track: { id: trackId, kind: 'video', name: m.asset.name, main: false, locked: false, hidden: false, muted: false, clips: [] } })
    ops.push({ type: 'add_clip', trackId, clip: { id: `clip-${uuid7().slice(-12)}`, kind: 'image', assetId: m.asset.id, startUs: 0, durationUs: PHOTO_DURATION_US } })
  })
  if (ops.length) projects.apply(projectId, doc.version, ops, 'load')
  projects.close(projectId)
  return projectId
}
