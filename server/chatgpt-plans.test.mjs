import { describe, expect, it } from 'vitest'
import {
  CHATGPT_PLANS,
  DEFAULT_CHATGPT_PLAN_ID,
  chatGptModelMatcher,
  chatGptPlanOptions,
  coerceChatGptPlanId,
  matchesChatGptModel,
  resolveChatGptPlan,
} from './chatgpt-plans.mjs'

describe('ChatGPT 网页方案', () => {
  it('默认方案是「沿用网页当前模型」，只读不切', () => {
    expect(DEFAULT_CHATGPT_PLAN_ID).toBe('current')
    expect(resolveChatGptPlan().keep).toBe(true)
    expect(resolveChatGptPlan('thinking').keep).toBe(false)
    expect(() => resolveChatGptPlan('unknown')).toThrow('未知的 ChatGPT 网页方案')
  })

  it('档位在中英文界面都能匹配，且不会串档', () => {
    const thinking = chatGptModelMatcher(resolveChatGptPlan('thinking'))
    expect(matchesChatGptModel(thinking, 'Thinking')).toBe(true)
    expect(matchesChatGptModel(thinking, 'ChatGPT 思考')).toBe(true)
    expect(matchesChatGptModel(thinking, 'Instant')).toBe(false)

    const instant = chatGptModelMatcher(resolveChatGptPlan('instant'))
    expect(matchesChatGptModel(instant, 'ChatGPT 5.1 Instant')).toBe(true)
    expect(matchesChatGptModel(instant, '快速')).toBe(true)
    expect(matchesChatGptModel(instant, 'Thinking')).toBe(false)

    const pro = chatGptModelMatcher(resolveChatGptPlan('pro'))
    expect(matchesChatGptModel(pro, 'Pro')).toBe(true)
    expect(matchesChatGptModel(pro, '')).toBe(false)
  })

  it('对外只暴露 id/label/note，未知存档值回退到默认方案', () => {
    expect(chatGptPlanOptions().map((plan) => plan.id)).toEqual(CHATGPT_PLANS.map((plan) => plan.id))
    expect(chatGptPlanOptions().every((plan) => plan.id && plan.label && plan.note)).toBe(true)
    expect(coerceChatGptPlanId('nope')).toBe(DEFAULT_CHATGPT_PLAN_ID)
    expect(coerceChatGptPlanId('pro')).toBe('pro')
  })
})
