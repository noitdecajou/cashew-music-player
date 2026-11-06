import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { launch } from './harness.mjs';

let h;
before(async () => { h = await launch(); });
after(async () => { await h?.close(); });

const visible = selector => h.shell.isVisible(selector);
const color = selector => h.shell.evaluate(s => getComputedStyle(document.querySelector(s)).color, selector);

test('A · title bar and window title carry the brand', async () => {
  assert.equal(await h.shell.title(), 'cashew');
  assert.equal(await h.shell.textContent('#titlebar .wordmark'), 'cashew');
  assert.equal(await h.shell.getAttribute('#titlebar .glyph use', 'href'), '#i-cashew');
  assert.equal(await color('#titlebar .glyph'), 'rgb(227, 181, 122)'); // --cashew-500
  assert.equal(await h.shell.evaluate(() => getComputedStyle(document.querySelector('#toolbar .primary')).backgroundColor), 'rgb(240, 221, 191)'); // --cashew-100
  assert.ok(await h.shell.evaluate(() => !!document.querySelector('#sprite #i-cashew path')), 'glyph symbols installed');
});

test('A · the "Actuel" grip is the glyph and still moves the window', async () => {
  await h.shell.evaluate(() => window.player.window('toggle-mini'));
  await h.shell.waitForSelector('body.mini');
  assert.ok(await visible('#mini .grip .grip-glyph'), 'glyph shown');
  assert.ok(!(await visible('#mini .grip .grip-dots')), 'dots hidden');
  const accent = await h.shell.evaluate(() => getComputedStyle(document.body).getPropertyValue('--accent').trim());
  assert.equal(accent, '#c9b9ff');
  assert.equal(await color('#mini .grip .grip-glyph'), 'rgb(201, 185, 255)', 'glyph takes the skin accent');
  // Pointer: the glyph starts, moves and ends a drag (main reads the OS cursor).
  await h.app.evaluate(({ ipcMain }) => { globalThis.__drag = []; ipcMain.on('shell:drag', (_e, phase) => globalThis.__drag.push(phase)); });
  const box = await h.shell.locator('#mini .grip').boundingBox();
  await h.shell.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await h.shell.mouse.down();
  await h.shell.mouse.move(box.x - 30, box.y - 20, { steps: 4 });
  await h.shell.mouse.up();
  const phases = await h.until(async () => { const p = await h.app.evaluate(() => globalThis.__drag); return p.at(-1) === 'end' ? p : null; }, { message: 'drag phases' });
  assert.equal(phases[0], 'start');
  assert.ok(phases.includes('move'));
  // Keyboard on the same handle moves the window by 10 px.
  const position = () => h.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getPosition());
  const [x0, y0] = await position();
  await h.shell.focus('#mini .grip');
  await h.shell.keyboard.press('ArrowRight');
  await h.until(async () => (await position())[0] === Math.min(x0 + 10, 1920 - 420) || (await position())[0] !== x0, { message: 'moved by keyboard' });
  assert.equal((await position())[1], y0);
});

test('B · skins: CASHEW label, glyph in the skin accent, grip still a drag handle', async () => {
  // Nothing playing yet in this app: the Autoradio screen shows "cashew" at rest.
  await h.shell.evaluate(() => window.player.setTheme('autoradio'));
  await h.until(async () => (await h.shell.textContent('#mini .title')) === 'cashew', { message: 'LCD idle wordmark' });
  assert.equal((await h.shell.textContent('#mini .brand-label')).trim(), 'CASHEW');
  assert.ok(await visible('#mini .grip .grip-outline'), 'outline glyph in place of the dots');
  assert.equal(await color('#mini .grip .grip-outline'), 'rgb(74, 168, 255)', 'Autoradio blue');
  await h.app.evaluate(() => { globalThis.__drag = []; });
  const box = await h.shell.locator('#mini .grip').boundingBox();
  await h.shell.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await h.shell.mouse.down();
  await h.shell.mouse.move(box.x + 40, box.y + 30, { steps: 3 });
  await h.shell.mouse.up();
  await h.until(async () => (await h.app.evaluate(() => globalThis.__drag)).at(-1) === 'end', { message: 'Autoradio grip drags' });

  await h.shell.evaluate(() => window.player.setTheme('hifi-hf'));
  await h.until(async () => (await h.shell.textContent('#mini .title')) !== 'cashew', { message: 'regular idle text outside Autoradio' });
  assert.ok(await visible('#mini .led'), 'glyph in place of the LED');
  assert.equal(await color('#mini .led'), 'rgb(255, 138, 42)', 'same orange as the LED');
  assert.ok(await visible('#mini .grip .grip-dots'), 'Hi-fi grip unchanged');

  // C · empty cover: the glyph in the muted tones of the skin.
  const cover = await h.shell.getAttribute('#mini img.cover', 'src');
  assert.match(cover, /^data:image\/svg\+xml/);
  assert.match(decodeURIComponent(cover), /#7d5a32/, 'Hi-fi muted orange');

  // A track replaces the idle wordmark on the Autoradio screen.
  await h.shell.evaluate(() => window.player.setTheme('autoradio-hf'));
  await h.ytm('__fake.start(0)');
  await h.until(async () => (await h.shell.textContent('#mini .title')) === 'Premier titre', { message: 'track title' });
});

test('C · settings footer: glyph, wordmark and the app version', async () => {
  await h.shell.evaluate(() => window.player.window('toggle-settings'));
  const drawer = await h.drawer();
  await drawer.waitForSelector('section[data-panel="settings"]:not([hidden])');
  const version = await h.app.evaluate(({ app }) => app.getVersion());
  await h.until(async () => (await drawer.textContent('.about .version')) === `version ${version}`, { message: 'version from the app' });
  assert.equal(await drawer.textContent('.about .wordmark'), 'cashew');
  assert.equal(await drawer.getAttribute('.about .glyph use', 'href'), '#i-cashew');
  await drawer.keyboard.press('Escape');
});
