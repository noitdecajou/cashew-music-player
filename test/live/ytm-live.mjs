// Checks the app against the REAL music.youtube.com (signed out): the player
// API, the queue store and the search response still look the way the page
// agent expects. Run weekly by .github/workflows/live-check.yml; locally:
//   npm run build && node test/live/ytm-live.mjs   (Linux: under xvfb-run)
// Writes live-report.md and exits 1 when a check fails.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const playwright = require('playwright');
const root = resolve(import.meta.dirname, '../..');
const VIDEO = 'dQw4w9WgXcQ'; // long-lived, always available
const RADIO = `RDAMVM${VIDEO}`; // gives a queue of ~50 tracks

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(read, timeout) {
  const end = Date.now() + timeout;
  let value;
  while (Date.now() < end) {
    try {
      value = await read();
      if (value) return value;
    } catch {
      /* page busy */
    }
    await sleep(250);
  }
  return value;
}

const userData = mkdtempSync(join(tmpdir(), 'mp-live-'));
// Behind an HTTP proxy (development containers), Chromium needs it explicitly.
const proxy = process.env.HTTPS_PROXY?.replace(/^https?:\/\//, '');
const app = await playwright._electron.launch({
  executablePath: require('electron'),
  args: [
    ...(process.getuid?.() === 0 || process.env.CI ? ['--no-sandbox'] : []),
    ...(proxy ? [`--proxy-server=${proxy}`] : []),
    root,
  ],
  cwd: root,
  env: { ...process.env, MP_USER_DATA: userData, MP_YTM_FIXTURE: '' },
});
const messages = [];
await app.evaluate(({ ipcMain }) => {
  globalThis.__log = [];
  ipcMain.on('ytm:message', (_e, m) => globalThis.__log.push(m));
});
const ytm = code =>
  app.evaluate(async ({ webContents }, source) => {
    const music = webContents.getAllWebContents().find(w => w.getURL().startsWith('https://music.youtube.com'));
    return music ? music.executeJavaScript(source) : null;
  }, code);
const isShell = page => page.url().includes('/renderer/index.html') && !page.url().includes('view=drawer');

try {
  const shell =
    app.windows().find(isShell) ?? (await app.waitForEvent('window', { predicate: isShell, timeout: 30000 }));
  check(
    'page agent installed in music.youtube.com',
    await until(() => ytm('window.__musicPlayerAgentInstalled === true'), 45000),
  );

  const api = await ytm(`(() => { const p = document.querySelector('#movie_player');
    return ['getPlayerState','getVideoData','getCurrentTime','getDuration','getVolume','isMuted','setVolume','mute','unMute','seekTo','playVideo','pauseVideo','getPlaylistId','addEventListener']
      .filter(name => typeof p?.[name] !== 'function'); })()`);
  check(
    'player API (#movie_player) has every method used',
    Array.isArray(api) && api.length === 0,
    api?.length ? `manquantes : ${api.join(', ')}` : '',
  );

  await ytm(`document.querySelector('ytmusic-app').dispatchEvent(new CustomEvent('yt-navigate', {bubbles: true, composed: true,
    detail: {endpoint: {watchEndpoint: {videoId: '${VIDEO}', playlistId: '${RADIO}'}}}}))`);
  const snapshot = await until(async () => {
    const log = await app.evaluate(() => globalThis.__log);
    const last = log.filter(m => m.kind === 'snapshot').at(-1)?.snapshot;
    return last?.track?.id === VIDEO && last.track.title && last.next ? last : null;
  }, 45000);
  check(
    'snapshot: track identified with its Music title',
    snapshot?.track?.title,
    snapshot ? `« ${snapshot.track.title} » — ${snapshot.track.artist}` : 'aucune carte pour la vidéo de test',
  );
  check(
    'snapshot: "up next" read from the queue',
    snapshot?.next?.title,
    snapshot?.next ? `« ${snapshot.next.title} »` : '',
  );
  check(
    'snapshot: shuffle and repeat states read',
    typeof snapshot?.shuffle === 'boolean' && typeof snapshot?.repeat === 'string',
  );
  // The like button is rendered a moment after the track: wait for a later snapshot.
  const like = await until(async () => {
    const log = await app.evaluate(() => globalThis.__log);
    const value = log.filter(m => m.kind === 'snapshot').at(-1)?.snapshot?.like;
    return ['LIKE', 'DISLIKE', 'INDIFFERENT'].includes(value) ? value : null;
  }, 15000);
  check('snapshot: like status read from the player bar', like, like ?? 'like-status absent');

  await shell.evaluate(() => window.player.command({ type: 'volume', volume: 37 }));
  check(
    'volume command reaches the player',
    await until(async () => (await ytm('document.querySelector("#movie_player").getVolume()')) === 37, 5000),
  );

  let search = null;
  try {
    search = await shell.evaluate(() => window.player.search('daft punk', 'web'));
  } catch (error) {
    search = { error: String(error) };
  }
  const songs = search?.songs ?? [];
  check(
    'search returns tracks with id, title and artist',
    songs.length >= 5 && songs.every(s => s.videoId && s.title),
    search?.error ?? `${songs.length} résultats, ex. « ${songs[0]?.title ?? '?'} » — ${songs[0]?.artist ?? '?'}`,
  );

  await shell.evaluate(() => {
    window.__queue = null;
    window.player.on('queue:state', q => {
      window.__queue = q;
    });
    window.player.window('toggle-queue');
  });
  const queue = await until(
    () => shell.evaluate(() => (window.__queue?.items?.length >= 10 ? window.__queue : null)),
    15000,
  );
  check(
    'queue store readable (≥ 10 items, current one found)',
    queue && queue.current >= 0,
    queue ? `${queue.items.length} éléments, en cours : ${queue.current}` : 'file vide ou illisible',
  );

  if (queue) {
    const target = queue.items[3];
    let jumped = null;
    try {
      await shell.evaluate(item => window.player.queue({ action: 'play', index: 3, videoId: item.videoId }), target);
      jumped = true;
    } catch (error) {
      jumped = String(error);
    }
    const id = await until(
      async () =>
        (await ytm('document.querySelector("#movie_player").getVideoData().video_id')) === target.videoId
          ? target.videoId
          : null,
      10000,
    );
    check('queue: jump to a track', jumped === true && id === target.videoId, jumped === true ? '' : jumped);

    let inserted = null;
    try {
      await shell.evaluate(() => window.player.queue({ action: 'insert-next', videoId: 'PwILkY9gRrc' }));
      inserted = true;
    } catch (error) {
      inserted = String(error);
    }
    check('queue: insert next (get_queue + ADD_ITEMS)', inserted === true, inserted === true ? '' : inserted);
  }
} catch (error) {
  check('run completed', false, String(error?.stack ?? error));
} finally {
  messages.push(...(await app.evaluate(() => globalThis.__log).catch(() => [])));
  await app.close().catch(() => {});
  rmSync(userData, { recursive: true, force: true });
}

const failed = checks.filter(c => !c.ok);
const report = [
  `# Vérification YouTube Music — ${new Date().toISOString().slice(0, 10)}`,
  '',
  failed.length
    ? `**${failed.length} vérification(s) en échec** : YouTube Music a probablement changé ce dont l’app dépend (voir docs/ytm-bridge.md).`
    : 'Tout fonctionne.',
  '',
  ...checks.map(c => `- ${c.ok ? '✅' : '❌'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`),
  '',
].join('\n');
writeFileSync(join(root, 'live-report.md'), report);
process.exit(failed.length ? 1 : 0);
