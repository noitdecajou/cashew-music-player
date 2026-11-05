import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '../..');
const playwright = require('playwright');

export async function launch() {
  const userData = mkdtempSync(join(tmpdir(), 'mp-e2e-'));
  const app = await playwright._electron.launch({
    executablePath: require('electron'),
    args: [...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), root],
    cwd: root,
    env: { ...process.env, MP_USER_DATA: userData, MP_YTM_FIXTURE: join(root, 'test/fixtures/ytm.html') },
  });
  // Record every message the page agent sends to main, in order.
  await app.evaluate(({ ipcMain }) => {
    globalThis.__agentLog = [];
    ipcMain.on('ytm:message', (_event, message) => globalThis.__agentLog.push(message));
  });
  // WebContentsViews are listed as windows too: pick our shell explicitly.
  const isShell = page => page.url().includes('/renderer/index.html');
  const shell = app.windows().find(isShell) ?? await app.waitForEvent('window', { predicate: isShell });
  await shell.waitForSelector('body:not(.booting)');
  const ytm = async (code) => app.evaluate(async ({ webContents }, source) => {
    const music = webContents.getAllWebContents().find(wc => wc.getURL().startsWith('https://music.youtube.com'));
    return music.executeJavaScript(source);
  }, code);
  const log = () => app.evaluate(() => globalThis.__agentLog);
  const contentSize = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getContentSize());
  const until = async (fn, { timeout = 5000, message = 'condition' } = {}) => {
    const end = Date.now() + timeout;
    let last;
    while (Date.now() < end) { last = await fn(); if (last) return last; await new Promise(r => setTimeout(r, 50)); }
    throw new Error(`timeout waiting for ${message} (last: ${JSON.stringify(last)})`);
  };
  const close = async () => { await app.close().catch(() => {}); rmSync(userData, { recursive: true, force: true }); };
  // Wait for the agent to be up in the fixture page.
  await until(async () => {
    try { return await ytm('window.__musicPlayerAgentInstalled === true'); } catch { return false; }
  }, { timeout: 15000, message: 'agent installed' });
  return { app, shell, ytm, log, contentSize, until, close };
}
