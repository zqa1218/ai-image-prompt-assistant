import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const previewRoot = path.resolve(process.env.WORKBENCH_PREVIEW_DIR || path.join(root, '.workbench/compat-preview'));
process.env.PW_API_PORT = '8878';
process.env.PW_WEB_PORT = '8878';
process.env.PROMPT_WIZARD_DATA_DIR = path.join(previewRoot, 'settings');
process.env.PROMPT_WIZARD_BRIDGE_DIR = path.join(previewRoot, 'bridge');
process.env.PW_OPEN_BROWSER = '0';
delete process.env.DEEPSEEK_API_KEY;
console.log('隔离预览 http://127.0.0.1:8878 — 未启动 Electron 文本通道/窗口联动；未安装 PS 插件；不读取原凭证。');
await import('../apps/prompt-wizard-compat/server/index.mjs');
