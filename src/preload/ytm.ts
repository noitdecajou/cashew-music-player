// Isolated-world preload of the YouTube Music view. It only relays messages:
// the page agent (page world) <-> main process. No Node or Electron API is
// exposed to the page beyond these two functions; main validates everything.
import { contextBridge, ipcRenderer, webFrame } from 'electron';
import { pageAgent } from './page-agent';

const ORIGIN = 'https://music.youtube.com';
type Listener = (command: unknown) => void;
let listener: Listener | null = null;
const pending: unknown[] = [];

if (location.origin === ORIGIN) {
  contextBridge.exposeInMainWorld('__musicPlayerBridge', {
    emit: (message: unknown) => ipcRenderer.send('ytm:message', message),
    onCommand: (callback: Listener) => {
      if (listener || typeof callback !== 'function') return;
      listener = callback;
      for (const command of pending.splice(0)) callback(command);
    },
  });

  ipcRenderer.on('ytm:command', (_event, command: unknown) => {
    if (listener) listener(command);
    else if (pending.push(command) > 20) pending.shift();
  });

  const inject = (): void => {
    void webFrame.executeJavaScript(`(${pageAgent.toString()})()`).catch(() => undefined);
  };
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', inject, { once: true });
  else inject();
}
