/** 一个方案只对应一个模型和模式；拒答或不可用时直接报告，不降级。 */
export const MODEL_MATCHERS = {
  Argon: { name: 'Argon', includes: ['Argon'], excludes: [] },
  Pro: { name: 'Pro', includes: ['Pro'], excludes: [] },
  Flash: { name: 'Flash', includes: ['Flash'], excludes: ['Lite'] },
  'Flash-Lite': { name: 'Flash-Lite', includes: ['Flash-Lite'], excludes: [] },
}

export const GEMINI_PLANS = [
  { id: 'flash', mode: 'chat', model: 'Flash', label: '3.8 Flash · 对话', note: '仅使用 Flash，对话模式' },
  { id: 'lite', mode: 'chat', model: 'Flash-Lite', label: '3.5 Flash-Lite · 对话', note: '仅使用 Flash-Lite，对话模式' },
  { id: 'pro', mode: 'chat', model: 'Pro', label: '3.1 Pro · 对话', note: '仅使用 Pro，对话模式' },
  { id: 'argon', mode: 'chat', model: 'Argon', label: '4 Argon · 对话', note: '仅使用 Argon，对话模式' },
  { id: 'argon-task', mode: 'task', model: 'Argon', label: '4 Argon · 任务', note: '用户实测短文本提示词生成有效且响应快；图片与长模板效果待验证' },
]

export const DEFAULT_PLAN_ID = 'flash'
export const THINKING_LEVELS = ['', '低点', '中等', '高点']

export function planOptions() {
  return GEMINI_PLANS.map(({ id, label, note }) => ({ id, label, note }))
}

export function resolvePlan(id = DEFAULT_PLAN_ID) {
  const plan = GEMINI_PLANS.find((plan) => plan.id === id)
  if (!plan) throw new Error('未知的 Gemini 网页方案，请重新选择')
  return plan
}

/**
 * 设置文件里存了未知方案（手改过、或来自更早的版本）时回退到默认方案。
 * 提交时仍然严格校验，这里只用于把界面拉回一个可用状态。
 */
export function coercePlanId(id) {
  return GEMINI_PLANS.some((plan) => plan.id === id) ? id : DEFAULT_PLAN_ID
}

export function modelMatcher(name) {
  const value = String(name || '').trim()
  return MODEL_MATCHERS[value] || { name: value, includes: [value], excludes: [] }
}
