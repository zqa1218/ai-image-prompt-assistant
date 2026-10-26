// Verified against official API docs on 2026-10-26. Presets never contain credentials.
export const MODEL_PRESETS = [
  { id: 'deepseek-flash', name: 'DeepSeek Flash · 日常优化与档案推荐', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', format: 'json_object', note: '日常改写、去人物化、命名优先尝试；官方 Chat Completions 支持 JSON Object。关闭深度思考，输出上限 8192 tokens。' },
  { id: 'deepseek-pro', name: 'DeepSeek V4 Pro · 复杂约束备选', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-pro', format: 'json_object', note: '复杂要求与方向分析备选，费用高于 Flash；启用低强度思考，输出上限 16384 tokens（含思考）。不是默认批量整理模型。' },
  { id: 'minimax-cn', name: 'MiniMax M3.1 Flash · 国内站', baseUrl: 'https://api.minimaxi.com/v1', model: 'MiniMax-M3.1-Flash', format: 'prompt', note: '使用国内站平台签发的 Key；模型权限以该账户为准。低强度思考并分离思考字段，上限 16384 tokens。未确认原生 JSON 模式，使用提示词约束＋本地严格校验。' },
  { id: 'minimax-global', name: 'MiniMax M3.1 Flash · 国际站', baseUrl: 'https://api.minimax.io/v1', model: 'MiniMax-M3.1-Flash', format: 'prompt', note: '使用国际站平台签发的 Key，请勿与国内站混用；不自动跨站尝试。低强度思考，上限 16384 tokens；提示词约束＋本地严格校验。' },
]
export function presetForm(id) {
  const p = MODEL_PRESETS.find(p => p.id === id)
  if (!p) throw Error('未知模型预设')
  return { id: '', name: p.name, baseUrl: p.baseUrl, model: p.model, format: p.format, apiKey: '' }
}
export function officialRequestOptions(profile) {
  const u = new URL(profile.baseUrl)
  // Never send vendor-only switches to proxies, similar-looking domains, or arbitrary custom models.
  if (u.protocol !== 'https:' || u.port || u.username || u.password) return {}
  if (u.hostname === 'api.deepseek.com' && ['/', '/v1', '/v1/'].includes(u.pathname)) {
    if (profile.model === 'deepseek-flash') return { thinking: { type: 'disabled' }, max_tokens: 8192 }
    if (profile.model === 'deepseek-v4-pro') return { thinking: { type: 'enabled' }, reasoning_effort: 'low', max_tokens: 16384 }
  }
  if (['api.minimaxi.com', 'api.minimax.io'].includes(u.hostname) && ['/v1', '/v1/'].includes(u.pathname) && profile.model === 'MiniMax-M3.1-Flash')
    return { reasoning_split: true, reasoning_effort: 'low', max_completion_tokens: 16384 }
  return {}
}
