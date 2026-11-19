import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWorkbenchServer } from '../packages/http/server.mjs';
import { makeDraft } from '../packages/core/draft.mjs';
import { imageInfo, saveImage } from '../packages/storage/assets.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

async function setup(t, withContext = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-place-api-'));
  const calls = [];
  const bridge = {
    status: () => ({ connected: true, mode: 'uxp', sessionId: 'session_api_1', capabilities: ['documents', 'capture', 'place'] }),
    listDocuments: async () => [],
    place: async request => { calls.push(request); return { layerId: 99, layerName: request.layerName, placement: request.placement }; },
    close() {},
  };
  const app = createWorkbenchServer({ dataRoot: root, port: 0, photoshopBridge: bridge }); await app.ready;
  t.after(async () => { await app.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const input = makeDraft('place me'); input.settings.modelVersion = '8.2';
  if (withContext) {
    const capture = saveImage(root, { ...imageInfo(png), data: png });
    input.references = [{ ...capture, assetId: 'capture_1', role: 'image_prompt', source: 'photoshop', analysisOnly: false }];
    input.photoshopContext = { sessionId: 'session_api_1', documentId: 10, documentName: 'target.psd', canvasWidth: 100, canvasHeight: 80, captureAssetId: 'capture_1', captureScope: 'selection', selectionBounds: { left: 10, top: 10, right: 90, bottom: 70 }, maskAssetId: null, placement: 'fit_selection' };
  }
  let task = app.store.create(input); app.store.confirm(task.taskId, 1, { promptReviewed: true, settingsReviewed: true, referencesReviewed: true });
  const run = app.store.recordSubmission(task.taskId, 1, 'submission_1');
  const resultImage = saveImage(root, { ...imageInfo(png), data: png });
  const [result] = app.store.importStoredResults(task.taskId, 1, run.runId, [{ sha256: resultImage.sha256, originalName: 'result.png' }]);
  const meta = await (await fetch(`${app.url}/api/meta`)).json();
  return { app, calls, taskId: task.taskId, result, csrf: meta.csrfToken };
}

async function place(fixture, body, key = body.requestId) {
  return fetch(`${fixture.app.url}/api/tasks/${fixture.taskId}/results/${fixture.result.resultId}/place`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-workbench-csrf': fixture.csrf, 'idempotency-key': key }, body: JSON.stringify(body),
  });
}

test('workbench places an owned result with exact revision/context and durable idempotency', async t => {
  const fixture = await setup(t);
  const body = { revision: 1, requestId: 'place_api_request_1', placement: 'fit_selection' };
  const first = await place(fixture, body); assert.equal(first.status, 200);
  const payload = await first.json(); assert.equal(payload.placement.layerId, 99);
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.calls[0].context.documentId, 10);
  assert.match(fixture.calls[0].dataUrl, /^data:image\/png;base64,/);
  const replay = await place(fixture, body); assert.equal(replay.headers.get('idempotency-replayed'), 'true');
  assert.equal(fixture.calls.length, 1);
  const conflict = await place(fixture, { ...body, placement: 'fit_canvas' }); assert.equal(conflict.status, 409);
});

test('task without Photoshop provenance may only open a result as a new document', async t => {
  const fixture = await setup(t, false);
  let response = await place(fixture, { revision: 1, requestId: 'place_api_request_2', placement: 'fit_canvas' });
  assert.equal(response.status, 400); assert.equal(fixture.calls.length, 0);
  response = await place(fixture, { revision: 1, requestId: 'place_api_request_3', placement: 'new_document' });
  assert.equal(response.status, 200); assert.equal(fixture.calls.length, 1);
});
