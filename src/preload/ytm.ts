// Isolated-world preload of the YouTube Music view. It relays messages between
// the page agent (page world) and main, and shows cashew's synced lyrics in the
// page (ytm-lyrics.ts). No Node or Electron API is exposed to the page beyond
// the two relay functions; main validates everything.
import { contextBridge, ipcRenderer, webFrame } from 'electron';
import lyricsCss from '../shared/lyrics.css?raw';
import { pageAgent } from './page-agent';
import { setupYtmLyrics } from './ytm-lyrics';

const ORIGIN = 'https://music.youtube.com';
type Listener = (command: unknown) => void;
let listener: Listener | null = null;
const pending: unknown[] = [];

function toAgent(command: unknown): void {
  if (listener) listener(command);
  else if (pending.push(command) > 20) pending.shift();
}

if (location.origin === ORIGIN) {
  const report = (message: unknown): void => ipcRenderer.send('ytm:message', message);
  let lyrics: ReturnType<typeof setupYtmLyrics> | null = null;

  contextBridge.exposeInMainWorld('__musicPlayerBridge', {
    emit: (message: unknown) => {
      report(message);
      lyrics?.tap(message);
    },
    onCommand: (callback: Listener) => {
      if (listener || typeof callback !== 'function') return;
      listener = callback;
      for (const command of pending.splice(0)) callback(command);
    },
  });

  ipcRenderer.on('ytm:command', (_event, command: unknown) => toAgent(command));

  const start = (): void => {
    void webFrame.executeJavaScript(`(${pageAgent.toString()})()`).catch(() => undefined);
    // Our styles go in through the frame (not a <style> element): the page's
    // content security policy does not apply to them.
    webFrame.insertCSS(lyricsCss);
    lyrics = setupYtmLyrics({ command: toAgent, report });
    ipcRenderer.on('ytm:lyrics', (_event, state: unknown) => lyrics?.lyrics(state));
    ipcRenderer.on('ytm:lyrics-view', (_event, action: unknown) => lyrics?.immersive(action));
    report({ kind: 'lyrics-host' });
  };
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}
