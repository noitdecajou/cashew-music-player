import { contextBridge, ipcRenderer } from 'electron';
import { SHELL_EVENT_CHANNELS, type ShellApi } from '../shared/ipc';

const api: ShellApi = {
  command: command => ipcRenderer.send('shell:command', command),
  window: action => ipcRenderer.send('shell:window', action),
  setTheme: theme => ipcRenderer.invoke('shell:set-theme', theme),
  drag: phase => ipcRenderer.send('shell:drag', phase),
  nudge: (dx, dy) => ipcRenderer.send('shell:nudge', dx, dy),
  on: (channel, callback) => {
    if (!SHELL_EVENT_CHANNELS.includes(channel)) return () => undefined;
    const handler = (_event: Electron.IpcRendererEvent, value: Parameters<typeof callback>[0]): void => callback(value);
    ipcRenderer.on(channel, handler);
    return () => { ipcRenderer.removeListener(channel, handler); };
  },
};

contextBridge.exposeInMainWorld('player', api);
