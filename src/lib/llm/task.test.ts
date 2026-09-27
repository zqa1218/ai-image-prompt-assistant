import { describe, expect, it } from 'vitest'
import { REFINE } from '../../workflows/index.ts'
import type { WizardImage } from '../wizardTypes.ts'
import { buildExtractTask, buildStageTask, type TaskInput } from './task.ts'

function image(name: string, role: 'original' | 'reference'): WizardImage {
  return {
    name,
    dataUrl: 'data:image/jpeg;base64,AAAA',
    width: 1200,
    height: 1600,
    bytes: 200_000,
    role,
  }
}

const stage = (id: string) => REFINE.stages.find((s) => s.id === id)!

function baseInput(overrides: Partial<TaskInput> = {}): TaskInput {
  return {
    workflow: REFINE,
    stage: stage('compose'),
    intake: { requirement: '让产品更高级' },
    images: [],
    analysis: '',
    options: [],
    selectedOptionId: null,
    notes: [],
    artifact: null,
    directives: [],
    ...overrides,
  }
}

describe('图片职责描述', () => {
  it('只有原图时，说明 REFERENCE_0 且不提参考图编号', () => {
    const task = buildStageTask(baseInput({ images: [image('cup.jpg', 'original')] }))
    expect(task).toContain('REFERENCE_0')
    expect(task).toContain('cup.jpg')
    expect(task).not.toContain('参考图1')
  })

  it('带参考图时按顺序编号，并明确它不是第二张原图', () => {
    const task = buildStageTask(
      baseInput({
        images: [
          image('room.jpg', 'original'),
          image('chair.png', 'reference'),
          image('lamp.png', 'reference'),
        ],
      }),
    )
    expect(task).toContain('原图（统一称为 REFERENCE_0）：room.jpg')
    expect(task).toContain('参考图1：chair.png')
    expect(task).toContain('参考图2：lamp.png')
    expect(task).toContain('不要把它当成第二张原图')
  })

  it('原图排在参考图之后时，编号依然按参考图自己的顺序数', () => {
    const task = buildStageTask(
      baseInput({
        images: [image('a.png', 'reference'), image('b.png', 'reference'), image('c.jpg', 'original')],
      }),
    )
    expect(task).toContain('参考图1：a.png')
    expect(task).toContain('参考图2：b.png')
  })
})

describe('需求与规则拼装', () => {
  it('空值字段不会出现在用户需求里', () => {
    const task = buildStageTask(baseInput({ intake: { requirement: '加个台座', usage: '' } }))
    expect(task).toContain('需求：加个台座')
    expect(task).not.toContain('用途：')
  })

  it('多选值用顿号回显', () => {
    const task = buildStageTask(
      baseInput({ intake: { requirement: 'x', taskType: '质感升级,置入物体' } }),
    )
    expect(task).toContain('任务类型：质感升级、置入物体')
  })

  it('专项规则单独成段并标注必须遵守', () => {
    const task = buildStageTask(
      baseInput({
        directives: [{ label: '地台与环境物品专项', instruction: '必须有接触阴影', source: 'x' }],
      }),
    )
    expect(task).toContain('## 已启用的专项规则（必须遵守）')
    expect(task).toContain('地台与环境物品专项：必须有接触阴影')
  })

  it('迭代阶段会把本轮修改重点写进去，并限定只改这一处', () => {
    const task = buildStageTask(baseInput({ focus: '把禁止项里的塑料感换成蜡质感' }))
    expect(task).toContain('## 本轮修改重点（只改这一处）')
    expect(task).toContain('把禁止项里的塑料感换成蜡质感')
    expect(task).toContain('其余内容必须与上一版保持一致')
  })
})

describe('输出要求', () => {
  it('JSON 输出要求里必须出现 json 字样（DeepSeek 的硬性要求）', () => {
    for (const id of ['direction', 'compose']) {
      const task = buildStageTask(baseInput({ stage: stage(id) }))
      expect(task).toContain('json')
    }
  })

  it('精修线的生成阶段要求用四个中文标记分段', () => {
    const task = buildStageTask(baseInput({ stage: stage('compose') }))
    for (const marker of ['【保留项】', '【修改项】', '【禁止项】', '【参数】']) {
      expect(task).toContain(marker)
    }
  })

  it('分析阶段要求只写事实、不给建议', () => {
    const task = buildStageTask(baseInput({ stage: stage('analyze') }))
    expect(task).toContain('只写画面中可见的事实')
    expect(task).toContain('不要给出修改建议')
  })
})

describe('输出尺寸', () => {
  it('「原图尺寸」会展开成实际像素 —— 模型看不到原图的实际尺寸', () => {
    const task = buildStageTask(
      baseInput({
        intake: { requirement: 'x', outputSize: '原图尺寸' },
        images: [
          {
            name: 'a.jpg',
            dataUrl: 'data:image/jpeg;base64,AAAA',
            width: 1200,
            height: 1600,
            bytes: 100,
            role: 'original',
          },
        ],
      }),
    )
    expect(task).toContain('输出尺寸：原图尺寸（1200×1600）')
  })

  it('没有原图时不展开，也不报错', () => {
    const task = buildStageTask(baseInput({ intake: { requirement: 'x', outputSize: '原图尺寸' } }))
    expect(task).toContain('输出尺寸：原图尺寸')
    expect(task).not.toContain('×')
  })

  it('自定义尺寸原样透传', () => {
    const task = buildStageTask(
      baseInput({ intake: { requirement: 'x', outputSize: '自定义', outputSizeCustom: '2000×2500' } }),
    )
    expect(task).toContain('自定义尺寸：2000×2500')
  })
})

describe('参考图可导入项', () => {
  const items = [
    {
      id: 'a',
      category: '背景' as const,
      label: '冷灰渐变背板',
      description: '哑光涂料，弱颗粒',
      source: '参考图1',
    },
    {
      id: 'b',
      category: '光线' as const,
      label: '右上侧逆光',
      description: '窄高光带，投影朝左下',
      source: '参考图2',
    },
  ]

  it('勾选的项按类别写进请求，并限定只迁移这些', () => {
    const task = buildStageTask(baseInput({ selectedReferenceItems: items }))
    expect(task).toContain('## 要从参考图导入的内容（用户已勾选）')
    expect(task).toContain('[背景] 冷灰渐变背板（来自参考图1）：哑光涂料，弱颗粒')
    expect(task).toContain('[光线] 右上侧逆光（来自参考图2）')
    expect(task).toContain('未勾选的内容不要引入')
  })

  it('没有勾选时不出现这一段', () => {
    expect(buildStageTask(baseInput({ selectedReferenceItems: [] }))).not.toContain(
      '要从参考图导入的内容',
    )
  })

  it('拆解任务只描述参考图，明确说明原图不在请求里', () => {
    const task = buildExtractTask(
      baseInput({
        images: [
          { ...image('room.jpg', 'original') },
          { ...image('chair.png', 'reference') },
          { ...image('lamp.png', 'reference') },
        ],
      }),
    )
    expect(task).toContain('- 参考图1：chair.png')
    expect(task).toContain('- 参考图2：lamp.png')
    expect(task).not.toContain('room.jpg')
    expect(task).toContain('原图不在本次请求中')
    expect(task).toContain('json')
  })
})
