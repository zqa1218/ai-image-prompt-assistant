import fs from 'node:fs';
import crypto from 'node:crypto';
import { validateExchange, EXCHANGE_LIMIT } from '../../packages/adapters/prompt-wizard-exchange.mjs';

export function assertWizardSender(event, wizardWindow, wizardUrl) {
  if (!wizardWindow || event.sender !== wizardWindow.webContents || event.senderFrame !== event.sender.mainFrame ||
      new URL(event.senderFrame.url).origin !== wizardUrl) throw new Error('仅允许提示词助手主窗口执行交接');
}

export function createInstalledHandoff({ workbench, connectorFile, openWorkbench }) {
  return async function handoff(request) {
    if (!request || !['mj_web', 'banana_api'].includes(request.mode)) throw new Error('请选择 MJ 或 Banana 工作台');
    if (typeof request.sourceId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(request.sourceId)) throw new Error('缺少提示词来源标识');
    validateExchange(request.exchange);
    const body = JSON.stringify({ exchange: request.exchange, mode: request.mode });
    if (Buffer.byteLength(body) > EXCHANGE_LIMIT) throw new Error('图片和提示词超过 40 MiB，请减少参考图后重试');
    const key = 'pw041_' + crypto.createHash('sha256').update(request.sourceId + '\0' + body).digest('hex');
    const connector = JSON.parse(fs.readFileSync(connectorFile, 'utf8'));
    if (connector.url !== workbench.url) throw new Error('工作台连接已变化，请重启程序');
    const response = await fetch(`${workbench.url}/api/integrations/prompt-wizard/tasks`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-workbench-integration': connector.token, 'idempotency-key': key },
      body, signal: AbortSignal.timeout(30000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message ?? '工作台导入失败');
    // Import is durable before navigation; retrying a failed window open reuses the same task.
    await openWorkbench(data.task.taskId);
    return { taskId: data.task.taskId, revision: data.task.head, message: '已导入并打开对应任务' };
  };
}
