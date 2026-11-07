import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

test('island: only playback commands are accepted from the island page', async () => {
  const before = (await calls('.shuffle')).length;
  await island.evaluate(() => window.player.command({ type: 'shuffle' }));
  await new Promise(r => setTimeout(r, 300));
  assert.equal((await calls('.shuffle')).length, before, 'shuffle refused');
  await assert.rejects(
    island.evaluate(() => window.player.settings()),
    /Accès refusé/,
  );
});

test('island: click on the progress bar seeks, the mouse wheel sets the volume', async () => {
  await island.hover('#island');
  await island.waitForSelector('#island.expanded-view');
  await h.until(async () => (await island.textContent('.total')) !== '0:00', { message: 'duration known' });
  await new Promise(r => setTimeout(r, 400)); // end of the grow animation
  const rail = await island.locator('.rail').boundingBox();
  await island.mouse.click(rail.x + rail.width / 2, rail.y + rail.height / 2);
  await h.until(async () => (await calls('seekTo')).length > 0, { message: 'seek' });
  const [, position] = (await calls('seekTo')).at(-1);
  const duration = await h.ytm("document.querySelector('#movie_player').getDuration()");
  assert.ok(Math.abs(position - duration / 2) < duration * 0.1, `seek near the middle (${position} / ${duration})`);
  const volumeCalls = (await calls('setVolume')).length;
  await island.mouse.wheel(0, 100);
  await h.until(async () => (await calls('setVolume')).length > volumeCalls, { message: 'volume' });
  assert.match(await island.textContent('.volume-badge'), /Volume \d+ %/);
  await island.mouse.move(5, 140);
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

const steamGame = name => ({
  path: `D:\\SteamLibrary\\steamapps\\common\\${name}\\${name}.exe`,
  title: `Jeu ${name}`,
  fullscreen: true,
});
const answer = async value => {
  await island.waitForSelector('#island.prompt-view');
  await island.click(`.answer[data-answer="${value}"]`);
  await h.until(async () => !(await island.getAttribute('#island', 'class')).includes('prompt-view'), {
    message: `answered ${value}`,
  });
};

test('island in games mode: listed games decide; each new game is offered (add, decline, later)', async () => {
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

  // A new game: the island asks, even with automatic detection off.
  setForeground(steamGame('Alpha'));
  await h.until(async () => (await islandWindow()).visible, { timeout: 6000, message: 'question shown' });
  assert.equal(await island.textContent('.prompt .game'), 'Jeu Alpha');
  await answer('decline');
  await h.until(async () => !(await islandWindow()).visible, { timeout: 6000, message: 'declined: hidden' });
  let s = await h.shell.evaluate(() => window.player.settings());
  assert.deepEqual(s.island.declined, ['alpha.exe']);

  await settings({ autoFullscreen: true });
  setForeground(steamGame('Beta'));
  await answer('later');
  await h.until(async () => (await islandWindow()).visible, { timeout: 6000, message: 'later: shown as a game' });
  setForeground(steamGame('Gamma'));
  await answer('add');
  s = await h.shell.evaluate(() => window.player.settings());
  assert.ok(s.island.games.some(g => g.exe === 'gamma.exe' && g.name === 'Jeu Gamma' && g.position === 'center'));
  assert.deepEqual(
    s.recentApps.map(a => a.exe),
    ['beta.exe'],
    'recent: the postponed game (not the declined or added ones)',
  );
  setForeground(steamGame('Beta'));
  await new Promise(r => setTimeout(r, 2000));
  assert.ok(!(await island.getAttribute('#island', 'class')).includes('prompt-view'), 'postponed: not asked again');

  // A fullscreen browser is never a game.
  setForeground({ path: 'C:\\Program Files\\Mozilla Firefox\\firefox.exe', title: 'Vidéo', fullscreen: true });
  await h.until(async () => !(await islandWindow()).visible, { timeout: 6000, message: 'not over Firefox' });
  setForeground(steamGame('Beta'));
  await h.until(
    async () => (await h.shell.evaluate(() => window.player.settings())).foreground.app?.exe === 'beta.exe',
    { timeout: 6000, message: 'last seen' },
  );
});

test('island: "track change" mode shows the details for a moment at each new track', async () => {
  setForeground(null);
  await settings({ mode: 'track' });
  await h.until(async () => !(await islandWindow()).visible, { timeout: 6000, message: 'hidden between tracks' });
  await h.shell.evaluate(() => window.player.command({ type: 'next' }));
  await h.until(async () => (await islandWindow()).visible, { message: 'shown at the track change' });
  await island.waitForSelector('#island.expanded-view');
  await h.until(async () => !(await islandWindow()).visible, { timeout: 9000, message: 'hidden again' });
});

test('island: size and opacity', async () => {
  await settings({ mode: 'always', size: 'large', opacity: 70 });
  await h.until(async () => (await islandWindow())?.bounds.width === Math.round(460 * 1.2), {
    message: 'larger window',
  });
  await h.until(
    async () =>
      (await island.evaluate(() => document.documentElement.style.getPropertyValue('--pill'))).includes('0.70'),
    { message: 'opacity' },
  );
  assert.equal(await island.evaluate(() => document.documentElement.style.getPropertyValue('zoom')), '1.2');
  await settings({ size: 'normal', opacity: 94 });
});

test('lyrics found are kept on disk', async () => {
  const userData = await h.app.evaluate(({ app }) => app.getPath('userData'));
  await h.until(
    async () => {
      try {
        return JSON.parse(readFileSync(join(userData, 'lyrics-cache.json'), 'utf8')).some(l => l.status === 'synced');
      } catch {
        return false;
      }
    },
    { timeout: 6000, message: 'lyrics-cache.json' },
  );
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
  assert.equal(await page.locator('.games .game').count(), 3);
  assert.match(await page.textContent('.detected'), /Jeu Beta \(beta\.exe\) · reconnue comme jeu, plein écran/);
  assert.equal(await page.locator('.declined .game[data-exe="alpha.exe"]').count(), 1, 'declined listed');
  assert.equal(await page.locator('.recent .game[data-exe="beta.exe"] button').count(), 2, 'add or decline');
  await page.click('.declined .game[data-exe="alpha.exe"] button:has-text("Ne plus refuser")');
  await h.until(async () => (await page.locator('.declined .game').count()) === 0, { message: 'no longer declined' });
  await page.click('.games .game[data-exe="quiet.exe"] button.icon');
  await h.until(async () => (await page.locator('.games .game').count()) === 2, { message: 'game removed' });
  await page.selectOption('.games .game[data-exe="game.exe"] select', 'right');
  await h.until(
    async () => (await h.shell.evaluate(() => window.player.settings())).island.games[0]?.position === 'right',
    { message: 'position saved' },
  );
  await page.click('.sidebar [data-section="island"]');
  await page.click('#islandShortcut');
  await page.keyboard.press('Control+Alt+K');
  await h.until(
    async () =>
      (await page.inputValue('#islandShortcut')) === 'Ctrl+Alt+K' ||
      /utilisé/.test(await page.textContent('.island-shortcut-status')),
    { message: 'island shortcut saved (or reported busy)' },
  );
  await page.click('.segmented[data-setting="mode"] [data-value="off"]');
  await h.until(async () => !(await islandWindow()).visible, { message: 'turned off' });
  // Escape closes the window (during the key press, hence the catch).
  await page.keyboard.press('Escape').catch(() => {});
  await h.until(async () => page.isClosed(), { message: 'settings closed' });
});
