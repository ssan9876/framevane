import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { ReelApi } from '../shared/api'

/** window.framevane: the only door from the renderer to the main process. Every call is a typed invoke. */

const on = <T>(channel: string) => (cb: (e: T) => void) => {
  const fn = (_: unknown, e: T) => cb(e)
  ipcRenderer.on(channel, fn)
  return () => { ipcRenderer.removeListener(channel, fn) }
}
const inv = (channel: string) => (...args: unknown[]) => ipcRenderer.invoke(channel, ...args)

const api = {
  app: {
    info: inv('app:info') as ReelApi['app']['info'],
    pickFiles: inv('app:pickFiles') as ReelApi['app']['pickFiles'],
    pickSavePath: inv('app:pickSavePath') as ReelApi['app']['pickSavePath'],
    writeTextFile: inv('app:writeTextFile') as ReelApi['app']['writeTextFile'],
    readTextFile: inv('app:readTextFile') as ReelApi['app']['readTextFile'],
    showItemInFolder: inv('app:showItemInFolder') as ReelApi['app']['showItemInFolder'],
    pathForFile: (file: File) => webUtils.getPathForFile(file),
  },
  projects: {
    list: inv('projects:list') as ReelApi['projects']['list'],
    create: inv('projects:create') as ReelApi['projects']['create'],
    open: inv('projects:open') as ReelApi['projects']['open'],
    close: inv('projects:close') as ReelApi['projects']['close'],
    rename: inv('projects:rename') as ReelApi['projects']['rename'],
    duplicate: inv('projects:duplicate') as ReelApi['projects']['duplicate'],
    remove: inv('projects:remove') as ReelApi['projects']['remove'],
  },
  doc: {
    apply: inv('doc:apply') as ReelApi['doc']['apply'],
    undo: inv('doc:undo') as ReelApi['doc']['undo'],
    redo: inv('doc:redo') as ReelApi['doc']['redo'],
    onChange: on('doc:change'),
  },
  media: {
    import: inv('media:import') as ReelApi['media']['import'],
    list: inv('media:list') as ReelApi['media']['list'],
    reverse: inv('media:reverse') as ReelApi['media']['reverse'],
    relink: inv('media:relink') as ReelApi['media']['relink'],
    processAudio: inv('media:processAudio') as ReelApi['media']['processAudio'],
    saveRecording: inv('media:saveRecording') as ReelApi['media']['saveRecording'],
    onChange: on('media:change'),
  },
  fonts: {
    system: inv('fonts:system') as ReelApi['fonts']['system'],
    custom: inv('fonts:custom') as ReelApi['fonts']['custom'],
    import: inv('fonts:import') as ReelApi['fonts']['import'],
    remove: inv('fonts:remove') as ReelApi['fonts']['remove'],
  },
  tts: {
    voices: inv('tts:voices') as ReelApi['tts']['voices'],
    installKokoro: inv('tts:installKokoro') as ReelApi['tts']['installKokoro'],
    speak: inv('tts:speak') as ReelApi['tts']['speak'],
  },
  jobs: { onEvent: on('jobs:event'), cancel: inv('jobs:cancel') as ReelApi['jobs']['cancel'] },
  analysis: {
    transcript: inv('analysis:transcript') as ReelApi['analysis']['transcript'],
    silences: inv('analysis:silences') as ReelApi['analysis']['silences'],
  },
  export: {
    open: inv('export:open') as ReelApi['export']['open'],
    write: inv('export:write') as ReelApi['export']['write'],
    close: inv('export:close') as ReelApi['export']['close'],
  },
  agent: {
    settings: inv('agent:settings') as ReelApi['agent']['settings'],
    setApiKey: inv('agent:setApiKey') as ReelApi['agent']['setApiKey'],
    setModel: inv('agent:setModel') as ReelApi['agent']['setModel'],
    run: inv('agent:run') as ReelApi['agent']['run'],
    pending: inv('agent:pending') as ReelApi['agent']['pending'],
    defs: inv('agent:defs') as ReelApi['agent']['defs'],
    toolList: inv('agent:toolList') as ReelApi['agent']['toolList'],
    saveDef: inv('agent:saveDef') as ReelApi['agent']['saveDef'],
    deleteDef: inv('agent:deleteDef') as ReelApi['agent']['deleteDef'],
    batch: inv('agent:batch') as ReelApi['agent']['batch'],
    onBatch: on('agent:batch'),
    cancel: inv('agent:cancel') as ReelApi['agent']['cancel'],
    permission: inv('agent:permission') as ReelApi['agent']['permission'],
    review: inv('agent:review') as ReelApi['agent']['review'],
    previewDoc: inv('agent:previewDoc') as ReelApi['agent']['previewDoc'],
    onEvent: on('agent:event'),
  },
} as ReelApi

api.tools = {
  providers: inv('tools:providers') as ReelApi['tools']['providers'],
  add: inv('tools:add') as ReelApi['tools']['add'],
  update: inv('tools:update') as ReelApi['tools']['update'],
  remove: inv('tools:remove') as ReelApi['tools']['remove'],
  refresh: inv('tools:refresh') as ReelApi['tools']['refresh'],
  setEnabled: inv('tools:setEnabled') as ReelApi['tools']['setEnabled'],
  setToolPermission: inv('tools:setToolPermission') as ReelApi['tools']['setToolPermission'],
  setToolCostsMoney: inv('tools:setToolCostsMoney') as ReelApi['tools']['setToolCostsMoney'],
}

api.mcp = {
  info: inv('mcp:info') as ReelApi['mcp']['info'],
  setEnabled: inv('mcp:setEnabled') as ReelApi['mcp']['setEnabled'],
  resetToken: inv('mcp:resetToken') as ReelApi['mcp']['resetToken'],
  connectClaudeCode: inv('mcp:connectClaudeCode') as ReelApi['mcp']['connectClaudeCode'],
  onActivity: on('mcp:activity'),
  reportUiState: (s) => ipcRenderer.send('mcp:ui-state', s),
  onOpenProject: on('mcp:open-project'),
  replyOpenProject: (requestId, ok) => ipcRenderer.send('mcp:open-project:reply', requestId, ok),
  onExport: on('mcp:export'),
  replyExport: (requestId, result) => ipcRenderer.send('mcp:export:reply', requestId, result),
}

contextBridge.exposeInMainWorld('framevane', api)
