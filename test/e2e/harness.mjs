import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '../..');
const playwright = require('playwright');

export const newProfile = () => mkdtempSync(join(tmpdir(), 'mp-e2e-'));

/** Launches the built app against the fake YouTube Music page. Pass `userData` to reuse a profile (kept on close). */
export async function launch({ userData: profile, env = {}, args = [] } = {}) {
  const userData = profile ?? newProfile();
  const app = await playwright._electron.launch({
    executablePath: require('electron'),
    // Root (containers) and CI runners cannot use Chromium's Linux sandbox.
    args: [...(process.getuid?.() === 0 || process.env.CI ? ['--no-sandbox'] : []), ...args, root],
    cwd: root,
    env: { ...process.env, MP_USER_DATA: userData, MP_YTM_FIXTURE: join(root, 'test/fixtures/ytm.html'), ...env },
  });
  // Record every message the page agent sends to main, in order.
  await app.evaluate(({ ipcMain }) => {
    globalThis.__agentLog = [];
    ipcMain.on('ytm:message', (_event, message) => globalThis.__agentLog.push(message));
  });
  // WebContentsViews are listed as windows too: pick our shell explicitly.
  const isShell = page => page.url().includes('/renderer/index.html') && !page.url().includes('view=drawer');
  const shell = app.windows().find(isShell) ?? (await app.waitForEvent('window', { predicate: isShell }));
  await shell.waitForSelector('body:not(.booting)');
  const ytm = async code =>
    app.evaluate(async ({ webContents }, source) => {
      const music = webContents.getAllWebContents().find(wc => wc.getURL().startsWith('https://music.youtube.com'));
      return music.executeJavaScript(source);
    }, code);
  const log = () => app.evaluate(() => globalThis.__agentLog);
  // The player window (the settings and the island are windows too).
  const contentSize = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find(w => w.webContents.getURL().includes('/renderer/index.html'))
        .getContentSize(),
    );
  const until = async (fn, { timeout = 5000, message = 'condition' } = {}) => {
    const end = Date.now() + timeout;
    let last;
    while (Date.now() < end) {
      last = await fn();
      if (last) return last;
      await new Promise(r => setTimeout(r, 50));
    }
    throw new Error(`timeout waiting for ${message} (last: ${JSON.stringify(last)})`);
  };
  const viewBounds = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find(w => w.webContents.getURL().includes('/renderer/index.html'))
        .contentView.children.map(v => ({
          url: v.webContents.getURL(),
          bounds: v.getBounds(),
        })),
    );
  const drawer = async () =>
    app.windows().find(page => page.url().includes('view=drawer')) ??
    app.waitForEvent('window', { predicate: page => page.url().includes('view=drawer') });
  const page = async name =>
    app.windows().find(p => p.url().includes(`/renderer/${name}.html`)) ??
    app.waitForEvent('window', { predicate: p => p.url().includes(`/renderer/${name}.html`), timeout: 10000 });
  /** Opens the settings window at a section and returns its page. */
  const settings = async section => {
    await shell.evaluate(() => window.player.window('toggle-settings'));
    const settingsPage = await page('settings');
    await settingsPage.waitForSelector('body:not(.booting)');
    if (section) await settingsPage.click(`.sidebar [data-section="${section}"]`);
    return settingsPage;
  };
  const island = () => page('island');
  const close = async () => {
    await app.close().catch(() => {});
    if (!profile) rmSync(userData, { recursive: true, force: true });
  };
  // Wait for the agent to be up in the fixture page.
  await until(
    async () => {
      try {
        return await ytm('window.__musicPlayerAgentInstalled === true');
      } catch {
        return false;
      }
    },
    { timeout: 15000, message: 'agent installed' },
  );
  return { app, shell, ytm, log, contentSize, viewBounds, drawer, settings, island, until, close };
}
