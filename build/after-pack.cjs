// electron-builder afterPack hook: writes resources/integrity.json, the list of
// the packaged files with their sizes. At startup the app checks it to detect
// files removed or altered after installation (e.g. quarantined by an antivirus).
const { readdirSync, statSync, writeFileSync } = require('node:fs');
const { join, relative, sep } = require('node:path');

const MANIFEST = join('resources', 'integrity.json');

function walk(root, directory = root, files = {}) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(root, path, files);
    else if (entry.isFile()) {
      const name = relative(root, path).split(sep).join('/');
      if (name !== MANIFEST.split(sep).join('/')) files[name] = statSync(path).size;
    }
  }
  return files;
}

exports.default = async function afterPack(context) {
  const files = walk(context.appOutDir);
  writeFileSync(join(context.appOutDir, MANIFEST), JSON.stringify({ version: 1, files }));
  console.log(`  • integrity manifest  files=${Object.keys(files).length}`);
};
