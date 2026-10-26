import test from 'node:test'
import assert from 'node:assert/strict'
import { migratedOutput } from '../../src/lib/llm/migratedContracts.mjs'

const input = (workflow, stage = 'compose', focus = '', images = []) => ({workflow, stage:{id:stage}, focus, images})
test('三步生成契约保持三段职责与参考图编号约束', () => {
  const rule = migratedOutput(input({id:'refine-steps'}, 'compose', '', [{role:'reference'}]))
  for (const title of ['【第1步·背景与景别陈设】','【第2步·身体互动特效】','【第3步·氛围层】','本次共 1 张参考图']) assert.ok(rule.includes(title))
  assert.ok(migratedOutput(input({id:'refine-steps'})).includes('没有参考图可引用'))
})
test('重构正负面分块与资料、人设、待定项契约迁移', () => {
  assert.ok(migratedOutput(input({outputContract:'mj-prompt-en'})).includes('sections'))
  for (const [focus,key] of [['【资料收集】','inspiration'],['【人设解析】','turnaround'],['【待定项清单】','recommended']]) {
    assert.ok(migratedOutput(input({id:'refine'},'detail',focus)).includes(key))
  }
  assert.equal(migratedOutput(input({id:'refine'})), null)
})
