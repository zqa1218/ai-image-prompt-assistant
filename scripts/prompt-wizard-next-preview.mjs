import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const data = path.resolve(process.env.WORKBENCH_NEXT_DIR || path.join(root, '.workbench/prompt-wizard-next'));
process.env.PW_API_PORT = process.env.WORKBENCH_NEXT_PORT || '8879';
process.env.PW_WEB_PORT = process.env.PW_API_PORT;
process.env.PROMPT_WIZARD_DATA_DIR = path.join(data, 'settings');
process.env.PROMPT_WIZARD_BRIDGE_DIR = path.join(data, 'bridge');
process.env.PW_OPEN_BROWSER = '0';
delete process.env.DEEPSEEK_API_KEY;
console.log(`阶段 3 独立源码预览：http://127.0.0.1:${process.env.PW_API_PORT}；输出 dist-next，独立数据目录，不切换 Electron。`);
await import('../apps/prompt-wizard-next/server/index.mjs');
