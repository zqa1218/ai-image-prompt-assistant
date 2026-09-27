import { beforeEach, describe, expect, it } from 'vitest'
import { MOCK_PROVIDER, setProvider, useWizard } from './wizardStore.ts'

const api = () => useWizard.getState()

function fillIntake(requirement = '让产品看起来更高级') {
  api().setIntake('requirement', requirement)
  api().setOriginal({
    name: 'sample.png',
    dataUrl: 'data:image/png;base64,',
    width: 1200,
    height: 1600,
    bytes: 200_000,
  })
}

beforeEach(() => {
  // 默认提供方是真实模型，测试里换成假数据，避免打网络
  setProvider(MOCK_PROVIDER)
  api().reset()
})

describe('六步状态机', () => {
  it('原图精修线：不接模型也能从第 0 步走到第 5 步', async () => {
    api().start('refine')
    fillIntake()

    await api().advance()
    expect(api().stageIndex).toBe(1)
    expect(api().records['analyze']?.status).toBe('ready')
    expect(api().records['analyze']?.output).toContain('【主体】')
    expect(api().records['analyze']?.output).toContain('演示数据')

    await api().advance()
    expect(api().stageIndex).toBe(2)
    expect(api().options.length).toBeGreaterThanOrEqual(2)
    expect(api().options.some((o) => o.recommended)).toBe(true)

    await api().advance()
    expect(api().stageIndex).toBe(3)
    expect(api().artifact).toBeNull()

    await api().advance()
    expect(api().stageIndex).toBe(4)
    expect(api().artifact?.prompt).toContain('【保留项】')
    expect(api().artifact?.prompt).toContain('【禁止项】')

    await api().advance()
    expect(api().stageIndex).toBe(5)
  })

  it('用户不选方向时按推荐项推进，并明确告知', async () => {
    api().start('refine')
    fillIntake()
    await api().advance()
    await api().advance()

    expect(api().selectedOptionId).toBeNull()
    await api().advance()

    const recommended = api().options.find((o) => o.recommended)
    expect(api().selectedOptionId).toBe(recommended?.id)
    expect(api().notice).toContain('推荐项')
  })

  it('回退后下游产出全部作废', async () => {
    api().start('refine')
    fillIntake()
    await api().advance()
    await api().advance()
    await api().advance()
    await api().advance()
    expect(api().artifact).not.toBeNull()

    api().goTo(1)

    expect(api().stageIndex).toBe(1)
    expect(api().options).toHaveLength(0)
    expect(api().selectedOptionId).toBeNull()
    expect(api().artifact).toBeNull()
    expect(api().records['compose']?.status).toBe('idle')
    expect(api().notice).toContain('作废')
  })

  it('回退后重新推进会重新跑分析，不残留旧结果', async () => {
    api().start('refine')
    fillIntake()
    await api().advance()
    const first = api().records['analyze']?.output

    api().goTo(0)
    expect(api().records['analyze']?.status).toBe('idle')

    await api().advance()
    expect(api().stageIndex).toBe(1)
    expect(api().records['analyze']?.status).toBe('ready')
    expect(api().records['analyze']?.output).toBe(first)
  })

  it('改动接收阶段的输入会作废下游', async () => {
    api().start('refine')
    fillIntake()
    await api().advance()
    await api().advance()
    expect(api().options.length).toBeGreaterThan(0)

    api().setIntake('requirement', '换成另一种要求')

    expect(api().options).toHaveLength(0)
    expect(api().records['analyze']?.status).toBe('idle')
  })

  it('参考重构线产出 MJ 提示词与参数矩阵', async () => {
    api().start('recompose')
    fillIntake('用这套写真的语言换一种风格')
    await api().advance()
    await api().advance()

    expect(api().options).toHaveLength(3)

    await api().advance()
    await api().advance()

    const artifact = api().artifact
    expect(artifact?.prompt).toContain('--ar 3:4')
    expect(artifact?.params?.some((p) => p.includes('--style raw'))).toBe(true)
    expect(artifact?.checklist?.length).toBeGreaterThan(0)
    expect(artifact?.channel).toContain('本人')
  })

  it('迭代会更新提示词并记录往返消息', async () => {
    api().start('refine')
    fillIntake()
    await api().advance()
    await api().advance()
    await api().advance()
    await api().advance()

    const before = api().artifact?.prompt
    await api().sendFeedback('把禁止项里的塑料感换成蜡质感')

    expect(api().artifact?.prompt).not.toBe(before)
    expect(api().artifact?.prompt).toContain('把禁止项里的塑料感换成蜡质感')
    expect(api().messages).toHaveLength(2)
    expect(api().messages[0].role).toBe('user')
  })

  it('原图排在参考图前面，且参考图可增可删', () => {
    api().start('refine')
    fillIntake()
    api().addReference({
      name: 'chair.png',
      dataUrl: 'data:image/png;base64,AAAA',
      width: 800,
      height: 600,
      bytes: 100_000,
    })
    api().addReference({
      name: 'lamp.png',
      dataUrl: 'data:image/png;base64,AAAA',
      width: 800,
      height: 600,
      bytes: 100_000,
    })

    expect(api().references.map((r) => r.name)).toEqual(['chair.png', 'lamp.png'])
    expect(api().references.every((r) => r.role === 'reference')).toBe(true)
    expect(api().original?.role).toBe('original')

    api().removeReference(0)
    expect(api().references.map((r) => r.name)).toEqual(['lamp.png'])
  })

  it('增删参考图会作废下游结果', async () => {
    api().start('refine')
    fillIntake()
    await api().advance()
    await api().advance()
    expect(api().options.length).toBeGreaterThan(0)

    api().addReference({
      name: 'chair.png',
      dataUrl: 'data:image/png;base64,AAAA',
      width: 800,
      height: 600,
      bytes: 100_000,
    })

    expect(api().options).toHaveLength(0)
    expect(api().records['analyze']?.status).toBe('idle')
  })

  it('移除参考图时给出提示', () => {
    api().start('refine')
    fillIntake()
    api().addReference({
      name: 'chair.png',
      dataUrl: 'data:image/png;base64,AAAA',
      width: 800,
      height: 600,
      bytes: 100_000,
    })
    api().removeReference(0)
    expect(api().references).toHaveLength(0)
  })

  it('进入接收阶段时预填有默认值的字段', () => {
    api().start('refine')
    expect(api().intake['outputSize']).toBe('原图尺寸')
    api().start('recompose')
    expect(api().intake['outputSize']).toBe('原图尺寸')
  })

  it('有参考图时，分析之后会拆出可导入的参考项', async () => {
    api().start('refine')
    fillIntake()
    api().addReference({
      name: 'chair.png',
      dataUrl: 'data:image/png;base64,AAAA',
      width: 800,
      height: 600,
      bytes: 100_000,
    })

    await api().advance()
    expect(api().referenceItems.length).toBeGreaterThan(0)
    expect(api().referenceItems.some((item) => item.category === '背景')).toBe(true)
    expect(api().selectedReferenceItems).toEqual([])
    expect(api().records['extract']?.status).toBe('ready')
  })

  it('没有参考图时不产生可导入项', async () => {
    api().start('refine')
    fillIntake()
    await api().advance()
    expect(api().referenceItems).toEqual([])
  })

  it('勾选与取消导入项会作废下游，但保留分析与可导入项本身', async () => {
    api().start('refine')
    fillIntake()
    api().addReference({
      name: 'chair.png',
      dataUrl: 'data:image/png;base64,AAAA',
      width: 800,
      height: 600,
      bytes: 100_000,
    })
    await api().advance()
    await api().advance()
    expect(api().options.length).toBeGreaterThan(0)

    const firstId = api().referenceItems[0].id
    api().toggleReferenceItem(firstId)

    expect(api().selectedReferenceItems).toEqual([firstId])
    expect(api().options).toHaveLength(0)
    expect(api().records['analyze']?.status).toBe('ready')
    expect(api().referenceItems.length).toBeGreaterThan(0)

    api().toggleReferenceItem(firstId)
    expect(api().selectedReferenceItems).toEqual([])
  })

  it('换参考图会让已拆出的可导入项作废', async () => {
    api().start('refine')
    fillIntake()
    api().addReference({
      name: 'a.png',
      dataUrl: 'data:image/png;base64,AAAA',
      width: 800,
      height: 600,
      bytes: 100_000,
    })
    await api().advance()
    expect(api().referenceItems.length).toBeGreaterThan(0)

    api().addReference({
      name: 'b.png',
      dataUrl: 'data:image/png;base64,AAAA',
      width: 800,
      height: 600,
      bytes: 100_000,
    })
    expect(api().referenceItems).toEqual([])
    expect(api().selectedReferenceItems).toEqual([])
  })
})
