import { contextBridge, ipcRenderer } from 'electron';
import { SHELL_EVENT_CHANNELS, type ShellApi } from '../shared/ipc';

const api: ShellApi = {
  command: command => ipcRenderer.send('shell:command', command),
  window: action => ipcRenderer.send('shell:window', action),
  setTheme: theme => ipcRenderer.invoke('shell:set-theme', theme),
  drag: phase => ipcRenderer.send('shell:drag', phase),
  nudge: (dx, dy) => ipcRenderer.send('shell:nudge', dx, dy),
  search: (query, scope) => ipcRenderer.invoke('library:search', query, scope),
  refreshLibrary: () => ipcRenderer.invoke('library:refresh'),
  favorite: (id, favorite) => ipcRenderer.invoke('library:favorite', id, favorite),
  play: target => ipcRenderer.invoke('player:play', target),
  queue: action => ipcRenderer.invoke('player:queue', action),
  resume: () => ipcRenderer.invoke('player:resume'),
  settings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: patch => ipcRenderer.invoke('settings:update', patch),
  captureShortcut: capturing => ipcRenderer.send('settings:capture-shortcut', capturing),
  network: online => ipcRenderer.send('shell:network', online),
  diagnostics: () => ipcRenderer.invoke('app:diagnostics'),
  update: action => ipcRenderer.invoke('app:update', action),
  on: (channel, callback) => {
    if (!SHELL_EVENT_CHANNELS.includes(channel)) return () => undefined;
    const handler = (_event: Electron.IpcRendererEvent, value: Parameters<typeof callback>[0]): void => callback(value);
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  },
};

contextBridge.exposeInMainWorld('player', api);
