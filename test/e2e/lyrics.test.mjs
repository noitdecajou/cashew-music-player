import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { launch, newProfile } from './harness.mjs';

// The lyrics view of the player: side panel and immersive mode. Synced lyrics
// from LRCLIB (a local fixture here), YouTube Music's own lyrics otherwise.
const dir = mkdtempSync(join(tmpdir(), 'mp-lyrics-'));
const lyricsFile = join(dir, 'lyrics.json');
writeFileSync(
  lyricsFile,
  JSON.stringify({
    'Premier titre':
      '[00:00.20] Première ligne\n[00:01.20] Deuxième ligne\n[00:02.20] \n[00:12.00] Après la pause\n[09:00.00] Fin',
  }),
);
const profile = newProfile();
let h;
let drawer;
const calls = async type => (await h.ytm('__fake.calls')).filter(c => c[0] === type || c[1] === type);
const drawerBounds = async () => (await h.viewBounds()).find(v => v.url.includes('view=drawer')).bounds;

before(async () => {
  h = await launch({ userData: profile, env: { MP_LYRICS_FIXTURE: lyricsFile } });
  await h.ytm('__fake.start(0)');
  await h.until(async () => (await h.shell.textContent('#toolbar .title')) === 'Premier titre', { message: 'playing' });
});
after(async () => {
  await h?.close();
  rmSync(profile, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
});

test('lyrics panel: synced lines from the toolbar, the sung line is active, an interlude shows dots', async () => {
  await h.shell.click('#toolbar [data-window="toggle-lyrics"]');
  drawer = await h.drawer();
  await drawer.waitForSelector('.lyrics-view:not([hidden]) .lyric');
  assert.equal(await drawer.textContent('.lyrics-title'), 'Premier titre');
  assert.equal(await drawer.textContent('.lyrics-source'), 'Paroles : LRCLIB');
  await h.shell.evaluate(() => window.player.command({ type: 'seek', trackId: 'AAAAAAAAAAA', position: 0.5 }));
  await h.until(async () => /ligne/.test((await drawer.textContent('.lyric.active')) ?? ''), { message: 'active' });
  assert.equal(await drawer.locator('.lyric.interlude').count(), 1, 'instrumental break between 2 s and 12 s');
  assert.equal((await drawerBounds()).width, 380, 'side panel');
});

test('lyrics panel: follows the song without animation frames (Windows may hold them back)', async () => {
  await drawer.evaluate(() => {
    window.__raf = window.requestAnimationFrame;
    window.requestAnimationFrame = () => 0;
  });
  await h.shell.evaluate(() => window.player.command({ type: 'seek', trackId: 'AAAAAAAAAAA', position: 12.5 }));
  await h.until(async () => (await drawer.textContent('.lyric.active')) === 'Après la pause', { message: 'active' });
  const moved = await drawer.evaluate(() => document.querySelector('.lyrics-lines').style.transform);
  assert.match(moved, /translateY\(-?\d+px\)/);
  await h.shell.evaluate(() => window.player.command({ type: 'seek', trackId: 'AAAAAAAAAAA', position: 0.5 }));
  await h.until(async () => /ligne/.test((await drawer.textContent('.lyric.active')) ?? ''), { message: 'back' });
  assert.notEqual(await drawer.evaluate(() => document.querySelector('.lyrics-lines').style.transform), moved);
  await drawer.evaluate(() => {
    window.requestAnimationFrame = window.__raf;
  });
});

test('lyrics panel: a click on a line goes there; the correction applies', async () => {
  const before = (await calls('seekTo')).length;
  await drawer.click('.lyric:has-text("Après la pause")');
  await h.until(async () => (await calls('seekTo')).length > before, { message: 'seek' });
  assert.ok(Math.abs((await calls('seekTo')).at(-1)[1] - 12) < 0.01, 'seek to the line');
  await drawer.click('.lyrics-offset [data-shift="0.5"]');
  await h.until(async () => (await drawer.textContent('.lyrics-offset-value')) === '+0,5 s', { message: 'offset' });
  await drawer.click('.lyrics-offset [data-shift="-0.5"]');
  await h.until(async () => (await drawer.textContent('.lyrics-offset-value')) === 'calées', { message: 'reset' });
});

test('immersive lyrics: the whole area under the toolbar, F and Escape', async () => {
  await drawer.click('.lyrics-full');
  await h.until(async () => (await drawerBounds()).x === 0, { message: 'full width' });
  assert.equal(await drawer.evaluate(() => document.body.classList.contains('lyrics-immersive')), true);
  await drawer.keyboard.press('f');
  await h.until(async () => (await drawerBounds()).width === 380, { message: 'back to the panel' });
  await drawer.keyboard.press('Escape');
  await h.until(async () => !(await h.viewBounds()).some(v => v.url.includes('view=drawer')), { message: 'closed' });
});

test("YouTube Music's own Lyrics tab opens cashew's synced view instead; other tabs do not", async () => {
  const shown = async () => (await h.viewBounds()).some(v => v.url.includes('view=drawer'));
  assert.equal(await shown(), false);
  await h.ytm(`document.querySelectorAll('ytmusic-player-page tp-yt-paper-tab')[3].click()`);
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.equal(await shown(), false, 'Related: nothing');
  await h.ytm(`document.querySelectorAll('ytmusic-player-page tp-yt-paper-tab')[1].querySelector('span').click()`);
  await h.until(shown, { message: 'lyrics view' });
  await drawer.waitForSelector('.lyrics-view:not([hidden]) .lyric');
  await drawer.keyboard.press('Escape');
  await h.until(async () => !(await shown()), { message: 'closed' });
});

test('lyrics panel: YouTube Music lyrics (no timing) when nothing synced is found', async () => {
  await h.shell.evaluate(() => window.player.command({ type: 'next' }));
  await h.until(async () => (await h.shell.textContent('#toolbar .title')) === 'Deuxième titre', { message: 'next' });
  await h.shell.click('#toolbar [data-window="toggle-lyrics"]');
  await drawer.waitForSelector('.lyrics-plain:not([hidden])', { timeout: 15000 });
  assert.match(await drawer.textContent('.lyrics-plain'), /Paroles sans minutage/);
  assert.match(await drawer.textContent('.lyrics-source'), /YouTube Music · Musixmatch · non synchronisées/);
  await drawer.keyboard.press('Escape');
});
