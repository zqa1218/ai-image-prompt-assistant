import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { PhotoshopBridge } from '../packages/photoshop/bridge.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, timeout = 2000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (check()) return; await delay(10); }
  throw new Error('condition timeout');
}

async function fixture(t, onRequest) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-bridge-'));
  const server = http.createServer((_req, res) => { res.writeHead(404); res.end(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const descriptorFile = path.join(root, 'bridge.json');
  const bridge = new PhotoshopBridge({ descriptorFile, timeoutMs: 500 }).attach(server, port);
  const descriptor = JSON.parse(fs.readFileSync(descriptorFile, 'utf8'));
  const client = new WebSocket(`ws://${descriptor.host}:${descriptor.port}${descriptor.pathname}?token=${encodeURIComponent(descriptor.token)}`);
  client.on('open', () => client.send(JSON.stringify({ type: 'pluginHello', version: '0.2.0', sessionId: 'session_test_1', capabilities: ['documents', 'capture', 'place'] })));
  client.on('message', raw => {
    const message = JSON.parse(raw.toString());
    if (message.type === 'request') void onRequest(message, value => client.send(JSON.stringify(value)));
  });
  await waitFor(() => bridge.status().connected);
  t.after(async () => {
    client.close(); bridge.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { bridge, client };
}

test('bridge authenticates a v2 plugin and coalesces overlapping document status requests', async t => {
  let requests = 0;
  const { bridge } = await fixture(t, async (message, send) => {
    requests += 1; await delay(30);
    send({ type: 'response', requestId: message.requestId, sessionId: message.sessionId, ok: true, result: [{ documentId: 1 }] });
  });
  const [left, right] = await Promise.all([bridge.listDocuments(), bridge.listDocuments()]);
  assert.deepEqual(left, [{ documentId: 1 }]);
  assert.deepEqual(right, left);
  assert.equal(requests, 1);
});

test('place requests are serialized and plugin error codes remain actionable', async t => {
  let active = 0, maximum = 0;
  const { bridge } = await fixture(t, async (message, send) => {
    active += 1; maximum = Math.max(maximum, active); await delay(20); active -= 1;
    if (message.payload.fail) send({ type: 'response', requestId: message.requestId, sessionId: message.sessionId, ok: false, error: { code: 'PS_CANVAS_CHANGED', message: '画布已变化' } });
    else send({ type: 'response', requestId: message.requestId, sessionId: message.sessionId, ok: true, result: { layerId: message.payload.number } });
  });
  const [first, second] = await Promise.all([
    bridge.place({ requestId: 'place_request_1', number: 1 }),
    bridge.place({ requestId: 'place_request_2', number: 2 }),
  ]);
  assert.deepEqual([first.layerId, second.layerId], [1, 2]);
  assert.equal(maximum, 1);
  await assert.rejects(() => bridge.place({ requestId: 'place_request_3', fail: true }), error => error.code === 'PS_CANVAS_CHANGED');
});
