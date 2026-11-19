// Explicit, isolated packaged-app acceptance run. No model request or real user data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function smokeDesktop({ wizardWindow, getWorkbenchWindow, workbench, wizardUrl }) {
  assert.ok(process.env.PW041_TEST_ROOT && path.isAbsolute(process.env.PW041_TEST_ROOT), '冒烟验收必须使用独立数据目录');
  const evalWizard = code => wizardWindow.webContents.executeJavaScript(code);
  assert.equal(await evalWizard("Boolean(window.pwShell?.importWorkbench && document.querySelector('#pw-workbench-nav button'))"), true);
  const exchange = { schemaVersion: 'prompt-wizard-exchange/1', workflowId: 'recompose',
    artifact: { prompt: 'Offline package acceptance: sculpted ceramic under soft window light', channel: 'MJ', params: ['--v 7 --ar 3:2 --s 0'], checklist: ['离线验收，不提交模型'] },
    context: { analysis: '离线验收分析', requirements: { requirement: '包内交接验收' }, notes: ['保留纹理'], direction: '' },
    target: null, selectedParameterIndex: 0,
    images: [{ assetId: 'test_base', role: 'image_prompt', dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', note: '合成测试图' }] };
  const request = { exchange, mode: 'mj_web', sourceId: 'package_smoke' };
  const imported = await evalWizard(`window.pwShell.importWorkbench(${JSON.stringify(request)})`);
  const replay = await evalWizard(`window.pwShell.importWorkbench(${JSON.stringify(request)})`);
  assert.equal(replay.taskId, imported.taskId);
  assert.equal(workbench.store.read().tasks.length, 1);
  const task = workbench.store.get(imported.taskId);
  assert.equal(task.revisions[0].settings.stylize, 0);
  assert.equal(task.revisions[0].references.length, 1);
  async function waitForTask(id, text) {
    for (let count = 0; count < 100; count++) {
      const found = await getWorkbenchWindow().webContents.executeJavaScript(`new URLSearchParams(location.search).get('task') === ${JSON.stringify(id)} && document.querySelector('#taskDetail').textContent.includes(${JSON.stringify(text)}) && document.querySelector('#taskList [aria-current=true]') !== null`);
      if (found) return;
      await pause(100);
    }
    throw new Error('工作台没有选中交接任务');
  }
  await waitForTask(imported.taskId, exchange.artifact.prompt);
  const banana = { ...request, mode: 'banana_api', exchange: { ...exchange, workflowId: 'refine', selectedParameterIndex: null, artifact: { prompt: '离线精修验收：保留主体，改善光照', channel: 'Banana' }, images: exchange.images.map(image => ({ ...image, role: 'base' })) } };
  const second = await evalWizard(`window.pwShell.importWorkbench(${JSON.stringify(banana)})`);
  await waitForTask(second.taskId, banana.exchange.artifact.prompt);
  assert.equal(workbench.store.read().tasks.length, 2);
  assert.equal(workbench.store.get(second.taskId).revisions[0].mode, 'banana_api');
  await evalWizard(`window.pwShell.importWorkbench(${JSON.stringify(request)})`);
  await waitForTask(imported.taskId, exchange.artifact.prompt); // Must select the requested older task, not the newest.
  assert.equal(await getWorkbenchWindow().webContents.executeJavaScript("!document.querySelector('#returnWizardButton').hidden && typeof window.pwWorkbench.showWizard === 'function'"), true);
  const meta = await (await fetch(new URL('/api/meta', workbench.url))).json();
  assert.equal(meta.version, '0.4.1-workbench.7');
  // workbench.6: login windows are placed with the real screen layout registered by main.mjs.
  assert.ok(globalThis.promptWizardWorkAreas?.().length > 0 && globalThis.promptWizardActiveWorkArea?.().width > 0, '没有注册屏幕工作区');
  // workbench.5: a saved key that safeStorage cannot decrypt reads as "not configured" instead of failing every settings request.
  const wizardSettings = path.join(process.env.PW041_TEST_ROOT, 'electron', 'wizard', 'model-settings.json');
  const savedSettings = fs.existsSync(wizardSettings) ? fs.readFileSync(wizardSettings) : null;
  fs.writeFileSync(wizardSettings, JSON.stringify({ mode: 'api', encryptedKey: Buffer.from('not-encrypted-by-this-app').toString('base64') }));
  let unreadableKey;
  try {
    const response = await fetch(new URL('/api/settings', wizardUrl));
    unreadableKey = { status: response.status, body: await response.json() };
  } finally {
    if (savedSettings) fs.writeFileSync(wizardSettings, savedSettings); else fs.rmSync(wizardSettings, { force: true });
  }
  assert.equal(unreadableKey.status, 200);
  assert.equal(unreadableKey.body.keyUnreadable, true);
  assert.equal(unreadableKey.body.hasKey, false);
  // workbench.7: each API address keeps its own key. Switching DeepSeek -> MiniMax -> DeepSeek must not fail or demand a new key,
  // must not carry the DeepSeek key to MiniMax, and must swap the DeepSeek key back in. Uses a placeholder key in the test data folder.
  const putSettings = body => fetch(new URL('/api/settings', wizardUrl), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    .then(async response => ({ status: response.status, body: await response.json() }));
  const settingsBeforeSwitch = fs.existsSync(wizardSettings) ? fs.readFileSync(wizardSettings) : null;
  const keySwitch = [];
  let plaintextOnDisk;
  try {
    fs.writeFileSync(wizardSettings, '{}');
    keySwitch.push(await putSettings({ mode: 'api', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: 'smoke-placeholder-not-a-real-key' }));
    keySwitch.push(await putSettings({ mode: 'api', baseUrl: 'https://api.minimax.cn/v1', model: 'MiniMax-M3.1-Flash' }));
    keySwitch.push(await putSettings({ mode: 'api', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' }));
    plaintextOnDisk = fs.readFileSync(wizardSettings, 'utf8').includes('smoke-placeholder');
  } finally {
    if (settingsBeforeSwitch) fs.writeFileSync(wizardSettings, settingsBeforeSwitch); else fs.rmSync(wizardSettings, { force: true });
  }
  assert.deepEqual(keySwitch.map(result => result.status), [200, 200, 200], JSON.stringify(keySwitch.map(result => result.body?.error)));
  assert.equal(keySwitch[1].body.hasKey, false);
  assert.deepEqual(keySwitch[1].body.keyOrigins, ['https://api.deepseek.com']);
  assert.equal(keySwitch[2].body.hasKey, true);
  assert.equal(plaintextOnDisk, false);
  // workbench.4 theme: graphite + orange tokens loaded, and the analysis-source chip replaced the three header selects.
  const look = await evalWizard(`(async () => {
    for (let i = 0; i < 50 && !document.querySelector('.transport-bar .pw-source-chip'); i++) await new Promise(r => setTimeout(r, 100));
    const primary = document.querySelector('.transport-bar > .transport-primary');
    return { accent: getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim(),
      chip: document.querySelector('.transport-bar .pw-source-chip')?.textContent ?? '',
      selectsHidden: primary ? getComputedStyle(primary).display === 'none' : null };
  })()`);
  assert.equal(look.accent, '#f08a4b');
  assert.ok(look.chip.length > 0, '分析来源标签没有出现');
  assert.equal(look.selectsHidden, true);
  // Auto-submit is opt-in: off in a fresh profile, then enabled for this run only (the IPC path opens a native dialog).
  const { app, session, nativeImage } = await import('electron');
  const { MjRelaySettings } = await import('../../packages/adapters/mj-relay.mjs');
  const settingsFile = path.join(app.getPath('userData'), 'mj-relay-settings.json');
  assert.equal(new MjRelaySettings(settingsFile).read().autoSubmit, false);
  assert.equal((await getWorkbenchWindow().webContents.executeJavaScript('window.pwWorkbench.getMjSettings()')).autoSubmit, false);
  new MjRelaySettings(settingsFile).setAutoSubmit(true);
  // Route both hosts to fixtures inside the isolated smoke profile.
  const mockSession = session.fromPartition('persist:mj-workbench');
  const id = '16710a15-0735-46aa-8137-c5cbf45cb14c';
  const pixels = Buffer.from([0, 0, 255, 255, 0, 255, 0, 255, 255, 0, 0, 255, 255, 255, 255, 255]);
  const grid = nativeImage.createFromBitmap(pixels, { width: 2, height: 2 }).toPNG();
  let downloads = 0;
  mockSession.protocol.handle('https', request => {
    if (request.url === 'https://www.midjourney.com/imagine') {
      return new Response('<textarea placeholder="What would you like to imagine?"></textarea><section></section><script>document.querySelector("textarea").onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();const a=document.createElement("a");a.href="/jobs/JOBID";a.textContent=e.target.value;document.querySelector("section").append(a);e.target.value="";}}</script>'.replace('JOBID', id),
        { headers: { 'Content-Type': 'text/html' } });
    }
    if (request.url === 'https://cdn.midjourney.com/' + id + '/grid_0.png') {
      downloads++;
      return new Response(grid, { headers: { 'Content-Type': 'image/png' } });
    }
    return new Response(null, { status: 404 });
  });
  try {
    workbench.store.confirm(imported.taskId, 1, { promptReviewed: true, settingsReviewed: true, referencesReviewed: true });
    const workView = getWorkbenchWindow().webContents;
    const runId = await workView.executeJavaScript('window.pwWorkbench.generateMj(' + JSON.stringify(imported.taskId) + ',1)');
    const read = () => workbench.store.get(imported.taskId);
    assert.equal(read().runs[0].websiteUrl, 'https://www.midjourney.com/jobs/' + id);
    assert.equal(read().results.length, 4);
    assert.ok(read().results.every(item => item.runId === runId && item.revision === 1 && item.width === 1 && item.height === 1));
    await workView.executeJavaScript('window.pwWorkbench.collectMj(' + JSON.stringify(imported.taskId) + ',' + JSON.stringify(runId) + ')');
    assert.equal(read().runs.length, 1);
    assert.equal(read().results.length, 4);
    assert.equal(downloads, 2);
  } finally { mockSession.protocol.unhandle('https'); }
  const evidence = { baseVersion: '0.4.1', workbenchVersion: meta.version, themeApplied: true, sourceChip: look.chip, unreadableKeyTolerated: true, perProviderKeys: true, screenAreasRegistered: true, mjAutoSubmitDefaultOff: true, mjSimulatedGenerationAndRecovery: true, wizardUrl, workbenchUrl: workbench.url, taskCount: 2,
    ipcImport: true, duplicateReused: true, exactTaskSelected: true, imagePreserved: true, parameterZeroPreserved: true,
    checkedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(process.env.PW041_TEST_ROOT, 'passed.json'), JSON.stringify(evidence, null, 2));
}
