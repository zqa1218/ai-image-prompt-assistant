import { requireThat } from './validation.mjs';

export const MJ_CAPABILITIES = Object.freeze({
  updatedAt: '2026-11-12',
  sources: [
    { label: '官网创作流程', url: 'https://docs.midjourney.com/hc/en-us/articles/33390732264589-Creating-on-Web' },
    { label: '模型版本与兼容表', url: 'https://docs.midjourney.com/hc/en-us/articles/32199405667853-Version' },
    { label: 'V8 Edit Model', url: 'https://docs.midjourney.com/hc/en-us/articles/48495453462797-Edit-Model' },
    { label: '参数列表', url: 'https://docs.midjourney.com/hc/en-us/articles/32859204029709-Parameter-List' },
  ],
  versions: {
    '8.2': { editModel: true, editReferences: 4, hd: true, turbo: false, maxAspect: 14, maxHdAspect: 4, roles: ['image_prompt', 'style_reference', 'edit_reference'] },
    '8.1': { editModel: true, editReferences: 4, hd: true, turbo: false, maxAspect: 14, maxHdAspect: 4, roles: ['image_prompt', 'style_reference', 'edit_reference'] },
    '7': { editModel: false, editReferences: 0, hd: false, turbo: true, maxAspect: 14, roles: ['image_prompt', 'style_reference'] },
    '6.1': { editModel: false, editReferences: 0, hd: false, turbo: true, maxAspect: 14, roles: ['image_prompt', 'style_reference'] },
    '6': { editModel: false, editReferences: 0, hd: false, turbo: true, maxAspect: 14, roles: ['image_prompt', 'style_reference'] },
  },
});

export function validateMjCapabilities(input) {
  const settings = input.settings;
  for (const [name, value, max] of [['stylize', settings.stylize, 1000], ['chaos', settings.chaos, 100], ['weird', settings.weird, 3000], ['seed', settings.seed, 4294967295]]) {
    requireThat(value === null || value <= max, 'MJ_PARAMETER_RANGE', `${name} 超出当前官网文档记录的范围 0–${max}`);
  }
  const production = input.references.filter(ref => !ref.analysisOnly);
  requireThat(!production.some(ref => ['base', 'character_reference', 'mask'].includes(ref.role)), 'ROLE_REQUIRES_ADAPTER', 'MJ 官网交接不接受 base、旧 character/omni 或 mask 角色；V8 请使用 edit_reference，或标记仅分析');
  const capability = MJ_CAPABILITIES.versions[settings.modelVersion];
  if (!capability) return;
  requireThat(settings.speed !== 'turbo' || capability.turbo, 'MJ_CAPABILITY_CONFLICT', `${settings.modelVersion} 当前官网兼容表不支持 Turbo`);
  requireThat(settings.resolution !== 'hd' || capability.hd, 'MJ_CAPABILITY_CONFLICT', `${settings.modelVersion} 当前官网兼容表不支持 HD`);
  requireThat(production.every(ref => capability.roles.includes(ref.role)), 'MJ_CAPABILITY_CONFLICT', `所选素材角色与 ${settings.modelVersion} 的官网兼容表冲突`);
  const editCount = production.filter(ref => ref.role === 'edit_reference').length;
  requireThat(editCount <= capability.editReferences, 'MJ_EDIT_REFERENCE_LIMIT', `${settings.modelVersion} 最多使用 ${capability.editReferences} 张 Edit Model 参考图`);
  if (input.operation === 'edit') requireThat(capability.editModel && editCount > 0, 'MJ_EDIT_REFERENCE_REQUIRED', `${settings.modelVersion} 的编辑任务需要至少一张 edit_reference；当前 Edit Model 仅支持 8.1/8.2`);
  if (settings.aspectRatio) {
    const [width, height] = settings.aspectRatio.split(':').map(Number);
    const ratio = Math.max(width / height, height / width);
    const max = settings.resolution === 'hd' ? capability.maxHdAspect : capability.maxAspect;
    requireThat(ratio <= max, 'MJ_ASPECT_RATIO_LIMIT', `${settings.modelVersion}${settings.resolution === 'hd' ? ' HD' : ''} 当前最大长宽比为 ${max}:1`);
  }
}
