import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TaskStore } from '../packages/storage/store.mjs';
import { makeDraft } from '../packages/core/draft.mjs';
import { imageInfo, saveImage } from '../packages/storage/assets.mjs';
import { importExchange, exportWizardContext, validateWizardContext, mapParameterOption } from '../packages/adapters/prompt-wizard-exchange.mjs';
import { createWorkbenchServer } from '../packages/http/server.mjs';
import { sendToWorkbench } from '../apps/prompt-wizard-next/server/workbench-integration.mjs';

const parent = fileURLToPath(new URL('../.test-output/', import.meta.url));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
function temporary(t) {
  fs.mkdirSync(parent, { recursive: true }); const root = fs.mkdtempSync(path.join(parent, 'exchange-'));
  t.after(() => { assert.ok(root.startsWith(parent)); fs.rmSync(root, { recursive: true, force: true }); }); return root;
}
function exchange() {
  return { schemaVersion: 'prompt-wizard-exchange/1', workflowId: 'recompose', artifact: { prompt: '测试森林，保留光照', channel: '官网', params: ['--v 8.2 --ar 2:3 --raw --s 0 --chaos 0 --seed 0 --unknown 4'], checklist: ['人工核对'] }, context: { analysis: '从左侧入光', requirements: { requirement: '保留光照' }, direction: '方案甲', notes: ['不要加树'] }, target: null, selectedParameterIndex: null, images: [{ assetId: 'source_1', role: 'image_prompt', dataUrl }] };
}
function psDraft(store) {
  const input = makeDraft('Original'); input.settings.modelVersion = '8.2';
  const saved = saveImage(store.root, { ...imageInfo(png), data: png });
  input.references = [{ ...saved, assetId: 'ps_capture', role: 'image_prompt', source: 'photoshop', analysisOnly: false }];
  input.photoshopContext = { sessionId: 'session_1', documentId: 7, documentName: '测试.psd', canvasWidth: 20, canvasHeight: 10, captureAssetId: 'ps_capture', captureScope: 'selection', selectionBounds: { left: 5, top: 2, right: 10, bottom: 8 }, maskAssetId: null, placement: 'fit_selection' };
  return input;
}

test('exchange preserves full provenance, deduplicates assets, marks new images analysis-only and applies only selected params', t => {
  const store = new TaskStore(temporary(t)), input = exchange(); input.images.push({ ...input.images[0] });
  let task = importExchange(store, input, 'mj_web'), snapshot = task.revisions[0];
  assert.equal(snapshot.references.length, 1); assert.equal(snapshot.references[0].analysisOnly, true);
  assert.equal(snapshot.settings.modelVersion, null); assert.equal(snapshot.prompt.exchange.context.analysis, '从左侧入光');
  assert.equal(snapshot.prompt.exchange.images[0].dataUrl, undefined); assert.equal(snapshot.confirmation, null);
  input.target = { taskId: task.taskId, revision: 1 }; input.selectedParameterIndex = 0;
  task = importExchange(store, input, 'mj_web'); snapshot = task.revisions[1];
  assert.equal(task.head, 2); assert.equal(snapshot.settings.modelVersion, '8.2'); assert.equal(snapshot.settings.raw, true);
  assert.equal(snapshot.settings.stylize, 0); assert.equal(snapshot.settings.chaos, 0); assert.equal(snapshot.settings.seed, 0);
  assert.ok(snapshot.settings.websiteChecklist.some(line => line.includes('--unknown 4')));
  assert.equal(task.revisions[0].settings.modelVersion, null);
  assert.equal(new TaskStore(store.root).get(task.taskId).head, 2);
  store.export(task.taskId, 2, path.join(store.root, 'prompt'), { promptOnly: true });
  assert.equal(JSON.parse(fs.readFileSync(path.join(store.root, 'prompt/prompt-export.json'))).prompt.exchange.workflowId, 'recompose');
});

test('parameter ambiguity never silently picks a winner or treats booleans as strings', () => {
  const mapped = mapParameterOption('方案甲 --s 50 --stylize 0 --s 10 --raw true --ar 1:1 --ar 2:3 --cref https://example.invalid/a.png');
  assert.deepEqual(mapped.fields, {}); assert.ok(mapped.pending.some(line => line.includes('重复参数')));
  assert.ok(mapped.pending.some(line => line.includes('--raw true'))); assert.ok(mapped.pending.includes('方案甲'));
  assert.deepEqual(mapParameterOption('--seed 0 --raw').fields, { seed: 0, raw: true });
});

test('task round-trip retains PS context, role and production bytes; stale return cannot overwrite newer work or old results', t => {
  const store = new TaskStore(temporary(t)), input = psDraft(store); let task = store.create(input);
  store.confirm(task.taskId, 1, { promptReviewed: true, settingsReviewed: true, referencesReviewed: true });
  const run = store.recordSubmission(task.taskId, 1, 'user_submission');
  const context = exportWizardContext(store, task.taskId, 1); assert.deepEqual(validateWizardContext(context), context);
  const returned = exchange(); returned.target = { taskId: task.taskId, revision: 1 };
  returned.images = context.images.map(image => ({ ...image, role: 'image_prompt' }));
  task = importExchange(store, returned, 'mj_web');
  assert.equal(task.head, 2); assert.equal(task.revisions[1].confirmation, null);
  assert.ok(task.revisions[0].confirmation); assert.equal(task.runs[0].runId, run.runId);
  assert.deepEqual(task.revisions[1].photoshopContext, input.photoshopContext);
  assert.deepEqual(task.revisions[1].references, input.references);
  assert.throws(() => importExchange(store, returned, 'mj_web'), { code: 'REVISION_CONFLICT' });
  returned.target.revision = 2;
  assert.throws(() => importExchange(store, returned, 'banana_api'), { code: 'MODE_MISMATCH' });
  returned.images = [];
  assert.throws(() => importExchange(store, returned, 'mj_web'), { code: 'PS_CAPTURE_MISSING' });
  assert.equal(store.get(task.taskId).head, 2);
});

test('exchange rejects invalid options, duplicate IDs with conflicting content, unknown fields and bad files without task writes', t => {
  const store = new TaskStore(temporary(t));
  const invalid = exchange(); invalid.selectedParameterIndex = 2;
  assert.throws(() => importExchange(store, invalid, 'mj_web'), { code: 'INVALID_PARAMETER_OPTION' });
  const duplicate = exchange(); duplicate.images.push({ ...duplicate.images[0], role: 'base' });
  assert.throws(() => importExchange(store, duplicate, 'mj_web'), { code: 'DUPLICATE_ASSET' });
  const extra = exchange(); extra.apiKey = 'must not persist';
  assert.throws(() => importExchange(store, extra, 'mj_web'), { code: 'INVALID_EXCHANGE' });
  for (const bad of ['file:///C:/private.png', 'https://example.invalid/image.png', 'data:image/png;base64,AA==']) {
    const value = exchange(); value.images[0].dataUrl = bad;
    assert.throws(() => importExchange(store, value, 'mj_web'), { code: 'INVALID_IMAGE' });
  }
  assert.equal(store.read().tasks.length, 0); assert.equal(fs.existsSync(path.join(store.root, 'assets')), false);
});

test('context file validates hashes and asset identity before the wizard consumes it', t => {
  const store = new TaskStore(temporary(t)), task = store.create(psDraft(store));
  const context = exportWizardContext(store, task.taskId, 1);
  const tampered = structuredClone(context); tampered.snapshot.references[0].sha256 = 'a'.repeat(64);
  assert.throws(() => validateWizardContext(tampered), { code: 'ASSET_MISMATCH' });
  const missing = structuredClone(context); missing.images = [];
  assert.throws(() => validateWizardContext(missing), { code: 'INVALID_CONTEXT' });
  const returned = exchange(); returned.target = { taskId: task.taskId, revision: 1 };
  returned.images = [{ ...context.images[0], role: 'style_reference' }];
  assert.throws(() => importExchange(store, returned, 'mj_web'), { code: 'ASSET_ID_CONFLICT' });
});

test('Banana refine exchange preserves a separate base and references and stays an offline draft', t => {
  const store = new TaskStore(temporary(t)), value = exchange(); value.workflowId = 'refine';
  value.images[0].role = 'base'; value.images.push({ assetId: 'reference_2', role: 'edit_reference', dataUrl });
  const task = importExchange(store, value, 'banana_api'), snapshot = task.revisions[0];
  assert.equal(snapshot.operation, 'edit'); assert.equal(snapshot.settings.providerId, null);
  assert.deepEqual(snapshot.references.map(ref => ref.role), ['base', 'edit_reference']);
  assert.throws(() => store.submitBanana(), { code: 'BANANA_NOT_CONFIGURED' });
});

test('direct Photoshop exchange keeps an exact document fingerprint and a real selection mask', t => {
  const store = new TaskStore(temporary(t)), value = exchange();
  value.images[0].photoshop = {
    sessionId: 'session_direct_1', documentId: 27, documentName: '非零偏移.psd', canvasWidth: 1200, canvasHeight: 800,
    captureScope: 'selection', selectionBounds: { left: 200, top: 100, right: 1000, bottom: 700 },
    maskAssetId: 'source_1_selection_mask', placement: 'fit_selection',
  };
  value.images.push({ assetId: 'source_1_selection_mask', role: 'mask', dataUrl });
  const snapshot = importExchange(store, value, 'mj_web').revisions[0];
  assert.deepEqual(snapshot.photoshopContext, {
    sessionId: 'session_direct_1', documentId: 27, documentName: '非零偏移.psd', canvasWidth: 1200, canvasHeight: 800,
    captureAssetId: 'source_1', captureScope: 'selection', selectionBounds: { left: 200, top: 100, right: 1000, bottom: 700 },
    maskAssetId: 'source_1_selection_mask', placement: 'fit_selection',
  });
  assert.deepEqual(snapshot.references.map(ref => [ref.role, ref.source, ref.analysisOnly]), [
    ['image_prompt', 'photoshop', false], ['mask', 'photoshop', true],
  ]);
  assert.equal(snapshot.prompt.exchange.images[0].photoshop.documentId, 27);
  const missing = exchange(); missing.images[0].photoshop = { ...value.images[0].photoshop };
  assert.throws(() => importExchange(store, missing, 'mj_web'), { code: 'PS_MASK_MISSING' });
});

test('connector requires a private token, rejects foreign origins and replays the same request across restart', async t => {
  const root = temporary(t), connectorFile = path.join(root, 'connector.json');
  let app = createWorkbenchServer({ dataRoot: path.join(root, 'data'), port: 0, connectorFile }); await app.ready;
  t.after(async () => { if (app) await app.close(); });
  const payload = { exchange: exchange(), mode: 'mj_web', requestId: 'wizard_request_1' };
  const send = () => sendToWorkbench(payload, { file: connectorFile });
  const first = await send(), again = await send(); assert.equal(first.task.taskId, again.task.taskId);
  const meta = await (await fetch(`${app.url}/api/meta`)).json(); assert.equal(meta.integrationToken, undefined);
  const unauth = await fetch(`${app.url}/api/integrations/prompt-wizard/tasks`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-workbench-csrf': meta.csrfToken }, body: '{}' }); assert.equal(unauth.status, 403);
  const descriptor = JSON.parse(fs.readFileSync(connectorFile));
  const foreign = await fetch(`${app.url}/api/integrations/prompt-wizard/tasks`, { method: 'POST', headers: { Origin: 'https://evil.invalid', 'x-workbench-integration': descriptor.token }, body: '{}' }); assert.equal(foreign.status, 403);
  const context = await (await fetch(`${app.url}/api/tasks/${first.task.taskId}/wizard-context?revision=1`)).json(); assert.equal(context.images.length, 1);
  await app.close(); app = null; assert.equal(fs.existsSync(connectorFile), false);
  app = createWorkbenchServer({ dataRoot: path.join(root, 'data'), port: 0, connectorFile }); await app.ready;
  assert.equal((await send()).task.taskId, first.task.taskId); assert.equal(app.store.read().tasks.length, 1);
  payload.exchange.artifact.prompt = 'changed';
  await assert.rejects(send, error => error.status === 409);
  await app.close(); app = null;
});

test('connector never forwards credentials through redirects or to a non-loopback descriptor', async t => {
  const file = path.join(temporary(t), 'connector.json');
  fs.writeFileSync(file, JSON.stringify({ url: 'https://evil.invalid', token: 'x'.repeat(40) }));
  let calls = 0;
  await assert.rejects(() => sendToWorkbench({ requestId: 'unsafe_descriptor', mode: 'mj_web' }, { file, fetchImpl: async () => { calls++; } }), /不安全/); assert.equal(calls, 0);
  fs.writeFileSync(file, JSON.stringify({ url: 'http://127.0.0.1:8790', token: 'x'.repeat(40) }));
  await sendToWorkbench({ requestId: 'redirect_test', mode: 'mj_web', exchange: exchange() }, { file, fetchImpl: async (_url, options) => { assert.equal(options.redirect, 'error'); return new Response(JSON.stringify({ task: {} }), { status: 201 }); } });
});
