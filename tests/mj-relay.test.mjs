import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { MjRelay, MjRelaySettings, matchNewJob, downloadShots, jobIdFromUrl } from '../packages/adapters/mj-relay.mjs';
import { TaskStore } from '../packages/storage/store.mjs';
import { createInstalledExchange } from '../integrations/prompt-wizard-041/exchange.mjs';
import { importExchange } from '../packages/adapters/prompt-wizard-exchange.mjs';
const urlA = 'https://www.midjourney.com/jobs/75ef8258-3055-4ac3-885b-09cac9e00440';
const urlB = urlA.slice(0,-1) + '1';
test('job binding excludes old jobs, ambiguity and unrelated domains', () => {
  const jobs = [urlA,urlB].map(url => ({url,text:'Quiet garden --ar 2:3'}));
  assert.equal(matchNewJob(new Set(), jobs, 'quiet Garden --ar 2:3'), null);
  assert.equal(matchNewJob(new Set([urlA]), jobs, 'quiet garden'), urlB);
  assert.equal(matchNewJob(new Set(), [{url:urlA,text:'Quiet garden in snow'}], 'quiet garden'), null);
  assert.equal(jobIdFromUrl(urlA.replace('www.midjourney.com', 'example.org')), null);
});
test('grid collection retries pending and stops on denial', async () => {
  let calls = 0;
  await assert.rejects(downloadShots(urlA, async (url, options) => {
    assert.equal(options.credentials, 'omit');
    return new Response(null, {status: ++calls === 1 ? 404 : 403});
  }, () => assert.fail(), async () => {}), /403/);
  assert.equal(calls,2);
});
test('unknown submit outcome survives restart; confirmed wizard flags remain intact', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-submit-'));
  t.after(() => fs.rmSync(dir,{recursive:true,force:true}));
  const store = new TaskStore(dir);
  const artifact = {prompt:'quiet garden --ar 2:3 --no haze', channel:'MJ'};
  const exchange = createInstalledExchange({taskId:'source',workflowId:'recompose',artifact}, artifact);
  const task = importExchange(store, exchange, 'mj_web');
  store.confirm(task.taskId,1,{promptReviewed:true,settingsReviewed:true,referencesReviewed:true});
  let calls = 0;
  const browser = { async submit(prompt, snapshot, mark) { assert.equal(prompt,artifact.prompt); mark(); calls++; throw Error('unknown outcome'); }};
  await assert.rejects(new MjRelay(store,browser).generate(task.taskId,1), /unknown outcome/);
  await assert.rejects(new MjRelay(store,browser).generate(task.taskId,1), /未核实/);
  assert.equal(calls,1);
  assert.equal(store.get(task.taskId).runs.length,0);
});

test('auto-submit stays off unless explicitly enabled, and unreadable settings mean off', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-settings-'));
  t.after(() => fs.rmSync(dir,{recursive:true,force:true}));
  const file = path.join(dir, 'mj-relay-settings.json');
  const settings = new MjRelaySettings(file);
  assert.deepEqual(settings.read(), {autoSubmit:false, acknowledgedAt:null});
  fs.writeFileSync(file, '{broken'); assert.equal(settings.read().autoSubmit, false);
  fs.writeFileSync(file, JSON.stringify({autoSubmit:'yes'})); assert.equal(settings.read().autoSubmit, false);
  fs.writeFileSync(file, JSON.stringify({autoSubmit:true})); assert.equal(settings.read().autoSubmit, false, 'needs an acknowledgement time');
  assert.equal(settings.setAutoSubmit(true).autoSubmit, true); assert.equal(settings.read().autoSubmit, true);
  assert.ok(settings.read().acknowledgedAt);
  assert.deepEqual(settings.setAutoSubmit(false), {autoSubmit:false, acknowledgedAt:null});
  assert.deepEqual(fs.readdirSync(dir), ['mj-relay-settings.json']);
});

test('relay passes the auto-submit choice to the browser and an unverified send can be cleared after checking', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mj-pending-'));
  t.after(() => fs.rmSync(dir,{recursive:true,force:true}));
  const store = new TaskStore(path.join(dir, 'store'));
  const artifact = {prompt:'quiet garden', channel:'MJ'};
  const exchange = createInstalledExchange({taskId:'source',workflowId:'recompose',artifact}, artifact);
  const task = importExchange(store, exchange, 'mj_web');
  store.confirm(task.taskId,1,{promptReviewed:true,settingsReviewed:true,referencesReviewed:true});
  const settings = new MjRelaySettings(path.join(dir, 'settings.json'));
  const seen = [];
  const browser = { async submit(prompt, snapshot, mark, options) { seen.push(options.autoSubmit); mark(); throw Error('lost'); }};
  const relay = new MjRelay(store, browser, settings);
  assert.equal(relay.pendingAttempt(task.taskId, 1), null);
  await assert.rejects(relay.generate(task.taskId,1), /lost/);
  const pending = relay.pendingAttempt(task.taskId, 1);
  assert.equal(pending.autoSubmit, false); assert.ok(pending.attemptedAt);
  await assert.rejects(relay.generate(task.taskId,1), /未核实/);
  assert.deepEqual(relay.clearPending(task.taskId, 1), {cleared:true});
  assert.deepEqual(relay.clearPending(task.taskId, 1), {cleared:false});
  settings.setAutoSubmit(true);
  await assert.rejects(relay.generate(task.taskId,1), /lost/);
  assert.deepEqual(seen, [false, true]);
  assert.throws(() => relay.pendingAttempt(task.taskId, 2), /版本无效/);
  assert.throws(() => relay.pendingAttempt('../../etc', 1));
  assert.equal(new MjRelay(store, browser).autoSubmit, false);
});
