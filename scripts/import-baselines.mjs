// Read-only at the three source locations. Destinations are isolated snapshots.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = path.join(root, 'baselines');
const manifestFile = path.join(destination, 'manifest.json');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sources = {
  installed: 'C:/Users/MECHREVO/AppData/Local/Programs/prompt-wizard/resources',
  source: 'C:/Users/MECHREVO/Documents/ChatGPT/修图小助手/ai-image-prompt-assistant',
  mj: 'C:/Users/MECHREVO/Desktop/MJStudio',
};
function target(relative) {
  const result = path.resolve(destination, relative);
  if (!result.startsWith(destination + path.sep)) throw new Error('Unsafe snapshot path');
  return result;
}
if (process.argv.includes('--verify')) {
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  for (const file of manifest.files) {
    if (hash(fs.readFileSync(target(file.path))) !== file.sha256) throw new Error(`Snapshot changed: ${file.path}`);
  }
  console.log(`Verified ${manifest.files.length} baseline files. Source applications were not changed.`);
  process.exit(0);
}
if (fs.existsSync(manifestFile)) throw new Error('Baseline already exists. Use baseline:verify; never silently overwrite a baseline.');
const files = [];
function put(relative, bytes, origin) {
  const output = target(relative);
  if (fs.existsSync(output) && hash(fs.readFileSync(output)) !== hash(bytes)) throw new Error(`Refuse overwrite: ${relative}`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  if (!fs.existsSync(output)) fs.writeFileSync(output, bytes, { flag: 'wx' });
  files.push({ path: relative.replaceAll('\\', '/'), bytes: bytes.length, sha256: hash(bytes), origin });
}
function copyTree(source, relative) {
  if (!fs.existsSync(source)) return;
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error(`Symlink not copied: ${source}/${entry.name}`);
    if (entry.isDirectory()) copyTree(path.join(source, entry.name), `${relative}/${entry.name}`);
    else if (entry.isFile()) put(`${relative}/${entry.name}`, fs.readFileSync(path.join(source, entry.name)), path.join(source, entry.name));
  }
}

const asarPath = path.join(sources.installed, 'app.asar');
const archive = fs.readFileSync(asarPath);
const headerSize = archive.readUInt32LE(4);
const jsonSize = archive.readUInt32LE(12);
const header = JSON.parse(archive.subarray(16, 16 + jsonSize).toString('utf8'));
const installedText = new Map();
function extract(tree, prefix = '') {
  for (const [name, entry] of Object.entries(tree.files)) {
    const relative = prefix + name;
    if (relative === 'node_modules') continue;
    if (entry.files) extract(entry, relative + '/');
    else {
      if (entry.link) throw new Error(`ASAR links unsupported: ${relative}`);
      const bytes = entry.unpacked
        ? fs.readFileSync(path.join(sources.installed, 'app.asar.unpacked', relative))
        : archive.subarray(8 + headerSize + Number(entry.offset), 8 + headerSize + Number(entry.offset) + entry.size);
      if (bytes.length !== entry.size) throw new Error(`ASAR entry truncated: ${relative}`);
      put(`prompt-wizard-runtime-0.4.1/${relative}`, bytes, `app.asar:${relative}`);
      if (/^(server|electron)\/.*\.(mjs|cjs|ps1|jsx)$/.test(relative)) installedText.set(relative, bytes.toString('utf8'));
    }
  }
}
extract(header);
copyTree(path.join(sources.installed, 'photoshop-plugin'), 'prompt-wizard-runtime-0.4.1/photoshop-plugin');
const sourceRootFiles = ['package.json', 'package-lock.json', 'README.md', 'index.html', 'tsconfig.json', 'vite.config.ts', 'vitest.config.ts', '.gitignore'];
for (const name of sourceRootFiles) {
  const source = path.join(sources.source, name);
  if (fs.existsSync(source)) put(`prompt-wizard-source-0.3.4/${name}`, fs.readFileSync(source), source);
}
for (const name of ['src', 'server', 'electron', 'scripts', 'photoshop-plugin', 'assets', 'public', 'docs']) {
  copyTree(path.join(sources.source, name), `prompt-wizard-source-0.3.4/${name}`);
}
for (const name of ['mj_studio.py', 'ps_bridge.py', 'start.bat']) {
  put(`mjstudio-original/${name}`, fs.readFileSync(path.join(sources.mj, name)), path.join(sources.mj, name));
}
for (const name of ['ui', 'tools']) copyTree(path.join(sources.mj, name), `mjstudio-original/${name}`);
const normalize = text => text.replaceAll('\r\n', '\n');
const differences = [...installedText].map(([name, content]) => {
  const file = path.join(sources.source, name);
  return { path: name, status: !fs.existsSync(file) ? 'installed-only' : normalize(fs.readFileSync(file, 'utf8')) === normalize(content) ? 'identical' : 'different' };
});
const installedPackage = JSON.parse(fs.readFileSync(target('prompt-wizard-runtime-0.4.1/package.json'), 'utf8'));
const sourcePackage = JSON.parse(fs.readFileSync(target('prompt-wizard-source-0.3.4/package.json'), 'utf8'));
if (installedPackage.version !== '0.4.1' || sourcePackage.version !== '0.3.4') throw new Error('Versions changed; revise the reconciliation plan.');
const dirtyStatus = execFileSync('git', ['-C', sources.source, 'status', '--short'], { encoding: 'utf8' });
const manifest = {
  importedAt: new Date().toISOString(), sources,
  versions: { installed: installedPackage.version, editableSource: sourcePackage.version, integration: '0.1.0-dev.1' },
  archiveSha256: hash(archive), sourceWorkingTreeStatus: dirtyStatus,
  frontendSourceRecovered: false, differences, files,
};
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ versions: manifest.versions, files: files.length, differences: differences.filter(x => x.status !== 'identical'), sourceWorkingTreeStatus: dirtyStatus }, null, 2));
