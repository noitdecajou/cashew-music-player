// After the installer has been signed (which changes its bytes), recompute
// what electron-updater checks: the installer's sha512 and size in
// latest.yml, and its .blockmap (differential downloads).
// Usage: node build/update-metadata.cjs dist/MusicPlayer-Setup-1.2.3.exe dist/latest.yml
const { readFileSync, writeFileSync } = require('node:fs');
const { basename } = require('node:path');
const { buildBlockMap } = require('app-builder-lib/out/targets/blockmap/blockmap');

async function updateMetadata(installer, latestYml) {
  const { sha512, size } = await buildBlockMap(installer, 'gzip', `${installer}.blockmap`);
  const name = basename(installer);
  let yml = readFileSync(latestYml, 'utf8');
  if (!yml.includes(name)) throw new Error(`${latestYml} does not describe ${name}`);
  // Single-file NSIS metadata: every sha512/size entry describes this installer.
  yml = yml.replace(/^(\s*-?\s*sha512:\s*).*$/gm, `$1${sha512}`).replace(/^(\s*size:\s*).*$/gm, `$1${size}`);
  writeFileSync(latestYml, yml);
  return { sha512, size };
}

module.exports = { updateMetadata };

if (require.main === module) {
  const [installer, latestYml] = process.argv.slice(2);
  if (!installer || !latestYml) { console.error('usage: update-metadata.cjs <installer.exe> <latest.yml>'); process.exit(2); }
  updateMetadata(installer, latestYml).then(r => console.log(`updated ${latestYml}: size=${r.size}`), e => { console.error(e); process.exit(1); });
}
