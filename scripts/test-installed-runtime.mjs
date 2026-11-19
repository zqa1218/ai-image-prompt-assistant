import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const root = path.resolve(import.meta.dirname, '..');
const cwd = path.join(root, 'apps/prompt-wizard-installed');
if (!fs.existsSync(path.join(cwd, 'node_modules'))) fs.symlinkSync(path.join(root, 'apps/prompt-wizard-next/node_modules'), path.join(cwd, 'node_modules'), 'junction');
const browserSuites = process.argv.includes('--browser');
const suites = browserSuites ? ['electron/chatgpt-web.test.mjs', 'electron/gemini-web.test.mjs'] : [
  'server/archives.test.mjs', 'server/config.test.mjs', 'server/chatgpt-plans.test.mjs', 'server/gemini-web-request.test.mjs', 'server/api-transport.test.mjs',
  'electron/conversation-store.test.mjs', 'electron/gemini-mode.test.mjs', 'electron/window-state.test.mjs',
];
const result = spawnSync(process.execPath, [path.join(root, 'apps/prompt-wizard-next/node_modules/vitest/vitest.mjs'), 'run',
  '--config', path.join(root, 'integrations/prompt-wizard-041/vitest.config.mjs'), ...suites], { cwd, stdio: 'inherit', timeout: 45000 });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
