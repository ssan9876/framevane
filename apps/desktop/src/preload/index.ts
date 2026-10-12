import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { ReelApi } from '../shared/api'

/** window.reel: the only door from the renderer to the main process. Every call is a typed invoke. */

const on = <T>(channel: string) => (cb: (e: T) => void) => {
  const fn = (_: unknown, e: T) => cb(e)
  ipcRenderer.on(channel, fn)
  return () => { ipcRenderer.removeListener(channel, fn) }
}
const inv = (channel: string) => (...args: unknown[]) => ipcRenderer.invoke(channel, ...args)

const api: ReelApi = {
  app: {
    info: inv('app:info') as ReelApi['app']['info'],
    pickFiles: inv('app:pickFiles') as ReelApi['app']['pickFiles'],
    pickSavePath: inv('app:pickSavePath') as ReelApi['app']['pickSavePath'],
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
    onChange: on('media:change'),
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
    cancel: inv('agent:cancel') as ReelApi['agent']['cancel'],
    permission: inv('agent:permission') as ReelApi['agent']['permission'],
    review: inv('agent:review') as ReelApi['agent']['review'],
    previewDoc: inv('agent:previewDoc') as ReelApi['agent']['previewDoc'],
    onEvent: on('agent:event'),
  },
}

contextBridge.exposeInMainWorld('reel', api)
