/**
 * ChatGPT 工作模式方案：先进入「工作」，再按方案选择模型。
 *
 * 网页上的模型名会随版本变化，所以匹配用子串而不是依赖 DOM class，
 * 并提供一个「不切换模型」方案兜底：
 * 万一菜单文案又改了，选它仍能跑通整条工作流。
 */
export const CHATGPT_PLANS = [
  {
    id: 'current',
    label: '工作 · 沿用当前模型',
    model: '',
    keep: true,
    anyOf: [],
    note: '每次都确认进入工作模式，模型和思考强度沿用网页当前选择',
  },
  {
    id: 'gpt-6.1-sol',
    label: '工作 · GPT-6.1 Sol',
    model: 'GPT-6.1 Sol',
    keep: false,
    anyOf: ['gpt-6.1 sol'],
    excludes: [],
    note: '固定进入工作模式并选择 GPT-6.1 Sol；不可用时直接报错',
  },
  {
    id: 'gpt-6-astra',
    label: '工作 · GPT-6 Astra',
    model: 'GPT-6 Astra',
    keep: false,
    anyOf: ['gpt-6 astra'],
    excludes: [],
    note: '固定进入工作模式并选择 GPT-6 Astra；不可用时直接报错',
  },
  {
    id: 'gpt-6-sol',
    label: '工作 · GPT-6 Sol',
    model: 'GPT-6 Sol',
    keep: false,
    anyOf: ['gpt-6 sol'],
    excludes: ['6.1'],
    note: '固定进入工作模式并选择 GPT-6 Sol；不可用时直接报错',
  },
  {
    id: 'gpt-6-luna',
    label: '工作 · GPT-6 Luna',
    model: 'GPT-6 Luna',
    keep: false,
    anyOf: ['gpt-6 luna'],
    excludes: [],
    note: '固定进入工作模式并选择 GPT-6 Luna；不可用时直接报错',
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
 * 在不同账号上的版本前后缀可能不同。
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
