// Runs the end-to-end suite in a real Electron, with a virtual display on Linux.
import { spawnSync } from 'node:child_process';
const args = ['--test', '--test-concurrency=1', 'test/e2e/*.test.mjs'];
const needsDisplay = process.platform === 'linux' && !process.env.DISPLAY;
const result = needsDisplay
  ? spawnSync('xvfb-run', ['-a', '-s', '-screen 0 1920x1080x24', process.execPath, ...args], { stdio: 'inherit' })
  : spawnSync(process.execPath, args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
