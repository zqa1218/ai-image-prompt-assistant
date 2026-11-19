import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TaskStore, taskStatus, renameWithRetry } from '../packages/storage/store.mjs';
import { makeDraft } from '../packages/core/draft.mjs';
import { validateInput } from '../packages/core/validation.mjs';
import { imageInfo, readImage } from '../packages/storage/assets.mjs';

const testParent = fileURLToPath(new URL('../.test-output/', import.meta.url));
fs.mkdirSync(testParent, { recursive: true });
const reviews = { promptReviewed: true, settingsReviewed: true, referencesReviewed: true };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const errorCode = code => error => error.code === code;
function setup(t) {
  const root = fs.mkdtempSync(path.join(testParent, 'store-'));
  t.after(() => {
    assert.ok(path.resolve(root).startsWith(path.resolve(testParent) + path.sep));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const store = new TaskStore(path.join(root, 'db'));
  const draft = makeDraft('A forest');
  const task = store.create(draft);
  const image = path.join(root, 'result.png'); fs.writeFileSync(image, png);
  return { root, store, draft, task, image };
}
function submitted(store, task, key = 'submit_1') {
  store.confirm(task.taskId, 1, reviews);
  return store.recordSubmission(task.taskId, 1, key);
}
function withAsset(draft, file) {
  const info = readImage(file);
  const { data, extension, ...meta } = info;
  draft.references = [{ assetId: 'ref_1', path: 'assets/input.png', role: 'image_prompt', source: 'upload', analysisOnly: false, ...meta }];
  return draft;
}

test('transient Windows rename errors are retried before export fails', () => {
  let attempts = 0;
  renameWithRetry('staging', 'final', () => {
    attempts += 1;
    if (attempts < 3) throw Object.assign(new Error('temporarily busy'), { code: 'EPERM' });
  });
  assert.equal(attempts, 3);
  assert.throws(() => renameWithRetry('staging', 'final', () => {
    throw Object.assign(new Error('destination exists'), { code: 'EEXIST' });
  }), errorCode('EEXIST'));
});
test('create persists and a new process instance recovers state', t => {
  const { store, task } = setup(t);
  assert.equal(taskStatus(task), 'draft'); assert.deepEqual(new TaskStore(store.root).get(task.taskId), task);
});
test('three explicit reviews required; handoff requires confirmation', t => {
  const { store, task } = setup(t);
  assert.throws(() => store.handoff(task.taskId, 1), errorCode('CONFIRMATION_REQUIRED'));
  assert.throws(() => store.confirm(task.taskId, 1, { ...reviews, referencesReviewed: false }), errorCode('REVIEW_REQUIRED'));
});
test('handoff does not create a remote run or pretend it submitted', t => {
  const { store, task } = setup(t); store.confirm(task.taskId, 1, reviews);
  assert.equal(store.handoff(task.taskId, 1).state, 'ready_for_web'); assert.equal(store.get(task.taskId).runs.length, 0);
});
test('editing a confirmed task creates immutable revision and invalidates latest confirmation', t => {
  const { store, task } = setup(t); const confirmed = store.confirm(task.taskId, 1, reviews);
  const next = structuredClone(confirmed); next.prompt.text = 'Another forest';
  const updated = store.revise(task.taskId, 1, next);
  assert.equal(updated.head, 2); assert.equal(updated.revisions[1].confirmation, null); assert.deepEqual(updated.revisions[0], confirmed);
  assert.equal(taskStatus(updated), 'draft'); assert.throws(() => store.handoff(task.taskId, 1), errorCode('REVISION_CONFLICT'));
  assert.throws(() => store.revise(task.taskId, 1, next), errorCode('REVISION_CONFLICT'));
});
test('recorded submissions are idempotent, distinct keys create distinct runs', t => {
  const { store, task } = setup(t); const run = submitted(store, task);
  assert.deepEqual(store.recordSubmission(task.taskId, 1, 'submit_1'), run);
  const second = store.recordSubmission(task.taskId, 1, 'submit_2'); assert.notEqual(second.runId, run.runId);
  assert.equal(store.get(task.taskId).runs.length, 2);
  assert.throws(() => store.recordSubmission(task.taskId, 1, 'submit_1', 'https://www.midjourney.com/imagine'), errorCode('REQUEST_KEY_CONFLICT'));
});
test('submission URL is validated and not fetched', t => {
  const { store, task } = setup(t); store.confirm(task.taskId, 1, reviews);
  for (const url of ['file:///C:/secret', 'https://midjourney.com.evil.test/', 'https://user:pass@midjourney.com/', 'javascript:alert(1)']) assert.throws(() => store.recordSubmission(task.taskId, 1, 'one', url), errorCode('INVALID_URL'));
});
test('results require exact task, revision and run; duplicates within run are idempotent', t => {
  const { store, task, image } = setup(t); const run = submitted(store, task);
  assert.throws(() => store.importResults(task.taskId, 2, run.runId, [image]), errorCode('RUN_MISMATCH'));
  assert.throws(() => store.importResults(task.taskId, 1, 'missing', [image]), errorCode('RUN_MISMATCH'));
  const [result] = store.importResults(task.taskId, 1, run.runId, [image]);
  assert.equal(result.selected, false); assert.equal(store.importResults(task.taskId, 1, run.runId, [image])[0].resultId, result.resultId);
  assert.equal(taskStatus(store.get(task.taskId)), 'results_imported'); assert.equal(store.get(task.taskId).results.length, 1);
});
test('old run remains importable after draft changes, but does not change new draft status', t => {
  const { store, task, draft, image } = setup(t); const run = submitted(store, task);
  store.revise(task.taskId, 1, draft);
  store.importResults(task.taskId, 1, run.runId, [image]);
  assert.equal(taskStatus(store.get(task.taskId)), 'draft');
});
test('same content in two runs keeps distinct result ownership', t => {
  const { store, task, image } = setup(t); const a = submitted(store, task); const b = store.recordSubmission(task.taskId, 1, 'second');
  const [first] = store.importResults(task.taskId, 1, a.runId, [image]); const [second] = store.importResults(task.taskId, 1, b.runId, [image]);
  assert.equal(first.path, second.path); assert.notEqual(first.resultId, second.resultId);
});
test('batch with an invalid image adds no result records and preserves state', t => {
  const { store, task, image, root } = setup(t); const run = submitted(store, task);
  const bad = path.join(root, 'bad.png'); fs.writeFileSync(bad, 'not a PNG');
  assert.throws(() => store.importResults(task.taskId, 1, run.runId, [image, bad]), errorCode('INVALID_IMAGE'));
  assert.equal(store.get(task.taskId).results.length, 0); assert.equal(taskStatus(store.get(task.taskId)), 'submitted_by_user');
});
test('per-image selection and bundle export include exactly selected results', t => {
  const { store, task, image, root } = setup(t); const run = submitted(store, task);
  const [result] = store.importResults(task.taskId, 1, run.runId, [image]);
  assert.throws(() => store.export(task.taskId, 1, path.join(root, 'out'), { runId: run.runId }), errorCode('NO_SELECTION'));
  store.select(task.taskId, result.resultId, true);
  const out = store.export(task.taskId, 1, path.join(root, 'out'), { runId: run.runId });
  assert.equal(out.resultCount, 1); assert.deepEqual(fs.readFileSync(path.join(out.directory, result.path)), png);
  assert.equal(JSON.parse(fs.readFileSync(path.join(out.directory, 'results.json'), 'utf8')).results[0].resultId, result.resultId);
  assert.throws(() => store.export(task.taskId, 1, out.directory), errorCode('OUTPUT_EXISTS'));
});
test('prompt-only export works before confirmation and never falsely claims included assets', t => {
  const { store, task, root } = setup(t); const out = store.export(task.taskId, 1, path.join(root, 'text'), { promptOnly: true });
  const exported = JSON.parse(fs.readFileSync(path.join(out.directory, 'prompt-export.json'), 'utf8'));
  assert.equal(exported.referencesIncluded, false); assert.equal(fs.existsSync(path.join(out.directory, 'job.json')), false);
  assert.equal(fs.existsSync(path.join(out.directory, 'assets')), false);
});
test('Banana stays usable as a draft, but cannot submit or use MJ handoff', t => {
  const { store } = setup(t); const task = store.create(makeDraft('Improve fabric', 'banana_api'));
  store.confirm(task.taskId, 1, reviews); assert.equal(taskStatus(store.get(task.taskId)), 'confirmed_api_unavailable');
  assert.throws(() => store.handoff(task.taskId, 1), errorCode('WRONG_MODE'));
  assert.throws(() => store.submitBanana(), errorCode('BANANA_NOT_CONFIGURED'));
});
test('asset import checks hash and stores immutable content-addressed files', t => {
  const { store, root, image } = setup(t); fs.mkdirSync(path.join(root, 'assets')); fs.copyFileSync(image, path.join(root, 'assets/input.png'));
  const draft = withAsset(makeDraft('Ref forest'), image);
  const task = store.create(draft, root); assert.match(task.revisions[0].references[0].path, /^assets\/[a-f0-9]{64}\.png$/);
  const bad = structuredClone(draft); bad.taskId = 'bad_hash'; bad.references[0].sha256 = '0'.repeat(64);
  assert.throws(() => store.create(bad, root), errorCode('ASSET_HASH_MISMATCH'));
});
test('asset tampering prevents handoff and selected result export', t => {
  const { store, task, image, root } = setup(t); const run = submitted(store, task);
  const [result] = store.importResults(task.taskId, 1, run.runId, [image]); store.select(task.taskId, result.resultId, true);
  fs.writeFileSync(path.join(store.root, result.path), 'corrupted');
  assert.throws(() => store.export(task.taskId, 1, path.join(root, 'out'), { runId: run.runId }), errorCode('INVALID_IMAGE'));
});
test('relative path traversal and duplicate asset IDs are rejected', t => {
  const { image } = setup(t); const draft = withAsset(makeDraft('x'), image);
  draft.references[0].path = 'assets/../private.png'; assert.throws(() => validateInput(draft), errorCode('INVALID_INPUT'));
  draft.references[0].path = 'assets/input.png'; draft.references.push(structuredClone(draft.references[0]));
  assert.throws(() => validateInput(draft), errorCode('DUPLICATE_ASSET'));
});
test('PS references and bounds are checked rather than trusted', t => {
  const { image } = setup(t); const draft = withAsset(makeDraft('x'), image);
  draft.photoshopContext = { sessionId: 'ps_session', documentId: 1, documentName: 'test.psd', canvasWidth: 100, canvasHeight: 100, captureAssetId: 'ref_1', captureScope: 'selection', selectionBounds: { left: 10, top: 10, right: 80, bottom: 80 }, maskAssetId: null, placement: 'fit_selection' };
  assert.throws(() => validateInput(draft), errorCode('PS_CAPTURE_MISSING'));
  draft.references[0].source = 'photoshop'; validateInput(draft);
  draft.photoshopContext.selectionBounds.right = 101; assert.throws(() => validateInput(draft), errorCode('PS_BOUNDS_INVALID'));
});
test('active write lock prevents competing writers and is never forcibly stolen', t => {
  const { store } = setup(t); fs.writeFileSync(store.lock, JSON.stringify({ pid: process.pid }));
  assert.throws(() => store.create(makeDraft('x')), errorCode('STORE_LOCKED'));
  assert.throws(() => store.recoverLock(), errorCode('LOCK_OWNER_ALIVE'));
});
test('lock status explains leftover locks; a crashed, unreadable lock is recoverable only once stale', t => {
  const { store } = setup(t);
  assert.deepEqual(store.lockStatus(), { locked: false });
  fs.writeFileSync(store.lock, JSON.stringify({ pid: process.pid }));
  assert.equal(store.lockStatus().ownerAlive, true); assert.equal(store.lockStatus().recoverable, false);
  fs.writeFileSync(store.lock, '');
  assert.equal(store.lockStatus().recoverable, false);
  assert.throws(() => store.recoverLock(), errorCode('LOCK_INVALID'));
  const old = new Date(Date.now() - 120000); fs.utimesSync(store.lock, old, old);
  assert.equal(store.lockStatus().recoverable, true);
  assert.deepEqual(store.recoverLock(), { recovered: true, previousPid: null });
  store.create(makeDraft('after recovery'));
});
test('corrupt database is preserved, not silently reset', t => {
  const { store } = setup(t); fs.writeFileSync(store.file, '{broken');
  assert.throws(() => store.read(), errorCode('STORE_CORRUPTED'));
  assert.throws(() => store.create(makeDraft('x')), errorCode('STORE_CORRUPTED'));
  assert.equal(fs.readFileSync(store.file, 'utf8'), '{broken'); assert.equal(fs.existsSync(store.lock), false);
});
test('previous transaction backup remains valid', t => {
  const { store, task } = setup(t); store.confirm(task.taskId, 1, reviews);
  const backup = JSON.parse(fs.readFileSync(path.join(store.root, 'tasks.previous.json'), 'utf8'));
  assert.equal(backup.tasks[0].revisions[0].confirmation, null);
});
test('image header parser rejects arbitrary files and impossible dimensions', () => {
  assert.equal(imageInfo(png).width, 1); assert.throws(() => imageInfo(Buffer.from('fake')), errorCode('INVALID_IMAGE'));
  const big = Buffer.from(png); big.writeUInt32BE(100000, 16); big.writeUInt32BE(100000, 20);
  assert.throws(() => imageInfo(big), errorCode('INVALID_IMAGE'));
});
test('package directory junction cannot escape its asset root', t => {
  const { root, store, image } = setup(t);
  const input = path.join(root, 'package'), outside = path.join(root, 'outside');
  fs.mkdirSync(input); fs.mkdirSync(outside); fs.copyFileSync(image, path.join(outside, 'input.png'));
  fs.symlinkSync(outside, path.join(input, 'assets'), process.platform === 'win32' ? 'junction' : 'dir');
  const draft = withAsset(makeDraft('escaped'), image);
  assert.throws(() => store.create(draft, input), errorCode('UNSAFE_PATH'));
});
test('external confirmation is cleared on package import', t => {
  const { store } = setup(t); const draft = makeDraft('External confirmed');
  draft.confirmation = { revision: 1, confirmedAt: new Date().toISOString(), ...reviews };
  assert.equal(store.create(draft).revisions[0].confirmation, null);
});
test('missing primary with a surviving backup does not become an empty database', t => {
  const { store, task } = setup(t); store.confirm(task.taskId, 1, reviews);
  fs.renameSync(store.file, path.join(store.root, 'tasks.interrupted.json'));
  assert.throws(() => store.read(), errorCode('STORE_CORRUPTED'));
});
