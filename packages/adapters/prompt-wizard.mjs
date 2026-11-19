import { makeDraft } from '../core/draft.mjs';
import { requireThat, validateInput } from '../core/validation.mjs';

// PromptOutput exports an Artifact, not a generation task or a complete asset bundle.
export function fromPromptWizard(artifact, mode) {
  requireThat(artifact && typeof artifact === 'object' && typeof artifact.prompt === 'string', 'INVALID_ARTIFACT', '请选择 Prompt Wizard 的最终产物 JSON（包含 prompt 字段）');
  for (const field of ['params', 'checklist']) {
    requireThat(artifact[field] === undefined || (Array.isArray(artifact[field]) && artifact[field].length <= 100 && artifact[field].every(x => typeof x === 'string' && x.length <= 4000)), 'INVALID_ARTIFACT', `${field} 必须是字符串数组`);
  }
  requireThat(artifact.channel === undefined || (typeof artifact.channel === 'string' && artifact.channel.length <= 4000), 'INVALID_ARTIFACT', 'channel 必须是文本');
  requireThat(artifact.workflowId === undefined || (typeof artifact.workflowId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(artifact.workflowId)), 'INVALID_ARTIFACT', 'workflowId 格式无效');
  requireThat(artifact.schemaVersion === undefined || artifact.schemaVersion === 'prompt-wizard-artifact/1', 'INVALID_ARTIFACT', '不支持此 Prompt Wizard 产物版本');
  const draft = makeDraft(artifact.prompt, mode);
  draft.prompt.source = 'prompt_wizard';
  draft.prompt.workflowId = artifact.workflowId ?? null;
  // Do not guess workflowId, asset roles or provider from human-facing channel text.
  draft.prompt.intent = [
    '从 Prompt Wizard 最终产物导入。此 JSON 不包含生产参考图；请重新附加并确认。',
    artifact.channel ? `原通道说明：${artifact.channel}` : '',
    ...(artifact.params ?? []).map(x => `待核对参数方案：${x}`),
    ...(artifact.checklist ?? []).map(x => `原检查项：${x}`),
  ].filter(Boolean).join('\n');
  if (mode === 'mj_web') draft.settings.websiteChecklist = [...(artifact.params ?? []).map(x => `待人工选择/核对，不会自动追加：${x}`), ...(artifact.checklist ?? [])];
  return validateInput(draft);
}
