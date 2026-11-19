import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const compat = path.join(root, 'apps/prompt-wizard-compat');
test('compatibility package cannot use the old frontend build or auto-install the old PS plugin', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(compat, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '0.4.1-integration.1'); assert.equal(pkg.private, true);
  assert.match(pkg.main, /guard-compat-build/);
  const guard = spawnSync(process.execPath, ['scripts/guard-compat-build.mjs'], { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(guard.status, 1); assert.match(guard.stderr, /0.3.4/);
});
test('0.4.1 runtime files and frontend bundle match imported baseline', t => {
  const manifestFile = path.join(root, 'baselines/manifest.json');
  if (!fs.existsSync(manifestFile)) return t.skip('Private local baseline is not in Git; use baseline:import on the original machine.');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const prefix = 'prompt-wizard-runtime-0.4.1/';
  for (const file of manifest.files.filter(x => x.path.startsWith(prefix) && x.path !== prefix + 'package.json')) {
    const bytes = fs.readFileSync(path.join(compat, file.path.slice(prefix.length)));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), file.sha256, file.path);
  }
});
test('isolated compatibility preview serves health and original frontend without touching installed bridge', { timeout: 15000 }, async t => {
  const parent = path.join(root, '.test-output'); fs.mkdirSync(parent, { recursive: true });
  const temporary = fs.mkdtempSync(path.join(parent, 'compat-'));
  const child = spawn(process.execPath, ['scripts/prompt-wizard-preview.mjs'], {
    cwd: root, env: { ...process.env, WORKBENCH_PREVIEW_DIR: temporary }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
  const closed = new Promise(resolve => child.once('close', resolve));
  t.after(async () => {
    child.kill(); await closed;
    assert.ok(temporary.startsWith(parent + path.sep)); fs.rmSync(temporary, { recursive: true, force: true });
  });
  const startedAt = Date.now();
  while (!stdout.includes('服务已启动')) {
    assert.ok(child.exitCode === null, `Preview exited: ${stderr}`);
    assert.ok(Date.now() - startedAt < 8000, `Preview startup timeout: ${stderr}`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const health = await fetch('http://127.0.0.1:8878/api/health'); assert.deepEqual(await health.json(), { ok: true });
  const home = await fetch('http://127.0.0.1:8878/'); assert.equal(home.status, 200);
  const html = await home.text(); const bundlePath = html.match(/src="([^"]+\.js)"/)[1];
  const bundle = await fetch(new URL(bundlePath, 'http://127.0.0.1:8878')); assert.equal(bundle.status, 200);
  assert.ok((await bundle.text()).length > 100000);
  const bridge = JSON.parse(fs.readFileSync(path.join(temporary, 'bridge/bridge.json'), 'utf8'));
  assert.equal(bridge.port, 8878); assert.equal(bridge.host, '127.0.0.1');
  const foreign = await fetch('http://127.0.0.1:8878/api/health', { headers: { Origin: 'https://untrusted.example' } }); assert.equal(foreign.status, 403);
});
