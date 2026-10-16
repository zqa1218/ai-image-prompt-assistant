/**
 * ChatGPT 网页方案：一个方案对应一次模型选择。
 *
 * 网页上的模型名会随版本变化（GPT-5 / GPT-5 Thinking / GPT-5 Pro …），
 * 所以匹配用子串而不是写死全名，并提供一个「不切换」方案兜底：
 * 万一菜单文案又改了，选它仍能跑通整条工作流。
 */
export const CHATGPT_PLANS = [
  {
    id: 'current',
    label: '沿用网页当前模型',
    model: '',
    keep: true,
    anyOf: [],
    note: '不切换模型，直接使用 ChatGPT 网页里已经选好的那个；最稳，也最快',
  },
  {
    id: 'instant',
    label: 'Instant · 最快',
    model: 'Instant',
    keep: false,
    anyOf: ['instant', '即时', '快速', 'fast'],
    excludes: ['thinking', '思考', '推理', 'pro'],
    note: '固定切到 Instant 档；菜单里找不到就报错，不换成别的模型',
  },
  {
    id: 'thinking',
    label: 'Thinking · 推理',
    model: 'Thinking',
    keep: false,
    anyOf: ['thinking', '思考', '推理'],
    excludes: ['instant', '快速', 'pro'],
    note: '固定切到 Thinking 档，写提示词更细但更慢',
  },
  {
    id: 'pro',
    label: 'Pro · 最强',
    model: 'Pro',
    keep: false,
    anyOf: ['pro'],
    excludes: ['thinking', 'instant'],
    note: '固定切到 Pro 档；等你确认网页菜单里确实有这个模型再选',
  },
  {
    id: 'auto',
    label: '自动（由 ChatGPT 决定）',
    model: 'Auto',
    keep: false,
    anyOf: ['自动', 'auto'],
    note: '固定切到「自动」，由网页按请求自己挑模型',
  },
]

export const DEFAULT_CHATGPT_PLAN_ID = 'current'

export function chatGptPlanOptions() {
  return CHATGPT_PLANS.map(({ id, label, note }) => ({ id, label, note }))
}

export function resolveChatGptPlan(id = DEFAULT_CHATGPT_PLAN_ID) {
  const plan = CHATGPT_PLANS.find((item) => item.id === id)
  if (!plan) throw new Error('未知的 ChatGPT 网页方案，请重新选择')
  return plan
}

/** 设置文件里存了未知方案时回退到默认方案；提交时仍然严格校验。 */
export function coerceChatGptPlanId(id) {
  return CHATGPT_PLANS.some((plan) => plan.id === id) ? id : DEFAULT_CHATGPT_PLAN_ID
}

/**
 * 模型匹配：anyOf 里任意一个子串命中即算命中，excludes 命中即算不命中。
 * 与 Gemini 那边的 includes/excludes 相比多了一次「任一命中」，因为同一档模型
 * 在中文/英文界面上的叫法不同（Thinking / 思考）。
 */
export function chatGptModelMatcher(plan) {
  return {
    name: plan?.model || plan?.label || '',
    anyOf: Array.isArray(plan?.anyOf) ? plan.anyOf : [],
    excludes: Array.isArray(plan?.excludes) ? plan.excludes : [],
  }
}

export function matchesChatGptModel(candidate, text) {
  const value = String(text || '').toLowerCase()
  if (!value) return false
  if (candidate.excludes.some((needle) => value.includes(String(needle).toLowerCase()))) return false
  return candidate.anyOf.some((needle) => value.includes(String(needle).toLowerCase()))
}
