import { describe, expect, it } from 'vitest'
import { RECOMPOSE, REFINE } from '../workflows/index.ts'
import { resolveDirectives } from './directives.ts'
import { formatMulti, parseMulti, toggleMulti } from './multiValue.ts'

describe('多选字段', () => {
  it('空值、单值、多值都能解析', () => {
    expect(parseMulti(undefined)).toEqual([])
    expect(parseMulti('')).toEqual([])
    expect(parseMulti('社媒')).toEqual(['社媒'])
    expect(parseMulti('社媒,印刷')).toEqual(['社媒', '印刷'])
  })

  it('toggle 能加也能减，且保持原顺序', () => {
    let value = toggleMulti(undefined, '社媒')
    value = toggleMulti(value, '印刷')
    expect(value).toBe('社媒,印刷')
    expect(parseMulti(value)).toEqual(['社媒', '印刷'])

    value = toggleMulti(value, '社媒')
    expect(value).toBe('印刷')
  })

  it('重复勾选同一项不会产生重复值', () => {
    const once = toggleMulti(undefined, '置入物体')
    const back = toggleMulti(once, '置入物体')
    expect(back).toBe('')
    expect(parseMulti(toggleMulti(back, '置入物体'))).toEqual(['置入物体'])
  })

  it('formatMulti 用顿号回显', () => {
    expect(formatMulti('社媒,印刷')).toBe('社媒、印刷')
  })
})

describe('条件指令', () => {
  it('什么都没选时不追加任何专项规则', () => {
    expect(resolveDirectives(REFINE, {})).toHaveLength(0)
    expect(resolveDirectives(REFINE, { taskType: '' })).toHaveLength(0)
  })

  it('选了「置入物体」才挂上地台与环境物品专项规则', () => {
    const none = resolveDirectives(REFINE, { taskType: '替换背景' })
    expect(none.map((d) => d.label)).not.toContain('地台与环境物品专项')

    const withProp = resolveDirectives(REFINE, { taskType: '置入物体' })
    expect(withProp.map((d) => d.label)).toContain('地台与环境物品专项')
    expect(withProp[0].instruction).toContain('figure-base-rules')
  })

  it('可以同时触发多条规则', () => {
    const resolved = resolveDirectives(REFINE, {
      taskType: '置入物体,增加特效,替换背景',
    })
    expect(resolved.map((d) => d.label)).toEqual([
      '地台与环境物品专项',
      '光效为次级元素',
      '换背景的遮挡重建',
    ])
  })

  it('单选字段同样能触发指令（参考图职责）', () => {
    const resolved = resolveDirectives(RECOMPOSE, { referenceRole: '保持同一位人物' })
    expect(resolved.map((d) => d.label)).toEqual(['人物一致性'])
    expect(resolved[0].instruction).toContain('Omni Reference')
  })

  it('专项规则只作为请求级指令，不改变工作流的资产列表', () => {
    // 资产是工作流的静态属性：如果它随用户选择增减，缓存前缀就会失效。
    const before = [...REFINE.assets]
    resolveDirectives(REFINE, { taskType: '置入物体,生成场景,增加特效' })
    expect(REFINE.assets).toEqual(before)
    expect(REFINE.assets).toContain('figure-base-rules')
  })
})
