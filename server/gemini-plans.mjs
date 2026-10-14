/**
 * Gemini 网页端可选方案。
 *
 * models 是一条「尝试链」：先用第一个模型提交，如果网页端只回一句能力否认（实测 Argon 和 Pro 对
 * 「整段固定规则」这种长提示词会误判），就自动换链上的下一个模型重试，所以每个方案都能拿到有效回答。
 * 实测结论：Flash / Flash-Lite 基本不拒答；Argon、Pro 拒答率高，但换到 Flash 兜底后仍可用。
 * mode：chat = 对话模式；task = 任务模式（网页端要先在 Gemini 里同意「任务」条款才能用）。
 */
export const MODEL_MATCHERS = {
  Argon: { name: 'Argon', includes: ['Argon'], excludes: [] },
  Pro: { name: 'Pro', includes: ['Pro'], excludes: [] },
  Flash: { name: 'Flash', includes: ['Flash'], excludes: ['Lite'] },
  'Flash-Lite': { name: 'Flash-Lite', includes: ['Flash-Lite'], excludes: [] },
}

export const GEMINI_PLANS = [
  { id: 'flash', mode: 'chat', models: ['Flash', 'Flash-Lite'], label: '3.8 Flash · 对话', note: '默认：实测最稳，一般 1~3 分钟出结果' },
  { id: 'lite', mode: 'chat', models: ['Flash-Lite', 'Flash'], label: '3.5 Flash-Lite · 对话', note: '最快，实测 7~11 秒出结果' },
  { id: 'pro', mode: 'chat', models: ['Pro', 'Flash', 'Flash-Lite'], label: '3.1 Pro · 对话', note: '推理更强；Pro 常被误判拒答，会自动换 Flash 兜底，可能要几分钟' },
  { id: 'argon', mode: 'chat', models: ['Argon', 'Flash', 'Flash-Lite'], label: '4 Argon · 对话', note: '最先进；长规则常被拒答，实测约 4 分钟拿到结果（Argon → Flash → Flash-Lite）' },
]

export const DEFAULT_PLAN_ID = 'flash'
export const THINKING_LEVELS = ['', '低点', '中等', '高点']

export function planOptions() {
  return GEMINI_PLANS.map(({ id, label, note }) => ({ id, label, note }))
}

export function resolvePlan(id) {
  return GEMINI_PLANS.find((plan) => plan.id === id)
    || GEMINI_PLANS.find((plan) => plan.id === DEFAULT_PLAN_ID)
    || GEMINI_PLANS[0]
}

export function modelMatcher(name) {
  const value = String(name || '').trim()
  return MODEL_MATCHERS[value] || { name: value, includes: [value], excludes: [] }
}
