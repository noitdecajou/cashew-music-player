import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { launch, newProfile } from './harness.mjs';

// cashew's synced lyrics: in YouTube Music's own Lyrics tab (and its immersive
// view) in the large player, in a panel in the mini-player. LRCLIB is a local
// fixture here; YouTube Music's own lyrics come from the fake page.
const dir = mkdtempSync(join(tmpdir(), 'mp-lyrics-'));
const lyricsFile = join(dir, 'lyrics.json');
writeFileSync(
  lyricsFile,
  JSON.stringify({
    'Premier titre':
      '[00:00.20] Première ligne chantée\n[00:01.20] Deuxième ligne\n[00:02.20] \n[00:12.00] Après la pause\n' +
      Array.from({ length: 30 }, (_, i) => `[00:${String(13 + i).padStart(2, '0')}.00] Ligne ${i + 1}`).join('\n') +
      '\n[09:00.00] Fin',
  }),
);
const profile = newProfile();
let h;
const calls = async type => (await h.ytm('__fake.calls')).filter(c => c[0] === type || c[1] === type);
const seek = position =>
  h.shell.evaluate(p => window.player.command({ type: 'seek', trackId: 'AAAAAAAAAAA', position: p }), position);
const page = code => h.ytm(code);
const active = () => page(`document.querySelector('#tab-renderer .cl-active')?.textContent ?? null`);
const tabTakenOver = () => page(`document.querySelector('#tab-renderer').hasAttribute('cashew-lyrics')`);

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

test("large player: no toolbar button; YouTube Music's Lyrics tab is taken over by cashew's synced lines", async () => {
  assert.equal(await h.shell.locator('#toolbar [data-window="toggle-lyrics"]').count(), 0, 'no toolbar button');
  await h.shell.evaluate(() => window.player.window('toggle-lyrics'));
  await h.until(() => page(`document.querySelector('ytmusic-app-layout').hasAttribute('player-page-open')`), {
    message: 'player page opened',
  });
  await h.until(() => page(`document.querySelector('[data-cashew-lyrics]')?.getAttribute('aria-selected')`), {
    message: 'Lyrics tab selected',
  });
  await h.until(tabTakenOver, { message: 'tab taken over' });
  assert.equal(await page(`getComputedStyle(document.querySelector('.native-content')).display`), 'none');
  assert.equal(await page(`document.querySelectorAll('#tab-renderer .cl-line.cl-interlude').length`), 1);
  assert.match(await page(`document.querySelector('#tab-renderer .cl-source').textContent`), /LRCLIB/);
  await seek(0.5);
  await h.until(async () => /Première ligne/.test((await active()) ?? ''), { message: 'sung line' });
  // Word by word: the first words are sung (white) first.
  await h.until(() => page(`document.querySelectorAll('#tab-renderer .cl-active .cl-word.cl-sung').length > 0`), {
    message: 'words fill',
  });
  // No side panel of ours in the large player.
  assert.ok(!(await h.viewBounds()).some(v => v.url.includes('view=drawer')));
});

test('Lyrics tab: scrolls with the song, a click on a line goes there, per-track correction', async () => {
  const top = await page(`document.querySelector('#tab-renderer').scrollTop`);
  await seek(30.5);
  await h.until(async () => (await active()) === 'Ligne 18', { message: 'later line' });
  await h.until(async () => (await page(`document.querySelector('#tab-renderer').scrollTop`)) > top + 100, {
    message: 'scrolled down',
  });
  const before = (await calls('seekTo')).length;
  await page(
    `[...document.querySelectorAll('#tab-renderer .cl-line')].find(l => l.textContent === 'Après la pause').click()`,
  );
  await h.until(async () => (await calls('seekTo')).length > before, { message: 'seek' });
  assert.ok(Math.abs((await calls('seekTo')).at(-1)[1] - 12) < 0.01, 'seek to the line');
  await page(`document.querySelectorAll('#tab-renderer .cl-offset button')[1].click()`);
  await h.until(
    async () => (await page(`document.querySelector('#tab-renderer .cl-offset-value').textContent`)) === '+0,5 s',
    {
      message: 'offset',
    },
  );
  await page(`document.querySelectorAll('#tab-renderer .cl-offset button')[0].click()`);
  await h.until(
    async () => (await page(`document.querySelector('#tab-renderer .cl-offset-value').textContent`)) === 'calées',
    {
      message: 'reset',
    },
  );
});

test("Lyrics tab: another tab gives the place back to YouTube Music's content", async () => {
  await page(`document.querySelectorAll('ytmusic-player-page tp-yt-paper-tab')[0].click()`);
  await h.until(async () => !(await tabTakenOver()), { message: 'given back' });
  assert.notEqual(await page(`getComputedStyle(document.querySelector('.native-content')).display`), 'none');
  await page(`document.querySelector('[data-cashew-lyrics]').click()`);
  await h.until(tabTakenOver, { message: 'taken over again' });
});

test('immersive view: cover and title, the lines over the blurred cover; Escape leaves it', async () => {
  await page(`document.querySelector('#tab-renderer .cl-full').click()`);
  await h.until(() => page(`!!document.querySelector('.cl-immersive:not([hidden])')`), { message: 'immersive' });
  assert.equal(await page(`document.querySelector('.cl-immersive .cl-title').textContent`), 'Premier titre');
  assert.match(await page(`document.querySelector('.cl-immersive .cl-artist').textContent`), /Artiste Un/);
  await seek(12.5);
  await h.until(
    async () => (await page(`document.querySelector('.cl-immersive .cl-active')?.textContent`)) === 'Après la pause',
    { message: 'sung line' },
  );
  // The toolbar's shortcut toggles it too.
  await h.shell.evaluate(() => window.player.window('toggle-lyrics-full'));
  await h.until(() => page(`document.querySelector('.cl-immersive').hidden`), { message: 'closed by the toolbar' });
  await h.shell.evaluate(() => window.player.window('toggle-lyrics-full'));
  await h.until(() => page(`!document.querySelector('.cl-immersive').hidden`), { message: 'open again' });
  await h.app.evaluate(({ webContents }) => {
    const music = webContents
      .getAllWebContents()
      .find(w => w.getURL().includes('ytm.html') || w.getURL().startsWith('https://music.youtube.com'));
    music.focus();
    music.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  });
  await h.until(() => page(`document.querySelector('.cl-immersive').hidden`), { message: 'Escape' });
});

test("no synced lyrics: YouTube Music's own Lyrics tab stays; the mini-player panel shows its text", async () => {
  await h.shell.evaluate(() => window.player.command({ type: 'next' }));
  await h.until(async () => (await h.shell.textContent('#toolbar .title')) === 'Deuxième titre', { message: 'next' });
  await h.until(async () => !(await tabTakenOver()), { message: 'not taken over' });
  await h.shell.evaluate(() => window.player.window('toggle-mini'));
  await h.shell.waitForSelector('body.mini');
  await h.shell.evaluate(() => window.player.window('toggle-lyrics'));
  const drawer = await h.drawer();
  await drawer.waitForSelector('.lyrics-plain:not([hidden])', { timeout: 15000 });
  assert.match(await drawer.textContent('.lyrics-plain'), /Paroles sans minutage/);
  assert.match(await drawer.textContent('.lyrics-source'), /YouTube Music · Musixmatch · non synchronisées/);
});

test('mini-player panel: synced lines follow the song', async () => {
  await h.shell.evaluate(() => window.player.command({ type: 'previous' }));
  await h.until(async () => (await h.shell.textContent('#mini .title, #toolbar .title')) === 'Premier titre', {
    message: 'previous',
  });
  const drawer = await h.drawer();
  await drawer.waitForSelector('.lyrics-scroll .cl-line');
  await seek(12.5);
  await h.until(
    async () => (await drawer.textContent('.lyrics-scroll .cl-active').catch(() => '')) === 'Après la pause',
    {
      message: 'active',
    },
  );
  await drawer.keyboard.press('Escape');
  await h.shell.evaluate(() => window.player.window('toggle-mini'));
  await h.shell.waitForSelector('body.large');
});
