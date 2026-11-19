import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createWorkbenchServer } from '../../packages/http/server.mjs';
import { PhotoshopBridge } from '../../packages/photoshop/bridge.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const dataRoot = path.resolve(process.env.MJ_STUDIO_DATA_DIR || path.join(root, '.workbench/studio'));
const port = Number(process.env.MJ_STUDIO_PORT || 8790);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('MJ_STUDIO_PORT 必须是 1024–65535 的整数');
const connectorFile = process.env.MJ_STUDIO_CONNECTOR_FILE ?? path.join(process.env.LOCALAPPDATA ?? os.homedir(), 'MJStudio', 'connector.json');
const bridgeFile = process.env.MJ_STUDIO_PS_BRIDGE_FILE ?? path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'MJStudio', 'bridge.json');
const photoshopBridge = new PhotoshopBridge({ descriptorFile: path.resolve(bridgeFile) });
const app = createWorkbenchServer({ dataRoot, port, connectorFile, photoshopBridge });
await app.ready;
photoshopBridge.attach(app.server, app.port);
console.log(`MJ / Banana 工作台已启动：${app.url}`);
console.log(`数据目录：${dataRoot}`);
console.log('按 Ctrl+C 退出。打开官网不会自动记录提交，只有页面中的“我已在官网提交”会创建批次。');

let closing = false;
async function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  try { await app.close(); } catch (error) { console.error('关闭工作台失败：', error); code = 1; }
  process.exit(code);
}
process.once('SIGINT', () => { void shutdown(0); });
process.once('SIGTERM', () => { void shutdown(0); });
