import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInstalledExchange, recommendedMode, isNewCompletedPrompt } from '../integrations/prompt-wizard-041/exchange.mjs';
import { createInstalledHandoff, assertWizardSender } from '../integrations/prompt-wizard-041/handoff.mjs';
import { analyzedOnce, sourceSummary } from '../integrations/prompt-wizard-041/source-switch.mjs';
import { patchConfigSource, patchConfigTestSource } from '../integrations/prompt-wizard-041/config-patch.mjs';
import { patchBundleApiSwitch } from '../integrations/prompt-wizard-041/api-switch-patch.mjs';
import { patchCdpBrowser, patchGeminiWeb, patchChatGptWeb, patchBundleLoginText } from '../integrations/prompt-wizard-041/login-patch.mjs';
import { visibleBounds } from '../integrations/prompt-wizard-041/window-placement.mjs';
import { pathToFileURL } from 'node:url';
import { createWorkbenchServer } from '../packages/http/server.mjs';
const image = { name: '合成图.png', dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', note: '只参考姿态' };
const fixture = () => ({ taskId: 'fixture_task', workflowId: 'recompose', busy: false, original: image, references: [{ ...image, name: 'reference.png' }],
  artifact: { prompt: 'test image prompt', channel: 'MJ', params: ['--v 7 --ar 3:2 --s 0'] },
  intake: { requirement: '保持主体' }, records: { analyze: { output: '分析内容' } }, notes: ['保留纹理'], options: [{ id: 'option_a', title: '逆光' }], selectedOptionId: 'option_a', referenceItems: [], selectedReferenceItems: [] });

test('automatic handoff responds only to completed new prompts, not page switches or enabling the setting', () => {
  const previous = { ...fixture(), artifact: null, busy: true, promptVersion: 0 }, current = { ...fixture(), promptVersion: 1 };
  assert.equal(isNewCompletedPrompt(current, previous, true), true);
  assert.equal(isNewCompletedPrompt(current, previous, false), false);
  assert.equal(isNewCompletedPrompt({ ...current, busy: true }, previous, true), false);
  assert.equal(isNewCompletedPrompt({ ...current, stageIndex: 5 }, current, true), false);
  assert.equal(isNewCompletedPrompt(current, current, true), false);
  assert.equal(isNewCompletedPrompt({ ...current, artifact: { ...current.artifact }, promptVersion: 2 }, current, true), true);
});

test('installed 0.4.1 exchange retains requirements, images, notes and selected parameter without fake PS provenance', () => {
  const state = fixture();
  const exchange = createInstalledExchange(state, state.artifact, 0);
  assert.equal(exchange.images.length, 2); assert.equal(exchange.images[0].role, 'image_prompt');
  assert.match(exchange.images[1].note, /只参考姿态/); assert.equal(exchange.context.analysis, '分析内容');
  assert.equal(exchange.selectedParameterIndex, 0); assert.equal(recommendedMode(state), 'mj_web');
  state.workflowId = 'refine'; state.original = { ...image, documentName: 'test.psd', documentId: 1 };
  const edit = createInstalledExchange(state, state.artifact);
  assert.equal(edit.images[0].role, 'base'); assert.equal(edit.images[1].role, 'edit_reference');
  assert.equal(edit.images[0].photoshop, undefined); assert.match(edit.images[0].note, /test.psd/);
  assert.equal(recommendedMode(state), 'banana_api');
  state.busy = true; assert.throws(() => createInstalledExchange(state, state.artifact), /生成/);
  state.busy = false; assert.throws(() => createInstalledExchange(state, { ...state.artifact }), /变化/);
});

test('installed handoff persists before navigation and reuses the same task after window-open failure or restart', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw041-test-'));
  const connectorFile = path.join(dir, 'connector.json');
  let workbench = createWorkbenchServer({ dataRoot: path.join(dir, 'data'), port: 0, connectorFile });
  t.after(async () => { await workbench.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  await workbench.ready;
  const state = fixture(), request = { sourceId: state.taskId, mode: 'mj_web', exchange: createInstalledExchange(state, state.artifact, 0) };
  const failOpen = createInstalledHandoff({ workbench, connectorFile, openWorkbench: async () => { throw new Error('window failed'); } });
  await assert.rejects(failOpen(request), /window failed/);
  assert.equal(workbench.store.read().tasks.length, 1);
  const id = workbench.store.read().tasks[0].taskId;
  await workbench.close();
  workbench = createWorkbenchServer({ dataRoot: path.join(dir, 'data'), port: 0, connectorFile }); await workbench.ready;
  let opened;
  const importTask = createInstalledHandoff({ workbench, connectorFile, openWorkbench: async taskId => { opened = taskId; } });
  const results = await Promise.all([importTask(request), importTask(request)]);
  assert.equal(results[0].taskId, id); assert.equal(results[1].taskId, id); assert.equal(opened, id);
  assert.equal(workbench.store.read().tasks.length, 1);
  const snapshot = workbench.store.get(id).revisions[0]; assert.equal(snapshot.settings.stylize, 0); assert.equal(snapshot.references.length, 2);
  await assert.rejects(importTask({ ...request, mode: 'unknown' }), /MJ/);
  await assert.rejects(importTask({ ...request, exchange: { ...request.exchange, images: [{ ...request.exchange.images[0], dataUrl: 'https://example.com/not-local.png' }] } }));
  assert.equal(workbench.store.read().tasks.length, 1);
  const steps = { ...request, mode: 'banana_api', exchange: { ...request.exchange, workflowId: 'refine-steps', selectedParameterIndex: null } };
  const stepsTask = await importTask(steps);
  assert.equal(workbench.store.get(stepsTask.taskId).revisions[0].operation, 'edit');
});

test('installed IPC only accepts its own main wizard frame', () => {
  const frame = { url: 'http://127.0.0.1:8792/' }, contents = { mainFrame: frame }, window = { webContents: contents };
  assert.doesNotThrow(() => assertWizardSender({ sender: contents, senderFrame: frame }, window, 'http://127.0.0.1:8792'));
  assert.throws(() => assertWizardSender({ sender: contents, senderFrame: { ...frame } }, window, 'http://127.0.0.1:8792'));
  frame.url = 'https://example.com'; assert.throws(() => assertWizardSender({ sender: contents, senderFrame: frame }, window, 'http://127.0.0.1:8792'));
});

test('source chip label summarises the header selects and keeps the API preset name', () => {
  assert.equal(sourceSummary({ mode: 'Gemini 网页', plan: '3.8 Flash · 对话', thinking: '思考：跟随账号', thinkingValue: '' }), 'Gemini 网页 · 3.8 Flash · 对话');
  assert.equal(sourceSummary({ mode: 'Gemini 网页', plan: '3.1 Pro · 对话', thinking: '思考：高点', thinkingValue: '高点' }), 'Gemini 网页 · 3.1 Pro · 对话 · 思考高点');
  assert.equal(sourceSummary({ mode: 'API', api: 'MiniMax · MiniMax-M3.1-Flash' }), 'API · MiniMax');
  assert.equal(sourceSummary({ mode: 'API', api: 'my-custom-model' }), 'API · my-custom-model');
  assert.equal(sourceSummary(), '');
});

test('switching source asks first only after the model has produced a result', () => {
  assert.equal(analyzedOnce({ records: {} }), false);
  assert.equal(analyzedOnce({ records: { analyze: { status: 'running' } } }), false);
  assert.equal(analyzedOnce({ records: { analyze: { status: 'error', error: 'x' } } }), false);
  assert.equal(analyzedOnce({ records: { analyze: { status: 'ready' }, direction: { status: 'running' } } }), true);
  assert.equal(analyzedOnce(null), false);
});

test('prepare script ships the workbench.4 theme next to the original stylesheet', () => {
  const script = fs.readFileSync(path.join(import.meta.dirname, '../scripts/prepare-installed-workbench.mjs'), 'utf8');
  assert.match(script, /'source-switch\.mjs'/);
  assert.match(script, /'workbench-theme\.css'/);
  assert.match(script, /href="\/assets\/workbench-theme\.css"/);
  const css = fs.readFileSync(path.join(import.meta.dirname, '../integrations/prompt-wizard-041/workbench-theme.css'), 'utf8');
  assert.match(css, /--color-accent: #f08a4b/);
  assert.match(css, /html\[data-pw-narrow\]/);
});

test('a saved API key that cannot be decrypted reads as not configured instead of breaking settings', async t => {
  const baseline = path.join(import.meta.dirname, '../baselines/prompt-wizard-runtime-0.4.1/server');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw041-config-'));
  const data = path.join(dir, 'data'); fs.mkdirSync(data);
  for (const file of ['gemini-plans.mjs', 'chatgpt-plans.mjs']) fs.copyFileSync(path.join(baseline, file), path.join(dir, file));
  fs.writeFileSync(path.join(dir, 'config.mjs'), patchConfigSource(fs.readFileSync(path.join(baseline, 'config.mjs'), 'utf8')));
  assert.throws(() => patchConfigSource('export const nothing = 1'), /补丁定位不唯一/);
  const settingsFile = path.join(data, 'model-settings.json');
  fs.writeFileSync(settingsFile, JSON.stringify({ mode: 'api', baseUrl: 'https://api.minimax.cn/v1', model: 'MiniMax-M3.1-Flash', encryptedKey: Buffer.from('from-another-app').toString('base64') }));
  const env = { dir: process.env.PROMPT_WIZARD_DATA_DIR, key: process.env.DEEPSEEK_API_KEY };
  process.env.PROMPT_WIZARD_DATA_DIR = data; delete process.env.DEEPSEEK_API_KEY;
  globalThis.promptWizardSafeStorage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(`ok:${value}`),
    decryptString: buffer => { const text = buffer.toString(); if (!text.startsWith('ok:')) throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.'); return text.slice(3); } };
  t.after(() => {
    delete globalThis.promptWizardSafeStorage;
    if (env.dir === undefined) delete process.env.PROMPT_WIZARD_DATA_DIR; else process.env.PROMPT_WIZARD_DATA_DIR = env.dir;
    if (env.key !== undefined) process.env.DEEPSEEK_API_KEY = env.key;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const config = await import(pathToFileURL(path.join(dir, 'config.mjs')).href);
  const shown = config.publicSettings();
  assert.deepEqual({ mode: shown.mode, model: shown.model, hasKey: shown.hasKey, keyUnreadable: shown.keyUnreadable, keySource: shown.keySource },
    { mode: 'api', model: 'MiniMax-M3.1-Flash', hasKey: false, keyUnreadable: true, keySource: 'unreadable' });
  assert.equal(config.updateSettings({ mode: 'gemini-web' }).mode, 'gemini-web');
  assert.doesNotMatch(fs.readFileSync(settingsFile, 'utf8'), /keyUnreadable/);
  config.updateSettings({ apiKey: 'replacement-key', mode: 'api' });
  assert.equal(config.readSettings().apiKey, 'replacement-key');
  assert.deepEqual([config.publicSettings().hasKey, config.publicSettings().keyUnreadable, config.publicSettings().keySource], [true, false, 'local']);
  fs.writeFileSync(settingsFile, '{}');
  assert.equal(config.publicSettings().mode, 'api', '新配置默认用 API 分析');
});

test('login windows land on a visible screen even when parked just off the left edge', () => {
  const primary = { x: 0, y: 0, width: 1707, height: 1067 }, left = { x: -1920, y: 0, width: 1920, height: 1040 };
  assert.deepEqual(visibleBounds({ left: -1380, top: 0, width: 1180, height: 900 }, [primary], primary), { left: 264, top: 84, width: 1180, height: 900 });
  assert.equal(visibleBounds({ left: 100, top: 50, width: 1180, height: 900 }, [primary], primary), null);
  assert.equal(visibleBounds({ left: -1800, top: 20, width: 1180, height: 900 }, [primary, left], primary), null);
  assert.deepEqual(visibleBounds({ left: -3300, top: 0, width: 1180, height: 900 }, [primary, left], left), { left: -1550, top: 70, width: 1180, height: 900 });
  assert.deepEqual(visibleBounds({ left: -30000, top: 0, width: 1180, height: 900 }, [{ x: 0, y: 0, width: 1280, height: 680 }]), { left: 50, top: 20, width: 1180, height: 640 });
});

test('web login patches keep the user in control: no auto-click, no auto-fill, window brought on screen', () => {
  const base = path.join(import.meta.dirname, '../baselines/prompt-wizard-runtime-0.4.1');
  const read = file => fs.readFileSync(path.join(base, file), 'utf8');
  const method = (source, name) => { const start = source.indexOf(`  async ${name}(`); return source.slice(start, source.indexOf('\n  }\n', start)); };
  const cdp = patchCdpBrowser(read('electron/cdp-browser.mjs'));
  assert.match(cdp, /import \{ placeOnScreen \} from '\.\/window-placement\.mjs'/);
  assert.doesNotMatch(method(cdp, 'show'), /left \?\? 0\) < -10000|left: 60/);
  assert.doesNotMatch(method(cdp, 'bringOnScreen'), /left: 60/);
  const gemini = method(patchGeminiWeb(read('electron/gemini-web.mjs')), 'openLogin');
  const chatgpt = method(patchChatGptWeb(read('electron/chatgpt-web.mjs')), 'openLogin');
  for (const login of [gemini, chatgpt]) {
    assert.match(login, /bringOnScreen/);
    assert.doesNotMatch(login, /#fillLoginEmail\(|#clickSignIn\(|#clickByLabel\(/);
  }
  assert.match(method(read('electron/gemini-web.mjs'), 'openLogin'), /#fillLoginEmail\(/, '基线确实有自动填写，补丁才有意义');
  const bundle = patchBundleLoginText(read('dist/assets/index-D8vnK_nQ.js'));
  assert.ok(bundle.includes('账号和密码都由你自己输入') && !bundle.includes('邮箱已自动填好'));
});

test('each API address keeps its own key: switching DeepSeek and MiniMax swaps keys instead of looping back to settings', async t => {
  const baseline = path.join(import.meta.dirname, '../baselines/prompt-wizard-runtime-0.4.1/server');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw041-keys-'));
  const data = path.join(dir, 'data'); fs.mkdirSync(data);
  for (const file of ['gemini-plans.mjs', 'chatgpt-plans.mjs']) fs.copyFileSync(path.join(baseline, file), path.join(dir, file));
  fs.writeFileSync(path.join(dir, 'config.mjs'), patchConfigSource(fs.readFileSync(path.join(baseline, 'config.mjs'), 'utf8')));
  const settingsFile = path.join(data, 'model-settings.json');
  const env = { dir: process.env.PROMPT_WIZARD_DATA_DIR, key: process.env.DEEPSEEK_API_KEY, base: process.env.DEEPSEEK_BASE_URL };
  process.env.PROMPT_WIZARD_DATA_DIR = data; delete process.env.DEEPSEEK_API_KEY; delete process.env.DEEPSEEK_BASE_URL;
  globalThis.promptWizardSafeStorage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(`ok:${value}`),
    decryptString: buffer => { const text = buffer.toString(); if (!text.startsWith('ok:')) throw new Error('bad ciphertext'); return text.slice(3); } };
  t.after(() => {
    delete globalThis.promptWizardSafeStorage;
    for (const [name, value] of [['PROMPT_WIZARD_DATA_DIR', env.dir], ['DEEPSEEK_API_KEY', env.key], ['DEEPSEEK_BASE_URL', env.base]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const DS = 'https://api.deepseek.com', MM = 'https://api.minimax.cn/v1';
  const config = await import(pathToFileURL(path.join(dir, 'config.mjs')).href);
  const key = () => config.readSettings().apiKey;
  assert.deepEqual(config.updateSettings({ baseUrl: DS, model: 'deepseek-flash', apiKey: 'ds-key' }).keyOrigins, [DS]);
  // 顶栏切到 MiniMax：原版这里抛错；现在不报错，也不把 DeepSeek 的 Key 带过去。
  let shown = config.updateSettings({ mode: 'api', baseUrl: MM, model: 'MiniMax-M3.1-Flash' });
  assert.deepEqual([shown.hasKey, shown.keyOrigins, key()], [false, [DS], '']);
  config.updateSettings({ baseUrl: MM, model: 'MiniMax-M3.1-Flash', apiKey: 'mm-key' });
  shown = config.updateSettings({ mode: 'api', baseUrl: DS, model: 'deepseek-flash' });
  assert.deepEqual([shown.hasKey, key()], [true, 'ds-key'], '切回 DeepSeek 自动换上原来的 Key');
  config.updateSettings({ baseUrl: MM });
  assert.equal(key(), 'mm-key');
  // 换地址时同时填了新 Key：新 Key 记在新地址，旧地址的 Key 不受影响。
  config.updateSettings({ baseUrl: DS, apiKey: 'ds-key-2' });
  config.updateSettings({ baseUrl: MM }); assert.equal(key(), 'mm-key');
  config.updateSettings({ baseUrl: DS }); assert.equal(key(), 'ds-key-2');
  // 明确清空 Key 只清当前地址。
  shown = config.updateSettings({ apiKey: '' });
  assert.deepEqual([shown.hasKey, shown.keyOrigins], [false, ['https://api.minimax.cn']]);
  assert.doesNotMatch(fs.readFileSync(settingsFile, 'utf8'), /ds-key|mm-key|keyUnreadable/);
  // 解不开的 Key 不会被收起来冒充“已保存”。
  fs.writeFileSync(settingsFile, JSON.stringify({ mode: 'api', baseUrl: MM, model: 'x', encryptedKey: Buffer.from('garbage').toString('base64') }));
  assert.deepEqual(config.updateSettings({ baseUrl: DS }).keyOrigins, []);
  // 环境变量里的 Key 只属于环境变量的地址：换地址仍要求填新 Key，存的地址不同也不带过去。
  fs.writeFileSync(settingsFile, '{}');
  process.env.DEEPSEEK_API_KEY = 'env-key';
  const envConfig = await import(`${pathToFileURL(path.join(dir, 'config.mjs')).href}?env`);
  assert.throws(() => envConfig.updateSettings({ baseUrl: MM }), /Key/);
  fs.writeFileSync(settingsFile, JSON.stringify({ baseUrl: MM }));
  assert.equal(envConfig.readSettings().apiKey, '');
});

test('topbar provider switch uses the saved key and only opens settings when that provider has none', () => {
  const base = path.join(import.meta.dirname, '../baselines/prompt-wizard-runtime-0.4.1');
  const original = fs.readFileSync(path.join(base, 'dist/assets/index-D8vnK_nQ.js'), 'utf8');
  const bundle = patchBundleApiSwitch(original);
  const start = bundle.indexOf('async function b(n){if(n===`custom`)');
  const fn = bundle.slice(start, bundle.indexOf('}}', bundle.indexOf('Ff.getState()', start)) + 2);
  assert.match(fn, /keyOrigins/);
  assert.match(fn, /if\(!await a\(\{mode:`api`,baseUrl:r\.baseUrl,model:r\.model\}\)\)return/, '保存失败时不跳设置');
  assert.doesNotMatch(fn, /apiKey:``/, '不再带空 Key 保存');
  assert.ok(!bundle.includes('Key 各家不通用，必须自己填') && bundle.includes('每家的 Key 分开记住'));
  assert.throws(() => patchBundleApiSwitch(bundle), /补丁定位不唯一/);
  const configTest = patchConfigTestSource(fs.readFileSync(path.join(base, 'server/config.test.mjs'), 'utf8'));
  assert.doesNotMatch(configTest, /toThrow\(\/Key\/\)/);
  const script = fs.readFileSync(path.join(import.meta.dirname, '../scripts/prepare-installed-workbench.mjs'), 'utf8');
  assert.match(script, /bundle = patchBundleApiSwitch\(bundle\)/);
  assert.match(script, /patchConfigTestSource\(/);
});
