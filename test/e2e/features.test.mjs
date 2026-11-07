import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { launch, newProfile } from './harness.mjs';

const profile = newProfile();
let h;
let drawer;
before(async () => {
  h = await launch({ userData: profile });
  await h.ytm('__fake.start(0)');
  await h.until(async () => (await h.shell.textContent('#toolbar .title')) === 'Premier titre', { message: 'playing' });
});
after(async () => {
  await h?.close();
  rmSync(profile, { recursive: true, force: true });
});

const openPanel = async action => {
  await h.shell.evaluate(a => window.player.window(a), action);
  drawer = await h.drawer();
  await drawer.waitForSelector('body:not(.booting)');
};
const calls = async type => (await h.ytm('__fake.calls')).filter(c => c[0] === type || c[1] === type);

test('library: every playlist page is indexed; search ignores accents and the suggestions shelf', async () => {
  await openPanel('toggle-search');
  await drawer.waitForSelector('section[data-panel="search"]:not([hidden])');
  await h.until(async () => /2 playlists · 5 titres/.test(await drawer.textContent('.library-status')), {
    timeout: 10000,
    message: 'indexed',
  });
  await drawer.fill('#query', 'cafe ELODIE');
  await h.until(async () => (await drawer.locator('.results .title').allTextContents()).join('|') === 'Café crème', {
    message: 'accent-insensitive hit',
  });
  await drawer.fill('#query', 'troisieme');
  await h.until(
    async () => (await drawer.locator('.results .title').allTextContents()).join('|') === 'Troisième titre',
    { message: 'third song (second page)' },
  );
  await drawer.fill('#query', 'hors');
  await h.until(async () => (await drawer.textContent('.results')).includes('Aucun résultat'), {
    message: 'suggestions not indexed',
  });
});

test('search: “+ Ensuite” inserts after the current track', async () => {
  await drawer.fill('#query', 'nuit');
  await drawer.waitForSelector('.results .row');
  await drawer.click('.results .row >> text=+ Ensuite');
  await h.until(async () => (await h.ytm('__fake.queueIds'))[(await h.ytm('__fake.index')) + 1] === 'EEEEEEEEEEE', {
    message: 'inserted next',
  });
  assert.match(await drawer.textContent('.panel-notice'), /À suivre : Nuit étoilée/);
});

test('search: the whole of YouTube Music, then play a result', async () => {
  await drawer.click('[data-scope="web"]');
  await drawer.fill('#query', 'web');
  await drawer.press('#query', 'Enter');
  await h.until(async () => (await drawer.locator('.results .title').allTextContents()).includes('Hors bibliothèque'), {
    message: 'web result',
  });
  assert.ok(
    (await calls('/search')).some(c => c[2]?.params === 'songs-param'),
    'uses the Songs filter',
  );
  await drawer.click('.results .row button[title="Lire maintenant"]');
  await h.until(async () => (await h.ytm('__fake.playingId')) === 'FFFFFFFFFFF', { message: 'playing web result' });
  await h.until(async () => (await h.shell.textContent('#toolbar .title')) === 'Hors bibliothèque', {
    message: 'card updated',
  });
});

test('playlists: favorites go first and a playlist can be played', async () => {
  await drawer.click('[data-scope="playlists"]');
  await drawer.fill('#query', '');
  await h.until(async () => (await drawer.locator('.results .title').allTextContents()).join('|') === 'Matin|Soirée', {
    message: 'playlists',
  });
  await drawer.click('.results .row:has-text("Soirée") .star');
  await h.until(async () => (await drawer.locator('.results .title').allTextContents()).join('|') === 'Soirée|Matin', {
    message: 'favorite first',
  });
  await drawer.click('.results .row:has-text("Soirée") button[title="Lire la playlist"]');
  await h.until(async () => (await h.ytm('__fake.playingId')) === 'DDDDDDDDDDD', { message: 'playlist started' });
  const navigate = (await calls('navigate')).at(-1)[1];
  assert.deepEqual(navigate, { playlistId: 'PLevening' }, 'browse id VL… becomes a playlist id');
});

test('queue: live list, jump to a track, remove a track', async () => {
  await openPanel('toggle-queue');
  await h.until(async () => (await drawer.locator('.queue-list .row').count()) === 3, { message: 'queue rendered' });
  assert.equal(await drawer.textContent('.queue-row.current .title'), 'Café crème');
  await drawer.click('.queue-list .row:nth-child(3) .meta');
  await h.until(async () => (await h.ytm('__fake.playingId')) === 'BBBBBBBBBBB', { message: 'jumped' });
  await h.until(async () => (await drawer.textContent('.queue-row.current .title')) === 'Deuxième titre', {
    message: 'current follows',
  });
  await drawer.click('.queue-list .row:nth-child(2) .remove');
  await h.until(async () => (await h.ytm('__fake.queueIds')).join(',') === 'DDDDDDDDDDD,BBBBBBBBBBB', {
    message: 'removed',
  });
  await h.until(async () => (await drawer.locator('.queue-list .row').count()) === 2, { message: 'list updated' });
  assert.equal(await drawer.locator('.queue-row.current .remove').count(), 0, 'the current track cannot be removed');
});

test('settings window: sections in a sidebar; theme, startup, shortcut, diagnostics', async () => {
  const settings = await h.settings('player');
  await settings.click('.theme-card[data-theme="hifi"]');
  await h.until(
    async () => (await settings.getAttribute('.theme-card[data-theme="hifi"]', 'aria-checked')) === 'true',
    {
      message: 'theme checked',
    },
  );
  assert.equal(await h.shell.getAttribute('body', 'data-theme'), 'hifi');
  await settings.click('.sidebar [data-section="general"]');
  assert.equal(await settings.isVisible('section[data-section="player"]'), false, 'one section at a time');
  assert.equal(await settings.isDisabled('#startup'), true);
  await settings.click('#shortcut');
  await settings.keyboard.press('Control+Alt+P');
  await h.until(
    async () => {
      const value = await settings.inputValue('#shortcut');
      const status = await settings.textContent('.shortcut-status');
      return value === 'Ctrl+Alt+P' || /utilisé/.test(status);
    },
    { message: 'shortcut saved (or reported busy)' },
  );
  await settings.click('#clearShortcut');
  await h.until(async () => (await settings.inputValue('#shortcut')) === '', { message: 'shortcut disabled' });
  await settings.click('.sidebar [data-section="about"]');
  await settings.click('#diagnostics');
  await h.until(async () => /Mémoire : \d+ Mo/.test(await settings.textContent('.diagnostics-result')), {
    message: 'diagnostics',
  });
  await settings.keyboard.press('Escape').catch(() => {}); // closes the window
  await h.until(async () => !h.app.windows().some(p => p.url().includes('settings.html')), { message: 'closed' });
});

test('video fullscreen: YouTube Music covers the window, the drawer cannot open', async () => {
  await h.app.evaluate(({ webContents }) =>
    webContents
      .getAllWebContents()
      .find(w => w.getURL().startsWith('https://music.youtube.com'))
      .executeJavaScript('document.documentElement.requestFullscreen()', true),
  );
  await h.until(
    async () => {
      const views = await h.viewBounds();
      const music = views.find(v => v.url.startsWith('https://music.youtube.com'));
      return music?.bounds.y === 0;
    },
    { message: 'music view at the top' },
  );
  await h.shell.evaluate(() => window.player.window('toggle-search'));
  await new Promise(r => setTimeout(r, 300));
  assert.ok(!(await h.viewBounds()).some(v => v.url.includes('view=drawer')), 'no drawer over the video');
  await h.app.evaluate(({ webContents }) =>
    webContents
      .getAllWebContents()
      .find(w => w.getURL().startsWith('https://music.youtube.com'))
      .executeJavaScript('document.exitFullscreen()', true),
  );
  await h.until(
    async () => (await h.viewBounds()).find(v => v.url.startsWith('https://music.youtube.com'))?.bounds.y === 82,
    { message: 'back under the toolbar' },
  );
});

test('resume: after a restart, Play resumes the last track at its position', async () => {
  await h.ytm('document.querySelector("#movie_player").seekTo(42, true)');
  await h.until(async () => Math.abs((await h.ytm('__fake.time')) - 42) < 2, { message: 'at 0:42' });
  await h.close();
  h = await launch({ userData: profile });
  await h.shell.evaluate(() => window.player.window('toggle-mini'));
  await h.until(async () => (await h.shell.textContent('#mini .upnext .label')) === 'REPRISE', {
    timeout: 10000,
    message: 'resume offered',
  });
  assert.equal(await h.shell.textContent('#mini .title'), 'Deuxième titre');
  assert.match(await h.shell.textContent('#mini .next-title'), /Reprendre à 0:4\d/);
  await h.shell.click('#mini .play');
  await h.until(async () => (await h.ytm('__fake.playingId')) === 'BBBBBBBBBBB', { message: 'track loaded' });
  await h.until(async () => (await h.ytm('__fake.time')) >= 40, { message: 'position restored' });
  await h.until(async () => (await h.shell.textContent('#mini .upnext .label')) === 'À SUIVRE', {
    message: 'back to normal',
  });
  const navigate = (await calls('navigate')).at(-1)[1];
  assert.deepEqual(navigate, { videoId: 'BBBBBBBBBBB', playlistId: 'PLevening' });
});
