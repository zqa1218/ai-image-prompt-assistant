import { requireThat, validateReady } from './validation.mjs';
import { validateMjCapabilities } from './mj-capabilities.mjs';

export const MJ_CREATE_URL = 'https://www.midjourney.com/imagine';

// Conservative compiler: version-dependent settings remain an explicit website checklist.
export function compileMj(input) {
  requireThat(input.mode === 'mj_web', 'WRONG_MODE', '此操作仅适用于 MJ 官网模式');
  validateReady(input);
  validateMjCapabilities(input);
  const { prompt, settings: s } = input;
  // A reviewed, unchanged Wizard artifact may already be a complete MJ command. Keep its flags exactly once.
  const verbatimWizard = prompt.source === 'prompt_wizard' && prompt.exchange?.artifact.prompt === prompt.text &&
    ['aspectRatio', 'stylize', 'chaos', 'weird', 'seed', 'raw', 'modelVersion', 'speed', 'resolution'].every(field => s[field] === null);
  requireThat(verbatimWizard || !/(^|\s)--[a-z]/i.test(prompt.text), 'INLINE_PARAMETER_CONFLICT', '提示词正文包含参数；请移到结构化字段或官网核对单，避免重复覆盖');
  requireThat(!s.extraParameters.trim(), 'EXTRA_PARAMETERS_UNREVIEWED', '附加参数暂不自动编译；请逐项移入官网核对单');
  const values = [];
  for (const [field, flag] of [['aspectRatio', 'ar'], ['stylize', 's'], ['chaos', 'chaos'], ['weird', 'weird'], ['seed', 'seed']]) {
    if (s[field] !== null) values.push(`--${flag} ${s[field]}`);
  }
  if (s.raw === true) values.push('--raw');
  const websiteChecklist = [
    '在官网核对以下设置与参考图后，选择工作台转接或亲自提交。',
    `模型版本：${s.modelVersion ?? '未指定，需在官网选择'}；当前编译器不承诺该版本支持全部参数。`,
    `任务方式：${input.operation}；速度：${s.speed ?? '官网当前值'}；分辨率：${s.resolution ?? '官网当前值'}。`,
    `Raw：${s.raw === null ? '未指定，核对官网当前值' : s.raw ? '开启' : '关闭，需在官网明确关闭' }。`,
    '核对官网个性化、隐私、默认设置及参数有效范围。',
    ...input.references.filter(x => !x.analysisOnly).map(x => `上传 ${x.path}，用途 ${x.role}；本地路径不能代替官网上传后的图片。`),
    ...input.references.filter(x => x.analysisOnly).map(x => `${x.assetId} 仅用于分析，不属于提交素材。`),
    ...s.websiteChecklist,
  ];
  return { url: MJ_CREATE_URL, promptText: [prompt.text.trim(), ...values].join(' '), websiteChecklist };
}
