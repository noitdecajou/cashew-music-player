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
    'Troisième titre': '[00:00.50] Troisième, première ligne\n[00:03.00] Troisième, deuxième ligne',
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
  await h.until(() => page(`document.querySelectorAll('#tab-renderer .cl-line').length > 0`), { message: 'lines' });
  assert.equal(await page(`getComputedStyle(document.querySelector('.native-content')).display`), 'none');
  assert.equal(await page(`document.querySelectorAll('#tab-renderer .cl-line.cl-interlude').length`), 1);
  assert.match(await page(`document.querySelector('#tab-renderer .cl-source').textContent`), /LRCLIB/);
  await seek(0.5);
  await h.until(async () => /Première ligne/.test((await active()) ?? ''), { message: 'sung line' });
  // Word by word: the first words are sung (white) first.
  await h.until(
    () =>
      page(
        `[...document.querySelectorAll('#tab-renderer .cl-active .cl-word')].some(w => w.style.getPropertyValue('--cl-fill') === '1')`,
      ),
    {
      message: 'words fill',
    },
  );
  // No side panel of ours in the large player.
  assert.ok(!(await h.viewBounds()).some(v => v.url.includes('view=drawer')));
});

test('Lyrics tab: scrolls with the song, a click on a line goes there, per-track correction', async () => {
  const top = await page(`document.querySelector('#tab-renderer').scrollTop`);
  await seek(30.5);
  // The fake player keeps playing: the line may already be the next one.
  await h.until(async () => /^Ligne (18|19|20)$/.test((await active()) ?? ''), { message: 'later line' });
  // A finished line keeps its fill and dims as a whole (nothing slides back).
  assert.equal(
    await page(
      `[...document.querySelectorAll('#tab-renderer .cl-past .cl-word')].some(w => w.style.getPropertyValue('--cl-fill') === '1')`,
    ),
    true,
  );
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
  // YouTube Music put its panel back at the top: the view goes straight to the sung
  // line instead of scrolling through the whole song.
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(
    await page(`(() => {
      const panel = document.querySelector('#tab-renderer').getBoundingClientRect();
      const line = document.querySelector('#tab-renderer .cl-active')?.getBoundingClientRect();
      return !!line && line.top >= panel.top && line.bottom <= panel.bottom;
    })()`),
    true,
    'sung line in view at once',
  );
});

test('immersive view: cover and title, the lines over the blurred cover; Escape leaves it', async () => {
  await page(`document.querySelector('#tab-renderer .cl-full').click()`);
  await h.until(() => page(`!!document.querySelector('.cl-immersive:not([hidden])')`), { message: 'immersive' });
  assert.equal(await page(`document.querySelector('.cl-immersive .cl-title').textContent`), 'Premier titre');
  assert.match(await page(`document.querySelector('.cl-immersive .cl-artist').textContent`), /Artiste Un/);
  await seek(12.5);
  await h.until(
    async () =>
      /^(Après la pause|Ligne [12])$/.test(
        (await page(`document.querySelector('.cl-immersive .cl-active')?.textContent`)) ?? '',
      ),
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

test('full screen: progress, play/pause, previous/next, up next under the cover', async () => {
  await h.shell.evaluate(() => window.player.window('toggle-lyrics-full'));
  await h.until(() => page(`!document.querySelector('.cl-immersive').hidden`), { message: 'open' });
  assert.match(await page(`document.querySelector('.cl-upnext').textContent`), /À suivre : Deuxième titre/);
  await seek(30);
  await h.until(async () => (await page(`document.querySelector('.cl-times .cl-time').textContent`)) === '0:30', {
    message: 'elapsed time',
  });
  assert.equal(await page(`document.querySelectorAll('.cl-times .cl-time')[1].textContent`), '3:20');
  // A click at the middle of the bar goes to the middle of the track.
  const before = (await calls('seekTo')).length;
  await page(`(() => {
    const bar = document.querySelector('.cl-progress');
    const r = bar.getBoundingClientRect();
    const at = { clientX: r.left + r.width / 2, clientY: r.top + 2, pointerId: 1, bubbles: true };
    bar.dispatchEvent(new PointerEvent('pointerdown', at));
    bar.dispatchEvent(new PointerEvent('pointerup', at));
  })()`);
  await h.until(async () => (await calls('seekTo')).length > before, { message: 'seek from the bar' });
  assert.ok(Math.abs((await calls('seekTo')).at(-1)[1] - 100) < 1);
  const clicks = async selector => (await calls('click')).filter(c => c[1] === selector).length;
  const plays = await clicks('#play-pause-button');
  await page(`document.querySelector('.cl-play').click()`);
  await h.until(async () => (await clicks('#play-pause-button')) > plays, { message: 'play/pause' });
  assert.equal(await page(`document.querySelector('.cl-play').title`), 'Lecture', 'paused: play icon');
  await page(`document.querySelector('.cl-play').click()`);
  await h.until(async () => (await page(`document.querySelector('.cl-play').title`)) === 'Pause', {
    message: 'playing',
  });
});

test("full screen: in YouTube Music's Video mode the clip plays next to the lyrics; the camera switches Song/Video", async () => {
  const player = `document.querySelector('ytmusic-player-page ytmusic-player')`;
  const pageClip = () => page(`document.querySelector('ytmusic-player-page').hasAttribute('cashew-clip')`);
  const measure = () =>
    page(`(() => {
      const p = ${player}.getBoundingClientRect();
      const s = document.querySelector('.cl-video-slot').getBoundingClientRect();
      return [Math.abs(p.left - s.left), Math.abs(p.top - s.top), Math.abs(p.width - s.width), s.width / s.height];
    })()`);
  // The fake page is in Video mode: the full screen shows the clip, not a still cover.
  await h.until(pageClip, { message: 'clip shown in Video mode' });
  assert.equal(await page(`document.querySelector('.cl-immersive').classList.contains('cl-with-clip')`), true);
  assert.equal(await page(`document.querySelector('.cl-clip-toggle').getAttribute('aria-pressed')`), 'true');
  // The view's layout settles (the lyrics column narrows); the player follows its place.
  await h.until(async () => (await measure()).slice(0, 3).every(gap => gap <= 1), { message: 'player over its place' });
  assert.ok(Math.abs((await measure())[3] - 16 / 9) < 0.02, '16:9');
  // The rest of YouTube Music's page stays hidden, the player above the view.
  assert.equal(await page(`getComputedStyle(${player}).visibility`), 'visible');
  assert.equal(
    await page(`getComputedStyle(document.querySelector('ytmusic-player-page tp-yt-paper-tabs')).visibility`),
    'hidden',
  );
  // The camera: back to Song mode, with the cover; the player goes back to its own place.
  await page(`document.querySelector('.cl-clip-toggle').click()`);
  await h.until(async () => !(await pageClip()), { message: 'clip hidden' });
  assert.equal((await calls('av-toggle')).at(-1)[1], 'song');
  assert.equal(await page(`${player}.style.position`), '');
  assert.equal(await page(`localStorage.getItem('cashew.lyrics.clip')`), 'off');
  // And to Video mode again.
  await page(`document.querySelector('.cl-clip-toggle').click()`);
  await h.until(pageClip, { message: 'clip again' });
  assert.equal((await calls('av-toggle')).at(-1)[1], 'video');
  await h.shell.evaluate(() => window.player.window('toggle-lyrics-full'));
  await h.until(async () => !(await pageClip()), { message: 'restored when leaving' });
  assert.equal(await page(`${player}.style.position`), '');
  assert.equal(await page(`localStorage.getItem('cashew.lyrics.clip')`), 'on');
  await page(`localStorage.removeItem('cashew.lyrics.clip')`);
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
    async () =>
      /^(Après la pause|Ligne [12])$/.test(
        (await drawer.textContent('.lyrics-scroll .cl-active').catch(() => '')) ?? '',
      ),
    {
      message: 'active',
    },
  );
  await drawer.keyboard.press('Escape');
  await h.shell.evaluate(() => window.player.window('toggle-mini'));
  await h.shell.waitForSelector('body.large');
});

test('lyrics are fetched ahead while the player page is shown: the Lyrics tab opens straight on them', async () => {
  await page(`document.querySelectorAll('ytmusic-player-page tp-yt-paper-tab')[0].click()`);
  await page(`document.querySelector('ytmusic-app-layout').setAttribute('player-page-open', '')`);
  await h.shell.evaluate(() => {
    window.__lyrics = [];
    window.player.on('lyrics:state', state => window.__lyrics.push(state));
  });
  await h.ytm('__fake.start(2)');
  await h.until(async () => (await h.shell.textContent('#toolbar .title')) === 'Troisième titre', { message: 'third' });
  await h.until(
    () => h.shell.evaluate(() => window.__lyrics.some(s => s.trackId === 'CCCCCCCCCCC' && s.status === 'synced')),
    { message: 'fetched without opening the tab' },
  );
  await page(`document.querySelector('[data-cashew-lyrics]').click()`);
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(await tabTakenOver(), true);
  assert.equal(await page(`document.querySelector('#tab-renderer .cl-wait').hidden`), true, 'no wait');
  assert.ok((await page(`document.querySelectorAll('#tab-renderer .cl-line').length`)) >= 2);
});

test("Video mode: the card keeps the song's title, cover and up next (the clip has another id)", async () => {
  await h.ytm('__fake.start(1)');
  await h.until(async () => (await h.shell.textContent('#toolbar .title')) === 'Deuxième titre', { message: 'second' });
  await h.shell.evaluate(() => {
    window.__snap = null;
    window.player.on('player:snapshot', s => (window.__snap = s));
  });
  await h.ytm('__fake.videoVersion()');
  await h.until(() => h.shell.evaluate(() => window.__snap?.track?.id === 'VVVVVVVVVVV'), { message: 'clip playing' });
  const snap = await h.shell.evaluate(() => window.__snap);
  assert.equal(snap.track.title, 'Deuxième titre');
  assert.match(snap.track.artwork, /lh3\.googleusercontent\.com/, 'the song cover, not a frame of the clip');
  assert.deepEqual(snap.next, { title: 'Troisième titre', artist: 'Artiste Trois' });
});
