import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { launch } from './harness.mjs';

let h;
// A slow fake YouTube Music (2.5 s per page load).
before(async () => {
  h = await launch({ env: { MP_YTM_FIXTURE_DELAY: '2500' } });
});
after(async () => {
  await h?.close();
});

const musicAttached = async () => (await h.viewBounds()).some(v => v.url.startsWith('https://music.youtube.com'));

test('C · splash while YouTube Music really loads, then the page itself', async () => {
  await h.until(musicAttached, { message: 'page shown after the first load' });
  assert.equal(await h.shell.isVisible('#splash'), false);
  await h.shell.evaluate(() => window.player.window('reload-music'));
  await h.until(async () => h.shell.isVisible('#splash'), { message: 'splash during the reload' });
  assert.equal(await musicAttached(), false, 'the loading page is not shown');
  assert.equal(await h.shell.textContent('#splash .wordmark'), 'cashew');
  assert.equal(await h.shell.getAttribute('#splash .glyph use', 'href'), '#i-cashew-ridge');
  await h.until(musicAttached, { timeout: 8000, message: 'page shown when loaded' });
  assert.equal(await h.shell.isVisible('#splash'), false);
});

test('C · the mini-player never shows the splash', async () => {
  await h.shell.evaluate(() => window.player.window('toggle-mini'));
  await h.shell.waitForSelector('body.mini');
  await h.shell.evaluate(() => window.player.window('reload-music'));
  await new Promise(r => setTimeout(r, 500));
  assert.equal(await h.shell.isVisible('#splash'), false);
  assert.ok(await h.shell.isVisible('#mini .card'));
});
