import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { launch, newProfile } from './harness.mjs';

// The "Argent" skins (Winamp 5 style, light and dark): their own LCD, side
// buttons, inline volume and the panels as tabs under the window.
const profile = newProfile();
let h;
const size = () => h.contentSize().then(s => JSON.stringify(s));
const visible = selector =>
  h.shell.evaluate(s => {
    const e = document.querySelector(s);
    return !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0;
  }, selector);

before(async () => {
  h = await launch({ userData: profile });
  await h.ytm('__fake.start(0)');
  await h.until(async () => (await h.shell.textContent('#toolbar .title')) === 'Premier titre', { message: 'playing' });
  await h.shell.evaluate(() => window.player.window('toggle-mini'));
  await h.shell.waitForSelector('body.mini');
});
after(async () => {
  await h?.close();
  rmSync(profile, { recursive: true, force: true });
});

test('Argent: 400 × 180 (drawn at 500 × 224, 80 %), the LCD shows the clock, the flags and the scrolling title with what comes next', async () => {
  await h.shell.evaluate(() => window.player.setTheme('argent'));
  await h.until(async () => (await size()) === '[400,210]', { message: '400 × 180 + title bar' });
  assert.ok(await visible('#mini .lcd'), 'LCD');
  assert.ok(!(await visible('#mini .lcd-flags .flag-pinned')), 'not pinned');
  await h.shell.evaluate(() => window.player.command({ type: 'seek', trackId: 'AAAAAAAAAAA', position: 10 }));
  await h.until(async () => /^0:1\d$/.test(await h.shell.textContent('#mini .lcd-time')), { message: 'LCD clock' });
  assert.match(await h.shell.textContent('#mini .time.remaining'), /^-3:(0|1)\d$/, 'time left (3:20 track)');
  const marquee = await h.shell.textContent('#mini .lcd-marquee-text');
  assert.match(marquee, /Artiste Un — Premier titre \(3:20\)/);
  assert.match(marquee, /À suivre : Deuxième titre — Artiste Deux/);
  assert.equal(await h.shell.evaluate(() => document.querySelector('#mini').classList.contains('playing')), true);
  // The usual skins' parts are not shown; title and artist stay for screen readers.
  for (const hidden of ['.upnext', '.cover', '.grip', '.tools [data-window="toggle-search"]'])
    assert.equal(await visible(`#mini ${hidden}`), false, hidden);
  await h.shell.evaluate(() => window.player.window('pin'));
  await h.until(() => visible('#mini .lcd-flags .flag-pinned'), { message: 'pinned flag' });
  await h.shell.evaluate(() => window.player.window('pin'));
});

test('Argent: the speaker mutes, the volume slider is always there', async () => {
  assert.ok(await visible('#mini .slider.volume'), 'inline volume');
  await h.shell.click('#mini .volume-button');
  await h.until(async () => (await h.ytm('__fake.calls')).some(c => c[0] === 'mute'), { message: 'muted' });
  await h.until(() => visible('#mini .flag-muted'), { message: 'MUET flag' });
  await h.shell.click('#mini .volume-button');
  await h.until(async () => (await h.ytm('__fake.calls')).some(c => c[0] === 'unMute'), { message: 'unmuted' });
  assert.ok(await visible('#mini .slider.volume'), 'still shown');
});

test('Argent: the island button turns the island on and off, back to its mode', async () => {
  const islandOn = () => h.shell.getAttribute('#mini .island-toggle', 'aria-pressed');
  assert.equal(await islandOn(), 'false');
  await h.shell.click('#mini .island-toggle');
  await h.until(async () => (await islandOn()) === 'true', { message: 'on' });
  assert.equal((await h.shell.evaluate(() => window.player.settings())).island.mode, 'always');
  await h.shell.evaluate(() => window.player.updateSettings({ island: { mode: 'track' } }));
  await h.shell.click('#mini .island-toggle');
  await h.until(async () => (await islandOn()) === 'false', { message: 'off' });
  await h.shell.click('#mini .island-toggle');
  await h.until(async () => (await islandOn()) === 'true', { message: 'on again' });
  assert.equal((await h.shell.evaluate(() => window.player.settings())).island.mode, 'track', 'its last mode');
  await h.shell.click('#mini .island-toggle');
  await h.until(async () => (await islandOn()) === 'false', { message: 'off at the end' });
});

test('Argent: the lower part opens on the queue; tabs switch panels; the chevron closes it', async () => {
  await h.shell.click('#mini .lower-toggle');
  await h.until(async () => (await size()) === '[400,426]', { message: 'lower part (396 + title bar)' });
  const drawer = await h.drawer();
  await drawer.waitForSelector('section[data-panel="queue"]:not([hidden]) .queue-row');
  assert.equal(await drawer.getAttribute('.skin-tabs [data-tab="queue"]', 'aria-pressed'), 'true');
  assert.ok(await drawer.evaluate(() => getComputedStyle(document.querySelector('.panel-head')).display === 'none'));
  await drawer.click('.skin-tabs [data-tab="lyrics"]');
  await drawer.waitForSelector('section[data-panel="lyrics"]:not([hidden])');
  await drawer.click('.skin-tabs [data-tab="search"]');
  await drawer.waitForSelector('section[data-panel="search"]:not([hidden])');
  assert.equal(await drawer.getAttribute('.skin-tabs [data-tab="search"]', 'aria-pressed'), 'true');
  // A click on the open tab keeps it open.
  await drawer.click('.skin-tabs [data-tab="search"]');
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(await size(), '[400,426]');
  assert.equal(await h.shell.getAttribute('#mini .lower-toggle', 'aria-expanded'), 'true');
  await h.shell.click('#mini .lower-toggle');
  await h.until(async () => (await size()) === '[400,210]', { message: 'closed' });
});

test('Argent sombre: same layout, dark palette; other skins do not show the Argent parts', async () => {
  await h.shell.evaluate(() => window.player.setTheme('argent-sombre'));
  await h.until(async () => (await h.shell.getAttribute('body', 'data-theme')) === 'argent-sombre', {
    message: 'dark',
  });
  assert.equal(await size(), '[400,210]');
  const card = await h.shell.evaluate(() => getComputedStyle(document.querySelector('#mini .card')).backgroundImage);
  assert.match(card, /rgb\(58, 63, 73\)/, 'dark window');
  await h.shell.evaluate(() => window.player.setTheme('modern'));
  await h.until(async () => (await size()) === '[420,158]', { message: 'back to Actuel' });
  for (const part of ['.lcd', '.island-toggle', '.lower-toggle', '.time.remaining'])
    assert.equal(await visible(`#mini ${part}`), false, part);
  assert.ok(await visible('#mini .upnext'), 'up next back');
});

test('settings: the two Argent skins are offered', async () => {
  const settings = await h.settings('player');
  const names = await settings.$$eval('.theme-card .name', cards => cards.map(c => c.textContent));
  assert.ok(names.includes('Argent') && names.includes('Argent sombre'), names.join(', '));
  assert.ok((await settings.$$eval('.theme-card .size', cards => cards.map(c => c.textContent))).includes('400 × 180'));
});

test('island: its own look (Argent, Argent sombre), apart from the mini-player skin', async () => {
  await h.shell.evaluate(() => window.player.updateSettings({ island: { mode: 'always', look: 'argent-sombre' } }));
  const island = await h.island();
  await h.until(async () => (await island.evaluate(() => document.body.dataset.look)) === 'argent-sombre', {
    message: 'dark Argent island',
  });
  assert.match(
    await island.evaluate(() => getComputedStyle(document.querySelector('#island')).backgroundImage),
    /rgb\(58, 63, 73\)/,
    'silver-dark pill',
  );
  assert.equal(
    await island.evaluate(() => getComputedStyle(document.querySelector('.compact .art')).borderRadius),
    '50%',
  );
  // The mini-player keeps its own skin.
  assert.equal(await h.shell.getAttribute('body', 'data-theme'), 'modern');
  await h.shell.evaluate(() => window.player.updateSettings({ island: { look: 'default', mode: 'off' } }));
  await h.until(async () => (await island.evaluate(() => document.body.dataset.look)) === 'default', {
    message: 'standard look',
  });
});
