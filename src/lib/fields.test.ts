import { describe, expect, it } from 'vitest'
import { REFINE } from '../workflows/index.ts'
import { visibleFields } from './fields.ts'
import { parseMulti, toggleMulti } from './multiValue.ts'

const intakeStage = REFINE.stages.find((s) => s.id === 'intake')!

function keys(intake: Record<string, string>): string[] {
  return visibleFields(intakeStage, intake).map((field) => field.key)
}

describe('条件字段可见性', () => {
  it('没勾置入物体时，放置相关的问题全部不出现', () => {
    const shown = keys({})
    expect(shown).toContain('requirement')
    expect(shown).toContain('taskType')
    expect(shown).not.toContain('placementLayer')
    expect(shown).not.toContain('placementHorizontal')
    expect(shown).not.toContain('placementDistance')
    expect(shown).not.toContain('interaction')
    expect(shown).not.toContain('referenceRole')
  })

  it('勾了置入物体后，五个放置问题一起出现', () => {
    const shown = keys({ taskType: '置入物体' })
    expect(shown).toEqual(
      expect.arrayContaining([
        'referenceRole',
        'placementLayer',
        'placementHorizontal',
        'placementDistance',
        'interaction',
      ]),
    )
  })

  it('在别的任务类型里出现「置入物体」也能触发（多选里的任一项）', () => {
    const shown = keys({ taskType: '质感升级,置入物体,增加特效' })
    expect(shown).toContain('placementLayer')
  })

  it('取消勾选后重新隐藏', () => {
    let taskType = toggleMulti(undefined, '置入物体')
    expect(keys({ taskType })).toContain('placementLayer')
    taskType = toggleMulti(taskType, '置入物体')
    expect(parseMulti(taskType)).toEqual([])
    expect(keys({ taskType })).not.toContain('placementLayer')
  })

  it('不完全匹配的值不会误触发', () => {
    expect(keys({ taskType: '置入' })).not.toContain('placementLayer')
    expect(keys({ taskType: '置入物体X' })).not.toContain('placementLayer')
  })
})
