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
  it('默认方案进入工作模式并沿用网页当前模型', () => {
    expect(DEFAULT_CHATGPT_PLAN_ID).toBe('current')
    expect(resolveChatGptPlan().keep).toBe(true)
    expect(resolveChatGptPlan('gpt-6.1-sol').keep).toBe(false)
    expect(() => resolveChatGptPlan('unknown')).toThrow('未知的 ChatGPT 网页方案')
  })

  it('工作模型按完整名称匹配，6.1 Sol 不会串到 6 Sol', () => {
    const sol61 = chatGptModelMatcher(resolveChatGptPlan('gpt-6.1-sol'))
    expect(matchesChatGptModel(sol61, 'GPT-6.1 Sol')).toBe(true)
    expect(matchesChatGptModel(sol61, 'GPT-6 Sol')).toBe(false)

    const sol6 = chatGptModelMatcher(resolveChatGptPlan('gpt-6-sol'))
    expect(matchesChatGptModel(sol6, 'GPT-6 Sol')).toBe(true)
    expect(matchesChatGptModel(sol6, 'GPT-6.1 Sol')).toBe(false)

    const astra = chatGptModelMatcher(resolveChatGptPlan('gpt-6-astra'))
    expect(matchesChatGptModel(astra, 'GPT-6 Astra')).toBe(true)
    expect(matchesChatGptModel(astra, '')).toBe(false)
  })

  it('对外只暴露 id/label/note，未知存档值回退到默认方案', () => {
    expect(chatGptPlanOptions().map((plan) => plan.id)).toEqual(CHATGPT_PLANS.map((plan) => plan.id))
    expect(chatGptPlanOptions().every((plan) => plan.id && plan.label && plan.note)).toBe(true)
    expect(coerceChatGptPlanId('nope')).toBe(DEFAULT_CHATGPT_PLAN_ID)
    expect(coerceChatGptPlanId('gpt-6.1-sol')).toBe('gpt-6.1-sol')
    expect(coerceChatGptPlanId('thinking')).toBe(DEFAULT_CHATGPT_PLAN_ID)
  })
})
