// Screenshots of the five mini-player skins for the README (2x).
//   npm run build && xvfb-run -a node build/brand/readme-shots.mjs   (Linux)
import { resolve } from 'node:path';
import { launch } from '../../test/e2e/harness.mjs';

const out = resolve(import.meta.dirname, '../../docs/screenshots');
const h = await launch({ args: ['--force-device-scale-factor=2'] });
await h.ytm('__fake.start(0)');
await h.ytm('__fake.nearEnd(140)');
await h.shell.evaluate(() => window.player.window('toggle-mini'));
for (const theme of ['modern', 'autoradio', 'hifi', 'autoradio-hf', 'hifi-hf']) {
  await h.shell.evaluate(t => window.player.setTheme(t), theme);
  await new Promise(r => setTimeout(r, 900));
  await h.shell.screenshot({ path: `${out}/mini-${theme}.png`, scale: 'device' });
}
await h.close();
