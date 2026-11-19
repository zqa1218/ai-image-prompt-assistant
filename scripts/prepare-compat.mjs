import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
execFileSync(process.execPath, [path.join(root, 'scripts/import-baselines.mjs'), '--verify'], { stdio: 'inherit' });
const source = path.join(root, 'baselines/prompt-wizard-runtime-0.4.1');
const destination = path.join(root, 'apps/prompt-wizard-compat');
if (fs.existsSync(destination)) throw new Error('Compatibility copy already exists; never overwrite local changes.');
fs.cpSync(source, destination, { recursive: true, errorOnExist: true, force: false });
const manifest = JSON.parse(fs.readFileSync(path.join(destination, 'package.json'), 'utf8'));
manifest.name = 'prompt-wizard-compat';
manifest.version = '0.4.1-integration.1';
manifest.private = true;
manifest.dependencies.ws = '8.22.2';
manifest.scripts = { build: 'node ../../scripts/guard-compat-build.mjs', preview: 'node ../../scripts/prompt-wizard-preview.mjs' };
// Prevent a direct Electron invocation from auto-installing the old bridge into the user's PS profile.
manifest.main = '../../scripts/guard-compat-build.mjs';
fs.writeFileSync(path.join(destination, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('Compatibility runtime prepared. Frontend remains the original 0.4.1 bundle; no legacy React build is permitted.');
