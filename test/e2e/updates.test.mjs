import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { launch } from './harness.mjs';

let h;
before(async () => { h = await launch({ env: { MP_FAKE_UPDATER: '1' } }); });
after(async () => { await h?.close(); });

test('updates: check, download with progress, restart to install; pin icon fills', async () => {
  await h.shell.evaluate(() => window.player.window('toggle-settings'));
  const drawer = await h.drawer();
  await drawer.waitForSelector('section[data-panel="settings"]:not([hidden])');
  await h.until(async () => (await drawer.textContent('#updateAction')) === 'Rechercher', { message: 'idle' });
  await drawer.click('#updateAction');
  await h.until(async () => /9\.9\.9 est disponible/.test(await drawer.textContent('.update-status')), { message: 'available' });
  assert.equal(await drawer.textContent('#updateAction'), 'Télécharger et installer');
  assert.match(await h.shell.textContent('#toolbar .notice'), /Mise à jour 9\.9\.9 disponible/);
  await drawer.click('#updateAction');
  await h.until(async () => (await drawer.textContent('#updateAction')) === 'Redémarrer et installer', { message: 'downloaded' });
  await drawer.click('#updateAction');
  await h.until(() => h.app.evaluate(() => globalThis.__fakeInstalled === true), { message: 'install requested' });

  // Pinned: the pin icon is the filled one.
  await h.shell.evaluate(() => window.player.window('pin'));
  await h.until(async () => (await h.shell.getAttribute('#toolbar .pin use', 'href')) === '#i-pin-on', { message: 'filled pin' });
  await h.shell.evaluate(() => window.player.window('pin'));
  await h.until(async () => (await h.shell.getAttribute('#toolbar .pin use', 'href')) === '#i-pin', { message: 'outline pin' });
});

test('repair display: back to the large player with its title bar, page reloaded, logged', async () => {
  await h.shell.evaluate(() => window.player.window('close-panel'));
  await h.shell.evaluate(() => window.player.window('toggle-mini'));
  await h.shell.waitForSelector('body.mini');
  await h.shell.keyboard.press('Control+Shift+B');
  await h.shell.waitForSelector('body.seamless');
  await h.shell.evaluate(() => { window.__beforeRepair = true; window.player.window('repair-display'); });
  await h.until(async () => (await h.shell.evaluate(() => window.__beforeRepair !== true).catch(() => false)), { message: 'page reloaded' });
  await h.shell.waitForSelector('body.large:not(.booting):not(.seamless)');
  const userData = await h.app.evaluate(({ app }) => app.getPath('userData'));
  const logText = readFileSync(join(userData, 'logs', 'main.log'), 'utf8');
  assert.match(logText, /start \d+\.\d+\.\d+/);
  assert.match(logText, /repair display requested/);
});
