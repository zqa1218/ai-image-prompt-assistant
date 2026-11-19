import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
test('CLI lifecycle works across separate processes and reports failures with nonzero exit', () => {
  const parent = path.join(root, '.test-output'); fs.mkdirSync(parent, { recursive: true });
  const temp = fs.mkdtempSync(path.join(parent, 'cli-'));
  const run = (...args) => spawnSync(process.execPath, ['apps/workbench/cli.mjs', ...args, '--store', path.join(temp, 'store')], { cwd: root, encoding: 'utf8', windowsHide: true });
  const success = (...args) => { const response = run(...args); assert.equal(response.status, 0, response.stderr); return JSON.parse(response.stdout); };
  try {
    const prompt = path.join(temp, '提示词.txt'); fs.writeFileSync(prompt, 'A calm forest');
    const task = success('new', '--prompt-file', prompt);
    assert.equal(success('list')[0].status, 'draft');
    success('confirm', task.taskId, '--revision', '1', '--prompt-reviewed', '--settings-reviewed', '--references-reviewed');
    const handoff = success('handoff', task.taskId, '--revision', '1', '--out', path.join(temp, 'handoff'));
    assert.match(fs.readFileSync(path.join(handoff.directory, 'website-checklist.txt'), 'utf8'), /亲自提交/);
    assert.equal(success('show', task.taskId).runs.length, 0);
    const runRecord = success('submitted', task.taskId, '--revision', '1', '--request-id', 'cli_submission');
    assert.equal(success('submitted', task.taskId, '--revision', '1', '--request-id', 'cli_submission').runId, runRecord.runId);
    const blocked = run('banana-submit', task.taskId); assert.equal(blocked.status, 1); assert.equal(JSON.parse(blocked.stderr).error.code, 'BANANA_NOT_CONFIGURED');
  } finally {
    assert.ok(temp.startsWith(parent + path.sep)); fs.rmSync(temp, { recursive: true, force: true });
  }
});
