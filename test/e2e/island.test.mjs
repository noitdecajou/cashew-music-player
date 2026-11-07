import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { launch, newProfile } from './harness.mjs';

// The island: a pill at the top of the screen, lyrics from LRCLIB (a local
// fixture here), shown always or only over games (the foreground application
// is read from a file here: on Windows it comes from the system).
const dir = mkdtempSync(join(tmpdir(), 'mp-island-'));
const lyricsFile = join(dir, 'lyrics.json');
const foregroundFile = join(dir, 'foreground.json');
writeFileSync(
  lyricsFile,
  JSON.stringify({ 'Premier titre': '[00:00.20] Première ligne chantée\n[00:01.50] Deuxième ligne\n[09:00.00] Fin' }),
);
const setForeground = value => writeFileSync(foregroundFile, JSON.stringify(value ?? {}));
setForeground(null);

const profile = newProfile();
let h;
let island;
const settings = patch => h.shell.evaluate(p => window.player.updateSettings({ island: p }), patch);
const islandWindow = () =>
  h.app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find(win => win.getTitle() === 'cashew island');
    return w
      ? { bounds: w.getBounds(), visible: w.isVisible(), top: w.isAlwaysOnTop(), focusable: w.isFocusable() }
      : null;
  });
const screenBounds = () => h.app.evaluate(({ screen }) => screen.getPrimaryDisplay().bounds);
const calls = async type => (await h.ytm('__fake.calls')).filter(c => c[0] === type || c[1] === type);

before(async () => {
  h = await launch({
    userData: profile,
    env: { MP_LYRICS_FIXTURE: lyricsFile, MP_FAKE_FOREGROUND: foregroundFile },
  });
  await h.ytm('__fake.start(0)');
  await h.until(async () => (await h.shell.textContent('#toolbar .title')) === 'Premier titre', { message: 'playing' });
});
after(async () => {
  await h?.close();
  rmSync(profile, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
});

test('island: off by default, no window and no lyrics request', async () => {
  const s = await h.shell.evaluate(() => window.player.settings());
  assert.equal(s.island.mode, 'off');
  assert.equal(await islandWindow(), null);
});

test('island: always, at the top center, never focusable, synced lyric line', async () => {
  await settings({ mode: 'always' });
  island = await h.island();
  await island.waitForSelector('#island:not([hidden])');
  const w = await h.until(async () => (await islandWindow())?.visible && (await islandWindow()), { message: 'shown' });
  const screen = await screenBounds();
  assert.equal(w.bounds.y, screen.y, 'hangs from the top edge');
  assert.equal(w.bounds.x, screen.x + Math.round((screen.width - w.bounds.width) / 2), 'centered');
  assert.equal(w.top, true);
  assert.equal(w.focusable, false);
  await h.until(async () => /ligne/.test(await island.textContent('.line .text')), { message: 'lyric line' });
  assert.equal(await island.getAttribute('#island', 'class').then(c => /lyric/.test(c)), true);
});

test('island: hover shows title, artist, up next; play/pause and next work', async () => {
  await island.hover('#island');
  await island.waitForSelector('#island.expanded-view');
  assert.equal(await island.textContent('.expanded .title'), 'Premier titre');
  assert.match(await island.textContent('.expanded .artist'), /Artiste Un/);
  assert.match(await island.textContent('.upnext'), /Ensuite · Deuxième titre/);
  await island.click('.expanded .play');
  await h.until(async () => (await calls('#play-pause-button')).length > 0, { message: 'play/pause' });
  await island.click('.expanded .next');
  await h.until(async () => (await h.ytm('__fake.index')) === 1, { message: 'next track' });
  await island.mouse.move(5, 140);
  await h.until(async () => !(await island.getAttribute('#island', 'class')).includes('expanded-view'), {
    message: 'collapsed',
  });
  // Without lyrics, the compact line is "title — artist".
  await h.until(async () => (await island.textContent('.line .text')) === 'Deuxième titre — Artiste Deux', {
    message: 'title line',
  });
});

test('island: only play/pause and next/previous are accepted from the island page', async () => {
  const before = (await calls('seekTo')).length;
  await island.evaluate(() => window.player.command({ type: 'seek', trackId: 'BBBBBBBBBBB', position: 30 }));
  await new Promise(r => setTimeout(r, 300));
  assert.equal((await calls('seekTo')).length, before, 'seek refused');
  assert.equal(await island.evaluate(() => typeof window.player.updateSettings), 'function');
  await assert.rejects(
    island.evaluate(() => window.player.settings()),
    /Accès refusé/,
  );
});

test('island: position, clock and lyrics option follow the settings', async () => {
  await settings({ position: 'right', clock: 'left', lyrics: false });
  const screen = await screenBounds();
  await h.until(async () => (await islandWindow()).bounds.x === screen.x + screen.width - 460 - 16, {
    message: 'right edge',
  });
  await island.waitForSelector('body.pos-right');
  await island.waitForSelector('.clock-left:not([hidden])');
  assert.match(await island.textContent('.clock-left'), /^\d{2}:\d{2}$/);
  await h.ytm('__fake.start(0)');
  await h.until(async () => (await island.textContent('.line .text')) === 'Premier titre — Artiste Un', {
    message: 'lyrics off: title line',
  });
  await settings({ position: 'center', clock: 'none', lyrics: true });
});

test('island in games mode: listed games decide, other fullscreen apps when detection is on', async () => {
  await settings({
    mode: 'games',
    autoFullscreen: false,
    games: [
      { exe: 'game.exe', name: 'Game', enabled: true, position: 'left' },
      { exe: 'quiet.exe', name: 'Quiet', enabled: false, position: 'center' },
    ],
  });
  await h.until(async () => !(await islandWindow()).visible, { message: 'hidden outside games' });
  setForeground({ exe: 'C:\\Games\\Game.exe', title: 'Game', fullscreen: false });
  await h.until(async () => (await islandWindow()).visible, { timeout: 6000, message: 'shown over the game' });
  const screen = await screenBounds();
  assert.equal((await islandWindow()).bounds.x, screen.x + 16, 'position of the game');
  setForeground({ exe: 'quiet.exe', title: 'Quiet', fullscreen: true });
  await h.until(async () => !(await islandWindow()).visible, { timeout: 6000, message: 'disabled game' });
  setForeground({ exe: 'other.exe', title: 'Other game', fullscreen: true });
  await new Promise(r => setTimeout(r, 2000));
  assert.equal((await islandWindow()).visible, false, 'automatic detection off');
  await settings({ autoFullscreen: true });
  await h.until(async () => (await islandWindow()).visible, { timeout: 6000, message: 'any fullscreen app' });
  const s = await h.shell.evaluate(() => window.player.settings());
  assert.deepEqual(
    s.recentApps.map(a => a.exe),
    ['other.exe'],
    'recently seen fullscreen apps, minus listed games',
  );
  setForeground(null);
  await h.until(async () => !(await islandWindow()).visible, { timeout: 6000, message: 'back to the desktop' });
  assert.equal((await h.shell.evaluate(() => window.player.settings())).foreground.app.exe, 'other.exe', 'last seen');
});

test('settings window: island and games sections drive the island', async () => {
  const page = await h.settings('island');
  await page.click('.segmented[data-setting="mode"] [data-value="always"]');
  await h.until(async () => (await islandWindow()).visible, { message: 'shown from the settings' });
  assert.equal(
    await page.getAttribute('.segmented[data-setting="mode"] [data-value="always"]', 'aria-checked'),
    'true',
  );
  await page.click('.sidebar [data-section="games"]');
  assert.equal(await page.locator('.games .game').count(), 2);
  assert.match(await page.textContent('.detected'), /Other game \(other\.exe\) · plein écran détecté/);
  await page.click('.games .game[data-exe="quiet.exe"] button.icon');
  await h.until(async () => (await page.locator('.games .game').count()) === 1, { message: 'game removed' });
  await page.selectOption('.games .game[data-exe="game.exe"] select', 'right');
  await h.until(
    async () => (await h.shell.evaluate(() => window.player.settings())).island.games[0]?.position === 'right',
    { message: 'position saved' },
  );
  await page.click('.sidebar [data-section="island"]');
  await page.click('.segmented[data-setting="mode"] [data-value="off"]');
  await h.until(async () => !(await islandWindow()).visible, { message: 'turned off' });
  // Escape closes the window (during the key press, hence the catch).
  await page.keyboard.press('Escape').catch(() => {});
  await h.until(async () => page.isClosed(), { message: 'settings closed' });
});
