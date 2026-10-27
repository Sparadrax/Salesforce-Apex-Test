import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi } from '../shared/contracts/desktop-api';

function onChanged(callback: (orgId: string) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, id: unknown) => {
    if (typeof id === 'string') callback(id);
  };
  ipcRenderer.on('orgs:changed', listener);
  return () => ipcRenderer.removeListener('orgs:changed', listener);
}
const desktop: DesktopApi = {
  history: {
    current: () => ipcRenderer.invoke('history:current'),
    query: (range) => ipcRenderer.invoke('history:query', range),
    onChanged,
  },
  context: () => ipcRenderer.invoke('workspace:context'),
  orgs: {
    chooseImport: () => ipcRenderer.invoke('orgs:choose-list-import'),
    confirmImport: (input) =>
      ipcRenderer.invoke('orgs:confirm-list-import', input),
    discardImport: (token) =>
      ipcRenderer.invoke('orgs:discard-list-import', token),
    remove: (id) => ipcRenderer.invoke('orgs:delete', id),
    list: (afterId, sort) => ipcRenderer.invoke('orgs:list', afterId, sort),
    add: (input) => ipcRenderer.invoke('orgs:add', input),
    open: (id) => ipcRenderer.invoke('orgs:open', id),
    onChanged,
  },
  runs: {
    openHistory: (apexClass) =>
      ipcRenderer.invoke('runs:open-history', apexClass),
    coveringTests: (runId, apexClass, afterId, sort) =>
      ipcRenderer.invoke(
        'runs:covering-tests',
        runId,
        apexClass,
        afterId,
        sort,
      ),
    methods: (runId, apexClass, testClass, afterName, sort) =>
      ipcRenderer.invoke(
        'runs:methods',
        runId,
        apexClass,
        testClass,
        afterName,
        sort,
      ),
    current: () => ipcRenderer.invoke('runs:current'),
    list: (cursor) => ipcRenderer.invoke('runs:list', cursor),
    tests: (runId, afterIndex) =>
      ipcRenderer.invoke('runs:tests', runId, afterIndex),
    coverage: (runId, afterId, sort) =>
      ipcRenderer.invoke('runs:coverage', runId, afterId, sort),
    chooseImport: () => ipcRenderer.invoke('orgs:choose-import'),
    confirmImport: (token) => ipcRenderer.invoke('orgs:confirm-import', token),
    discardImport: (token) => ipcRenderer.invoke('orgs:discard-import', token),
    onChanged,
  },
  database: {
    status: () => ipcRenderer.invoke('database:status'),
    get: (collection, key) =>
      ipcRenderer.invoke('database:get', collection, key),
    putBatch: (collection, records) =>
      ipcRenderer.invoke('database:put-batch', collection, records),
    list: (request) => ipcRenderer.invoke('database:list', request),
    delete: (collection, key) =>
      ipcRenderer.invoke('database:delete', collection, key),
  },
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
};
contextBridge.exposeInMainWorld('desktop', desktop);
