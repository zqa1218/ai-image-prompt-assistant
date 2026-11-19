import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const root = path.resolve(import.meta.dirname, '..');
const executable = path.resolve(root, process.argv[2] ?? 'release/installed-041/win-unpacked/提示词助手 0.4.1 工作台版.exe');
const testRoot = path.join(root, '.test-output', `installed-package-${crypto.randomUUID()}`);
fs.mkdirSync(testRoot, { recursive: true });
const original = path.join(process.env.APPDATA, 'PromptWizard/bridge.json');
const hash = file => fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null;
const before = hash(original);
const child = spawn(executable, [], { env: { ...process.env, PW041_SMOKE: '1', PW041_TEST_ROOT: testRoot, PW041_PORT: '8892' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; child.stdout.on('data', chunk => log += chunk); child.stderr.on('data', chunk => log += chunk);
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => { child.kill(); reject(new Error(`打包验收超时：${log}`)); }, 45000);
  child.once('error', error => { clearTimeout(timer); reject(error); });
  child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`退出码 ${code}: ${log}`)); });
});
// A portable launcher's own process can exit before its extracted child.
for (let count = 0; count < 450 && !fs.existsSync(path.join(testRoot, 'passed.json')); count++) await new Promise(resolve => setTimeout(resolve, 100));
assert.ok(fs.existsSync(path.join(testRoot, 'passed.json')), `缺少验收结果：${log}`);
for (let count = 0; count < 50 && fs.existsSync(path.join(testRoot, 'bridge/connector.json')); count++) await new Promise(resolve => setTimeout(resolve, 100));
assert.equal(fs.existsSync(path.join(testRoot, 'bridge/connector.json')), false, '退出清理 connector');
assert.equal(fs.existsSync(path.join(testRoot, 'bridge/bridge.json')), false, '退出清理 PS bridge');
assert.equal(hash(original), before, '原安装版桥文件保持不变');
console.log(fs.readFileSync(path.join(testRoot, 'passed.json'), 'utf8'));
console.log('打包态 IPC 导入、两种目标、图片、参数、重复导入、准确选中任务及退出清理通过。');
