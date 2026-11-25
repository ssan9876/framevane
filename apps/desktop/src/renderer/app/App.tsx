import { useEffect } from 'react'
import { ToastProvider, TooltipProvider, useToast } from '@framevane/ui'
import { connectEvents, useApp } from './store'
import { connectMcpBridge } from './mcpBridge'
import { Home } from '../screens/Home'
import { Editor } from '../editor/Editor'
import { ComingSoon } from '../screens/ComingSoon'
import { SettingsDialog } from '../screens/SettingsDialog'
import { AgentLibraryDialog } from '../screens/AgentLibraryDialog'

function ErrorToasts() {
  const error = useApp((s) => s.error)
  const toast = useToast()
  useEffect(() => {
    if (!error) return
    toast({ tone: 'error', title: error })
    useApp.getState().setError(null)
  }, [error, toast])
  return null
}

/** Connected agents (Claude Code over MCP): live edits get a toast with Undo. */
function McpBridge() {
  const toast = useToast()
  useEffect(() => connectMcpBridge((a) => {
    useApp.getState().pushActivity(a)
    const doc = useApp.getState().doc
    if (a.status === 'done' && a.mutates && doc) {
      toast({ tone: 'info', title: `${a.client}: ${a.tool.replace(/_/g, ' ')}`, description: a.summary || undefined, action: { label: 'Undo', onClick: () => void window.framevane.doc.undo(doc.id) } })
    } else if (a.status === 'error') {
      toast({ tone: 'warning', title: `${a.client}: ${a.tool.replace(/_/g, ' ')} failed`, description: a.summary })
    }
  }), [toast])
  return null
}

/** Settings from the keyboard (Ctrl+,) and, on a Mac, from the app menu (⌘, is the menu item's shortcut there). */
function AppCommands() {
  useEffect(() => {
    const off = window.framevane.app.onMenu((cmd) => { if (cmd === 'settings') useApp.getState().openDialog('settings') })
    const onKey = (e: KeyboardEvent) => {
      if (window.framevane.app.platform !== 'darwin' && e.ctrlKey && e.key === ',') { e.preventDefault(); useApp.getState().openDialog('settings') }
    }
    window.addEventListener('keydown', onKey)
    return () => { off(); window.removeEventListener('keydown', onKey) }
  }, [])
  return null
}

/**
 * Which video codecs this PC's WebCodecs can actually decode (HEVC needs hardware decoding on Windows, for one). If
 * any listed profile fails, the codec counts as undecodable and its files get a mezzanine. HEVC is checked at 8 and
 * 10 bits (phones record 10-bit HEVC); VP9 and AV1 at 8 bits only, so a PC without 10-bit support for those doesn't
 * convert every ordinary file. Keys are ffprobe's codec names.
 */
const DECODE_CHECKS: Record<string, string[]> = {
  h264: ['avc1.640028'],
  hevc: ['hvc1.1.6.L120.B0', 'hvc1.2.4.L120.B0'],
  vp9: ['vp09.00.40.08'],
  av1: ['av01.0.08M.08'],
  vp8: ['vp8'],
}
async function reportUndecodable() {
  const undecodable: string[] = []
  for (const [codec, strings] of Object.entries(DECODE_CHECKS)) {
    const ok = await Promise.all(strings.map((s) => VideoDecoder.isConfigSupported({ codec: s, codedWidth: 1920, codedHeight: 1080 }).then((r) => !!r.supported).catch(() => false)))
    if (ok.includes(false)) undecodable.push(codec)
  }
  if (undecodable.length) console.info(`[media] this PC can't decode ${undecodable.join(', ')} in the preview; those files get a playable copy`)
  await window.framevane.media.setUndecodable(undecodable)
}

export function App() {
  const route = useApp((s) => s.route)
  const dialog = useApp((s) => s.dialog)
  useEffect(() => connectEvents(), [])
  useEffect(() => { void reportUndecodable().catch(() => {}) }, [])
  return (
    <TooltipProvider>
      <ToastProvider>
        <ErrorToasts />
        <McpBridge />
        <AppCommands />
        <div className="flex h-full flex-col">
          {route.name === 'home' && <Home />}
          {route.name === 'editor' && <Editor key={route.projectId} projectId={route.projectId} />}
          {route.name === 'ai-maker' && (
            <ComingSoon id="S26" title="Script to video" body="Write or generate a script and get a rough cut with voice-over, captions and b-roll. It will be built as an agent recipe." milestone="should-have" />
          )}
        </div>
        {(dialog === 'settings' || dialog === 'shortcuts') && <SettingsDialog />}
        {dialog === 'agents' && <AgentLibraryDialog />}
      </ToastProvider>
    </TooltipProvider>
  )
}
