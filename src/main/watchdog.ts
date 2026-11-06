import type { WebContents } from 'electron';
import { log } from './services/log';

const CHECK_AFTER_MS = 6000;

/**
 * Our pages stay hidden (body.booting) until they receive their first UI state.
 * If a page is still hidden a few seconds after loading, or its renderer
 * crashed, send the state again, then reload the page once.
 */
export function watchPage(name: string, contents: WebContents, resend: () => void): void {
  let reloads = 0;
  let timer: NodeJS.Timeout | null = null;

  contents.on('did-finish-load', () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void check(), CHECK_AFTER_MS);
  });
  contents.on('render-process-gone', (_event, details) => {
    log(`${name}: renderer gone`, details);
    if (!contents.isDestroyed() && reloads++ < 3) contents.reload();
  });
  contents.on('unresponsive', () => log(`${name}: unresponsive`));
  contents.on('preload-error', (_event, path, error) => log(`${name}: preload error`, path, error));
  contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => { if (isMainFrame) log(`${name}: load failed`, code, description, url); });
  contents.on('console-message', event => {
    if (event.level === 'error' || event.level === 'warning') log(`${name}: console ${event.level}`, event.message, `${event.sourceId}:${event.lineNumber}`);
  });

  async function check(): Promise<void> {
    if (contents.isDestroyed()) return;
    let booting = false;
    try { booting = await contents.executeJavaScript("document.body?.classList.contains('booting') === true"); }
    catch (error) { log(`${name}: page check failed`, error); return; }
    if (!booting) return;
    log(`${name}: still waiting for its first state, sending it again`);
    resend();
    setTimeout(async () => {
      if (contents.isDestroyed()) return;
      const still = await contents.executeJavaScript("document.body?.classList.contains('booting') === true").catch(() => true);
      if (still && reloads++ < 3) { log(`${name}: still hidden, reloading`); contents.reloadIgnoringCache(); }
    }, 3000);
  }
}
