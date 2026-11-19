import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { patchConfigSource, patchConfigTestSource } from '../integrations/prompt-wizard-041/config-patch.mjs';
import { patchBundleApiSwitch } from '../integrations/prompt-wizard-041/api-switch-patch.mjs';
import { patchCdpBrowser, patchGeminiWeb, patchChatGptWeb, patchBundleLoginText } from '../integrations/prompt-wizard-041/login-patch.mjs';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const asar = require('../apps/prompt-wizard-next/node_modules/@electron/asar');
const installed = path.join(process.env.LOCALAPPDATA, 'Programs', 'prompt-wizard', 'resources');
const archive = path.join(installed, 'app.asar');
const baseline = path.join(root, 'baselines/prompt-wizard-runtime-0.4.1');
const target = path.join(root, 'apps/prompt-wizard-installed');
const integration = path.join(root, 'integrations/prompt-wizard-041');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
// The desktop version lives only in electron-builder.installed.yml (extraMetadata.version).
const desktopVersion = /^extraMetadata:\s*\n(?:[ \t]+.*\n)*?[ \t]+version:\s*(\S+)/m.exec(fs.readFileSync(path.join(root, 'electron-builder.installed.yml'), 'utf8'))?.[1];
if (!desktopVersion) throw new Error('electron-builder.installed.yml 缺少 extraMetadata.version');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'baselines/manifest.json'), 'utf8'));
if (hash(fs.readFileSync(archive)) !== manifest.archiveSha256) throw new Error('安装版已变化，必须重新核对基线后才能制作');
const originalPackage = JSON.parse(asar.extractFile(archive, 'package.json').toString());
if (originalPackage.version !== '0.4.1') throw new Error('只支持已核对的 0.4.1 安装版');
// Verify every runtime source/resource against the actual installation before deriving it.
const verified = [];
for (const entry of asar.listPackage(archive)) {
  const relative = entry.replace(/^[\\/]/, '').replaceAll('\\', '/');
  if (relative.startsWith('node_modules/') || !fs.existsSync(path.join(baseline, relative)) || !fs.statSync(path.join(baseline, relative)).isFile()) continue;
  const bytes = asar.extractFile(archive, relative.replaceAll('/', path.sep));
  if (!bytes.equals(fs.readFileSync(path.join(baseline, relative)))) throw new Error(`安装版与基线不一致：${relative}`);
  verified.push({ path: relative, sha256: hash(bytes) });
}
fs.cpSync(baseline, target, { recursive: true });
const patch = (file, before, after) => {
  const name = path.join(target, file), source = fs.readFileSync(name, 'utf8');
  if (source.split(before).length !== 2) throw new Error(`补丁定位不唯一：${file}: ${before.slice(0, 80)}`);
  fs.writeFileSync(name, source.replace(before, after));
};
const sourceBundle = 'dist/assets/index-D8vnK_nQ.js';
let bundle = fs.readFileSync(path.join(target, sourceBundle), 'utf8');
const anchor = 'return(0,X.jsxs)(`div`,{className:`space-y-4`,children:[';
const outputStart = bundle.indexOf('function rp({artifact:e,exportName:t=');
const position = bundle.indexOf(anchor, outputStart);
if (outputStart < 0 || position < 0 || position - outputStart > 1500) throw new Error('无法识别原版提示词输出组件');
bundle = bundle.slice(0, position) + bundle.slice(position).replace(anchor, anchor + '(0,X.jsx)(`pw-workbench-output`,{artifact:e}),');
bundle = 'import {bindWizard as bindInstalledWorkbench} from "./workbench-link.mjs";\n' + bundle + '\nbindInstalledWorkbench(Y);\n';
bundle = patchBundleLoginText(bundle);
// Switching DeepSeek <-> MiniMax swaps in that provider's saved key instead of looping back to settings.
bundle = patchBundleApiSwitch(bundle);
fs.writeFileSync(path.join(target, 'dist/assets/index-workbench.js'), bundle);
for (const file of ['workbench-link.mjs', 'exchange.mjs', 'source-switch.mjs', 'workbench-link.css', 'workbench-theme.css']) fs.copyFileSync(path.join(integration, file), path.join(target, 'dist/assets', file));
patch('dist/index.html', '/assets/index-D8vnK_nQ.js', '/assets/index-workbench.js');
patch('dist/index.html', '</head>', '<link rel="stylesheet" href="/assets/workbench-link.css">\n  <link rel="stylesheet" href="/assets/workbench-theme.css">\n  </head>');
patch('dist/index.html', '<div id="root"></div>', '<nav id="pw-workbench-nav" aria-label="工作台交接"></nav>\n    <div id="root"></div>');
patch('server/index.mjs', "'.js': 'text/javascript; charset=utf-8',", "'.js': 'text/javascript; charset=utf-8',\n  '.mjs': 'text/javascript; charset=utf-8',");
patch('server/index.mjs', '  attachPhotoshopBridge,', '  closePhotoshopBridge,\n  attachPhotoshopBridge,');
// A saved API key that cannot be decrypted must not break every settings read (locked source selects, failed analysis).
const configFile = path.join(target, 'server/config.mjs');
fs.writeFileSync(configFile, patchConfigSource(fs.readFileSync(configFile, 'utf8')));
const configTestFile = path.join(target, 'server/config.test.mjs');
fs.writeFileSync(configTestFile, patchConfigTestSource(fs.readFileSync(configTestFile, 'utf8')));
patch('server/index.mjs', "  const url = new URL(req.url ?? '/',", "  if (![`${HOST}:${PORT}`, `localhost:${PORT}`].includes(req.headers.host)) return sendJson(res, 421, { error: { message: '无效的本机 Host' } });\n  const url = new URL(req.url ?? '/',");
fs.appendFileSync(path.join(target, 'server/index.mjs'), '\nexport async function closeServer() {\n  await closePhotoshopBridge();\n  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });\n}\n');
patch('server/photoshop-bridge.mjs', "import { mkdir, writeFile }", "import { mkdir, writeFile, readFile, unlink }");
patch('server/photoshop-bridge.mjs', 'let plugin = null', 'let plugin = null\nlet bridgeServer, descriptorPath');
patch('server/photoshop-bridge.mjs', '  const wss = new WebSocketServer', '  const wss = bridgeServer = new WebSocketServer');
patch('server/photoshop-bridge.mjs', "    path.join(bridgeDir, 'bridge.json'),", "    descriptorPath = path.join(bridgeDir, 'bridge.json'),");
fs.appendFileSync(path.join(target, 'server/photoshop-bridge.mjs'), `
export async function closePhotoshopBridge() {
  for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('程序已退出')); }
  pending.clear(); for (const client of clients) client.terminate(); clients.clear(); plugin = null;
  if (bridgeServer) await new Promise(resolve => bridgeServer.close(resolve));
  try { if (JSON.parse(await readFile(descriptorPath, 'utf8')).token === token) await unlink(descriptorPath); } catch {}
}
`);
// These scripts live below the derived app in app.asar; retain the original Yao handoff.
patch('electron/handoff.mjs', "const clickScript = path.join(path.dirname(packaged), 'click-orb.ps1')", "const clickScript = path.join(path.dirname(psPath ?? packaged), 'click-orb.ps1')");
for (const file of ['main.mjs', 'preload.cjs', 'workbench-preload.cjs', 'window-placement.mjs']) fs.copyFileSync(path.join(integration, file), path.join(target, 'electron', file));
// Web login: window always lands on a visible screen, and the user does every click and keystroke themselves.
for (const [file, apply] of [['electron/cdp-browser.mjs', patchCdpBrowser], ['electron/gemini-web.mjs', patchGeminiWeb], ['electron/chatgpt-web.mjs', patchChatGptWeb]]) {
  const name = path.join(target, file);
  fs.writeFileSync(name, apply(fs.readFileSync(name, 'utf8')));
}
fs.cpSync(path.join(installed, 'photoshop-plugin'), path.join(target, 'photoshop-plugin'), { recursive: true });
const pluginFile = path.join(target, 'photoshop-plugin/manifest.json');
const plugin = JSON.parse(fs.readFileSync(pluginFile, 'utf8'));
plugin.id = 'com.mjstudio.promptwizard041.link'; plugin.name = '提示词工作台 Link'; plugin.entrypoints[0].label.default = '提示词工作台 Link';
fs.writeFileSync(pluginFile, JSON.stringify(plugin, null, 2));
patch('photoshop-plugin/main.js', "join(appData, 'PromptWizard', 'bridge.json')", "join(appData, 'PromptWizardWorkbench041', 'bridge.json')");
patch('electron/photoshop-plugin.mjs', "'com.promptwizard.photoshop-link'", "'com.mjstudio.promptwizard041.link'");
fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ ...originalPackage, name: 'prompt-wizard-installed-workbench', version: desktopVersion }, null, 2));
fs.writeFileSync(path.join(target, 'provenance.json'), JSON.stringify({
  installedPath: installed, version: originalPackage.version, archiveSha256: manifest.archiveSha256,
  frontendSourceRecovered: false, strategy: '保留安装版运行代码；校验哈希后仅接入输出组件和独立工作台外壳',
  verified, derivedAt: new Date().toISOString(),
}, null, 2));
console.log(`已核对安装版 ${verified.length} 个运行文件，生成 0.4.1 工作台版；原 bundle/CSS/图库保留。`);
