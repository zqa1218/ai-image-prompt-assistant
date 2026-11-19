import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TaskStore, taskStatus } from '../../packages/storage/store.mjs';
import { makeDraft } from '../../packages/core/draft.mjs';
import { fromPromptWizard } from '../../packages/adapters/prompt-wizard.mjs';
import { importExchange, EXCHANGE_LIMIT } from '../../packages/adapters/prompt-wizard-exchange.mjs';
import { requireThat } from '../../packages/core/validation.mjs';

const WORKBENCH_VERSION = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8')).version;

const help = `MJ / Banana 工作台 ${WORKBENCH_VERSION} — CLI 与 MJ 官网协作界面共用任务内核

npm run workbench -- <command> [arguments] [--store <folder>]

new --mode mj_web|banana_api --prompt-file <text-file>
import-prompt <Prompt-Wizard-Artifact-or-Exchange.json> --mode mj_web|banana_api
import-package <job.json>                         导入快照和其同目录 assets；清除外部确认
list                                            列出任务
show <task-id> [--snapshot]                      读取任务或最新可编辑输入
revise <task-id> <job.json> --revision <n>         以 n 为原版本生成新版本
confirm <task-id> --revision <n> --prompt-reviewed --settings-reviewed --references-reviewed
handoff <task-id> --revision <n> --out <new-dir>   导出官网交接包；不打开或提交官网
submitted <task-id> --revision <n> --request-id <unique-id> [--url <official-url>]
import-results <task-id> <image...> --revision <n> --run <run-id>
select <task-id> --result <result-id> --selected true|false
export <task-id> --revision <n> --out <new-dir> [--run <run-id> | --prompt-only]
banana-submit <task-id>                          明确报未配置；绝不发起请求
recover-lock                                    仅当原 PID 已退出才恢复中断的写锁

提示：submitted 表示你确实已在官网提交。相同 request-id 重试只返回原批次。
不要用 examples/mj-web-job.json 的虚构图片做实测；可先从 new 创建纯文本任务。
`;
const flagNames = new Set(['prompt-reviewed', 'settings-reviewed', 'references-reviewed', 'prompt-only', 'snapshot']);
const valueNames = new Set(['store', 'mode', 'prompt-file', 'revision', 'out', 'request-id', 'url', 'run', 'result', 'selected']);
function parse(args) {
  const options = {}, positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const name = arg.slice(2);
    requireThat(!(name in options), 'DUPLICATE_OPTION', `重复选项 --${name}`);
    if (flagNames.has(name)) options[name] = true;
    else {
      requireThat(valueNames.has(name) && args[i + 1] && !args[i + 1].startsWith('--'), 'INVALID_OPTION', `无效或缺值选项 ${arg}`);
      options[name] = args[++i];
    }
  }
  return { options, positional };
}
function readJson(file, limit = 2 * 1024 * 1024) {
  requireThat(file && fs.statSync(file).size <= limit, 'INPUT_SIZE', `请选择不超过 ${limit / 1024 / 1024} MiB 的 JSON 文件`);
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}
try {
  const args = process.argv.slice(2);
  if (!args.length || ['help', '--help', '-h'].includes(args[0])) { console.log(help); }
  else {
    const { options: opt, positional: pos } = parse(args);
    const [command, id, ...rest] = pos;
    const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
    const store = new TaskStore(opt.store ?? path.join(projectRoot, '.workbench/tasks'));
    const revision = Number(opt.revision);
    const outputDir = () => { requireThat(opt.out, 'OUTPUT_REQUIRED', '请用 --out 指定新的导出目录'); return opt.out; };
    let result;
    switch (command) {
      case 'new': {
        requireThat(opt['prompt-file'] && fs.statSync(opt['prompt-file']).size <= 128000, 'PROMPT_FILE_REQUIRED', '请用 --prompt-file 指定小于 128 KB 的 UTF-8 文本文件');
        result = store.create(makeDraft(fs.readFileSync(opt['prompt-file'], 'utf8').replace(/^\uFEFF/, ''), opt.mode ?? 'mj_web')); break;
      }
      case 'import-prompt': {
        const value = readJson(id, EXCHANGE_LIMIT);
        result = value.schemaVersion === 'prompt-wizard-exchange/1' ? importExchange(store, value, opt.mode ?? 'mj_web') : store.create(fromPromptWizard(value, opt.mode ?? 'mj_web')); break;
      }
      case 'import-package': result = store.create(readJson(id), path.dirname(path.resolve(id))); break;
      case 'list': result = store.read().tasks.map(task => ({ taskId: task.taskId, revision: task.head, mode: task.revisions[task.head - 1].mode, status: taskStatus(task), runs: task.runs.length, results: task.results.length })); break;
      case 'show': { const task = store.get(id); result = opt.snapshot ? task.revisions[task.head - 1] : { ...task, status: taskStatus(task) }; break; }
      case 'revise': result = store.revise(id, revision, readJson(rest[0]), path.dirname(path.resolve(rest[0]))); break;
      case 'confirm': result = store.confirm(id, revision, { promptReviewed: opt['prompt-reviewed'], settingsReviewed: opt['settings-reviewed'], referencesReviewed: opt['references-reviewed'] }); break;
      case 'handoff': result = store.export(id, revision, outputDir(), { handoff: true }); break;
      case 'submitted': result = store.recordSubmission(id, revision, opt['request-id'], opt.url ?? null); break;
      case 'import-results': result = store.importResults(id, revision, opt.run, rest); break;
      case 'select': requireThat(['true', 'false'].includes(opt.selected), 'INVALID_SELECTION', '--selected 只能为 true 或 false'); result = store.select(id, opt.result, opt.selected === 'true'); break;
      case 'export': result = store.export(id, revision, outputDir(), { promptOnly: opt['prompt-only'] ?? false, runId: opt.run ?? null }); break;
      case 'banana-submit': store.get(id); result = store.submitBanana(); break;
      case 'recover-lock': result = store.recoverLock(); break;
      default: throw new Error('未知命令，请运行 npm run workbench -- help');
    }
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  console.error(JSON.stringify({ error: { code: error.code ?? 'COMMAND_FAILED', message: error.message } }, null, 2));
  process.exitCode = 1;
}
