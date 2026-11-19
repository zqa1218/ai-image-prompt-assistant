import { describe, expect, it } from 'vitest'
import { REFINE } from '../../workflows/index.ts'
import { visibleFields } from '../fields.ts'
import { buildExtractTask, buildStageTask, type TaskInput } from './task.ts'
import { HAIR_TEXTURE } from './hairTask.ts'

function input(stage: string, selected = true): TaskInput {
  return { workflow: REFINE, stage: REFINE.stages.find(s => s.id === stage)!,
    intake: { requirement: '只修后发，保留刘海', taskType: selected ? '厚涂修发' : '头发精修', hairMode: '参考严格复刻' },
    images: [], analysis: '', options: [], selectedOptionId: null, notes: [], artifact: null, directives: [] }
}

describe('厚涂修发完整路径', () => {
  it('选择任务才显示修发模式，旧需求不注入新规则', () => {
    expect(visibleFields(REFINE.stages[0], input('compose').intake).some(f => f.key === 'hairMode')).toBe(true)
    expect(visibleFields(REFINE.stages[0], input('compose', false).intake).some(f => f.key === 'hairMode')).toBe(false)
    expect(buildStageTask(input('compose', false))).not.toContain('厚涂修发专项')
  })
  it('分析、方向和细化加载规则但保留各自输出协议', () => {
    expect(buildStageTask(input('analyze'))).toContain('未附带参考图，不推断参考发束数量')
    expect(buildStageTask(input('direction'))).toContain('"options"')
    expect(buildStageTask(input('detail'))).toContain('模式：参考严格复刻')
  })
  it('参考拆解只读参考、提取结构且仍返回 items', () => {
    const task = buildExtractTask(input('analyze'))
    expect(task).toContain('本轮只看参考图')
    expect(task).toContain('主发束数量')
    expect(task).toContain('"items"')
  })
  it('生成与迭代含三句原文和专项分段，无通用格式冲突', () => {
    for (const focus of [undefined, '只改善高光，轮廓不动']) {
      const task = buildStageTask({ ...input('compose'), focus })
      for (const sentence of HAIR_TEXTURE.split('\n')) expect(task).toContain(sentence)
      expect(task).toContain('【针对当前底图的走势】')
      expect(task).toContain('"prompt"')
      expect(task).not.toContain('不加标题、编号')
      if (focus) expect(task).toContain(focus)
    }
  })
})
