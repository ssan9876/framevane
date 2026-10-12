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

export function App() {
  const route = useApp((s) => s.route)
  const dialog = useApp((s) => s.dialog)
  useEffect(() => connectEvents(), [])
  return (
    <TooltipProvider>
      <ToastProvider>
        <ErrorToasts />
        <McpBridge />
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
