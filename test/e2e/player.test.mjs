import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { launch } from './harness.mjs';

let h;
before(async () => { h = await launch(); });
after(async () => { await h?.close(); });

test('the card shows the queue metadata of the playing track', async () => {
  await h.ytm('__fake.start(0)');
  await h.until(async () => (await h.shell.textContent('#toolbar .title')) === 'Premier titre', { message: 'title' });
  assert.equal(await h.shell.textContent('#toolbar .artist'), 'Artiste Un');
  const last = (await h.log()).filter(m => m.kind === 'snapshot').at(-1).snapshot;
  assert.equal(last.track.artwork, 'https://lh3.googleusercontent.com/AAAAAAAAAAA=w544-h544-l90-rj');
  assert.deepEqual(last.next, { title: 'Deuxième titre', artist: 'Artiste Deux' });
  assert.equal(last.status, 'playing');
  assert.equal(last.signedIn, true);
});

test('a clock is never sent before the card of its track (natural handoffs, lagging queue)', async () => {
  await h.ytm('__fake.setQueueLag(300)');
  for (let i = 0; i < 2; i++) {
    const before = await h.ytm('__fake.index');
    await h.ytm('__fake.nearEnd(0.5)');
    await h.until(async () => (await h.ytm('__fake.index')) !== before, { message: 'handoff' });
  }
  await new Promise(r => setTimeout(r, 600));
  let cardTrack = '';
  for (const message of await h.log()) {
    if (message.kind === 'snapshot') cardTrack = message.snapshot.track?.id ?? '';
    if (message.kind === 'progress') assert.equal(message.progress.trackId, cardTrack, 'progress paired with its card');
  }
  const last = (await h.log()).filter(m => m.kind === 'snapshot').at(-1).snapshot;
  assert.equal(last.track.id, 'CCCCCCCCCCC');
  assert.equal(last.track.title, 'Troisième titre'); // queue title, even before the store caught up
  await h.ytm('__fake.setQueueLag(0)');
});

test('transport and shuffle commands reach the page', async () => {
  await h.shell.click('[data-window="toggle-mini"]');
  await h.shell.waitForSelector('body.mini');
  await h.shell.click('#mini [data-command="toggle-play"]');
  await h.until(async () => (await h.shell.getAttribute('#mini .play', 'aria-label')) === 'Lire', { message: 'paused' });
  await h.shell.click('#mini [data-command="next"]');
  await h.until(async () => (await h.shell.textContent('#mini .title')) === 'Premier titre', { message: 'next wraps to first' });
  await h.shell.click('#mini [data-command="shuffle"]');
  await h.until(async () => (await h.shell.getAttribute('#mini .shuffle', 'aria-pressed')) === 'true', { message: 'shuffle on' });
});

test('dragging the progress bar seeks once, on release, to the released position', async () => {
  await h.until(async () => (await h.shell.getAttribute('#mini .progress', 'aria-disabled')) === 'false', { message: 'seekable' });
  const box = await h.shell.locator('#mini .progress').boundingBox();
  const before = (await h.ytm('__fake.calls.length'));
  await h.shell.mouse.move(box.x + box.width * 0.1, box.y + box.height / 2);
  await h.shell.mouse.down();
  for (let i = 1; i <= 10; i++) await h.shell.mouse.move(box.x + box.width * (0.1 + i * 0.05), box.y + box.height / 2);
  const seeksDuringDrag = (await h.ytm('__fake.calls')).slice(before).filter(c => c[0] === 'seekTo');
  assert.equal(seeksDuringDrag.length, 0, 'no seek while dragging');
  assert.match(await h.shell.textContent('#mini .elapsed'), /^(1:5\d|2:0\d)$/, 'preview time follows the hand (~60% of 3:20 = 2:00)');
  await h.shell.mouse.up();
  const seeks = await h.until(async () => {
    const list = (await h.ytm('__fake.calls')).slice(before).filter(c => c[0] === 'seekTo');
    return list.length ? list : null;
  }, { message: 'seek' });
  assert.equal(seeks.length, 1);
  assert.ok(Math.abs(seeks[0][1] - 120) < 4, `seek near 120 s, got ${seeks[0][1]}`);
});

test('volume: the speaker opens and closes the panel; mute is a separate button; size unchanged', async () => {
  const size = await h.contentSize();
  const isOpen = () => h.shell.isVisible('#mini .volume-panel');
  await h.shell.hover('#mini .volume-button');
  await h.shell.mouse.wheel(0, -100); // up: +5
  await h.until(async () => (await h.ytm('__fake.calls')).some(c => c[0] === 'setVolume' && c[1] === 75), { message: 'wheel +5' });
  assert.ok(await isOpen(), 'panel replaces the up-next area');
  assert.equal(await h.shell.textContent('#mini .volume-value'), '75');
  const box = await h.shell.locator('#mini .slider.volume').boundingBox();
  await h.shell.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
  await h.shell.mouse.down();
  await h.shell.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);
  await h.shell.mouse.up();
  await h.until(async () => {
    const last = (await h.ytm('__fake.calls')).filter(c => c[0] === 'setVolume').at(-1);
    return last && Math.abs(last[1] - 30) <= 2;
  }, { message: 'slider ~30' });
  await h.shell.click('#mini .volume-mute');
  await h.until(async () => (await h.shell.getAttribute('#mini .volume-mute', 'aria-pressed')) === 'true', { message: 'muted' });
  assert.ok(await isOpen(), 'muting keeps the panel open');
  await h.shell.click('#mini .volume-button');
  await h.until(async () => !(await isOpen()), { message: 'speaker closes the panel' });
  assert.ok(await h.shell.isVisible('#mini .upnext'), 'up next is visible again');
  assert.equal((await h.ytm('__fake.calls')).filter(c => c[0] === 'mute').length, 1, 'closing does not mute');
  await h.shell.click('#mini .volume-button');
  await h.until(isOpen, { message: 'reopened' });
  await h.shell.click('#mini .title');
  await h.until(async () => !(await isOpen()), { message: 'click elsewhere closes' });
  await h.shell.click('#mini .volume-button');
  await h.shell.click('#mini .volume-mute'); // unmute for the next tests
  await h.shell.keyboard.press('Escape');
  assert.deepEqual(await h.contentSize(), size);
});

test('volume: in every theme, the panel replaces "up next" instead of overlapping it', async () => {
  for (const theme of ['modern', 'autoradio', 'hifi', 'autoradio-hf', 'hifi-hf']) {
    await h.shell.evaluate(t => window.player.setTheme(t), theme);
    await h.shell.click('#mini .volume-button');
    await h.until(async () => h.shell.isVisible('#mini .volume-panel'), { message: `${theme}: panel open` });
    assert.equal(await h.shell.isVisible('#mini .upnext'), false, `${theme}: up next hidden`);
    const panel = await h.shell.locator('#mini .volume-panel').boundingBox();
    const slider = await h.shell.locator('#mini .slider.volume').boundingBox();
    assert.ok(slider.width >= 60, `${theme}: usable slider (${slider.width}px)`);
    assert.ok(slider.x >= panel.x - 1 && slider.x + slider.width <= panel.x + panel.width + 1, `${theme}: slider inside its area`);
    await h.shell.click('#mini .volume-button');
    await h.until(async () => h.shell.isVisible('#mini .upnext'), { message: `${theme}: up next back` });
  }
  await h.shell.evaluate(() => window.player.setTheme('modern'));
});

test('mini sizes: theme size plus the 30 px title bar, which can be hidden', async () => {
  assert.deepEqual(await h.contentSize(), [420, 158]);
  await h.shell.keyboard.press('Control+Shift+B');
  await h.until(async () => JSON.stringify(await h.contentSize()) === '[420,128]', { message: 'seamless 420x128' });
  await h.shell.evaluate(() => window.player.setTheme('autoradio-hf'));
  await h.until(async () => JSON.stringify(await h.contentSize()) === '[720,192]', { message: 'HF 720x192' });
  await h.shell.click('#mini [data-window="toggle-search"]');
  await h.until(async () => JSON.stringify(await h.contentSize()) === '[720,450]', { message: 'panel 450' });
  const drawerView = await h.until(async () => (await h.viewBounds()).find(v => v.url.includes('view=drawer')), { message: 'drawer view' });
  assert.deepEqual(drawerView.bounds, { x: 0, y: 192, width: 720, height: 258 }, 'drawer below the card');
  const drawer = await h.drawer();
  await drawer.waitForSelector('body:not(.booting)');
  await drawer.keyboard.press('Escape');
  await h.until(async () => JSON.stringify(await h.contentSize()) === '[720,192]', { message: 'panel closed' });
});

test('the page cannot spoof the shell, and invalid commands are dropped', async () => {
  const before = (await h.ytm('__fake.calls.length'));
  await h.shell.evaluate(() => {
    window.player.command({ type: 'seek', trackId: 'not-an-id', position: 5 });
    window.player.command({ type: 'volume', volume: 'loud' });
    window.player.command({ type: 'rm -rf' });
  });
  await new Promise(r => setTimeout(r, 300));
  const after = (await h.ytm('__fake.calls')).slice(before);
  assert.deepEqual(after.filter(c => ['seekTo', 'setVolume'].includes(c[0])), []);
  // The YouTube Music page has no access to the shell API.
  assert.equal(await h.ytm('typeof window.player'), 'undefined');
  assert.equal(await h.ytm('typeof require'), 'undefined');
});

test('large mode: the drawer overlaps YouTube Music without resizing it', async () => {
  await h.shell.evaluate(() => window.player.window('toggle-mini'));
  await h.shell.waitForSelector('body.large');
  const ytmBounds = async () => (await h.viewBounds()).find(v => v.url.startsWith('https://music.youtube.com')).bounds;
  const before = await ytmBounds();
  await h.shell.click('#toolbar [data-window="toggle-settings"]');
  await h.until(async () => (await h.viewBounds()).some(v => v.url.includes('view=drawer')), { message: 'drawer attached' });
  assert.deepEqual(await ytmBounds(), before, 'YouTube Music keeps its size');
  const views = await h.viewBounds();
  const drawer = views.find(v => v.url.includes('view=drawer'));
  assert.ok(views.indexOf(drawer) > views.findIndex(v => v.url.startsWith('https://music.youtube.com')), 'drawer stacked on top');
  assert.equal(drawer.bounds.width, 380);
  assert.equal(drawer.bounds.x + drawer.bounds.width, before.width, 'anchored to the right edge');
  const page = await h.drawer();
  assert.equal(await page.textContent('.panel-title'), 'Réglages');
  // Clicking back into YouTube Music closes the overlay.
  await h.app.evaluate(({ webContents }) => webContents.getAllWebContents().find(w => w.getURL().startsWith('https://music.youtube.com')).focus());
  await h.until(async () => !(await h.viewBounds()).some(v => v.url.includes('view=drawer')), { message: 'drawer closed on focus' });
});
