import type { Artifact, DirectionOption, Provider, ReferenceItem } from './wizardTypes.ts'

/**
 * 演示模式的假数据提供方：不联网也能把六步流程完整走通。
 * M3 会换成真实 DeepSeek 调用，接口契约保持不变。
 */
const DELAY = 450

function wait<T>(value: T, ms = DELAY): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

/** 每段示例文案都带上这句，避免被当成真实分析结果。 */
const PLACEHOLDER = '【演示数据】以下内容来自内置示例，不会读取你上传的图片。\n\n'

const REFINE_ANALYSIS = `【主体】深灰色陶瓷马克杯，杯口朝向斜上方，位于画面中偏右下，约占画幅 42%。
【构图】3:4 竖幅，机位略高于杯口，可视地平线约在画面下三分之一处，透视方向自左上向右下，视觉中心落在杯沿，右上角留白。
【光照】疑似单侧柔光箱自左上 45° 入射，边缘过渡柔和；杯体左侧有一道窄轮廓光，投影落向右下并逐渐虚化。
【色彩】整体冷中性偏灰，主色为中灰，辅色为桌面浅木色与少量暖色高光，反差中等。
【镜头】疑似 85mm 等效焦段，浅景深，背景虚化明显，杯体边缘无可见畸变。
【材质】釉面半哑光，可见细微釉点与不均匀反射；木纹桌面有清晰年轮走向与少量磨损。
【接触关系】杯底与桌面接触边缘有一圈变深的接触阴影，投影自杯底向右下延伸约杯高的一半。
【画面层级】主体清晰区在杯体与杯沿，主导大形为杯身，次级细节为桌面木纹，右上为低细节留白。
【禁区】杯体无文字与 Logo，需保留釉面瑕疵的真实感。

需要用户确认的点：1) 是否保留桌面木纹；2) 是否需要保留当前的冷调。`

const REFINE_OPTIONS: DirectionOption[] = [
  {
    id: 'refine-minimal',
    title: '最小干预：只修质感',
    change: '保留现有场景与构图，只修正白平衡、局部反差与杯体的釉面反射',
    outcome: '画面更通透，釉面高光收窄，接触阴影加深半档，整体观感更干净但不改变任何构图元素',
    risk: '提升幅度有限；如果原图本身光影平，改善不会明显',
    channel: 'Codex imagegen / GPT Image 2 编辑',
    recommended: true,
  },
  {
    id: 'refine-medium',
    title: '中度重构：重做光线',
    change: '保留杯体与桌面，把光源改为右上侧逆光并补一块正面反光板',
    outcome: '杯口出现一条连续的高光边缘，投影方向翻转到左下，桌面木纹被侧光强调',
    risk: '需要重建全部投影与接触阴影关系，处理不好会出现两套光向',
    channel: 'Codex imagegen / GPT Image 2 编辑',
    recommended: false,
  },
  {
    id: 'refine-strong',
    title: '强风格化：暗调静物',
    change: '换成暗调棚拍，压暗背景，只留一条硬光切开杯体',
    outcome: '高反差、低明度的电影感静物，背景近乎全黑，杯体边缘出现硬朗的高光切割',
    risk: '会明显改变原始色调与光的软硬，商品色准下降，不适合需要还原真实颜色的用途',
    channel: 'Codex imagegen / GPT Image 2 编辑',
    recommended: false,
  },
]

const REFINE_ARTIFACT: Artifact = {
  prompt: `【保留项】严格保持 REFERENCE_0 中马克杯的形态、杯口弧度、把手位置、身体比例、釉面瑕疵与整体构图、镜头位置、画面比例、原始背景与光照方向不变。不得改变杯体轮廓与杯壁厚度。

【修改项】在杯体与桌面接触区域增强真实感：收窄杯沿高光宽度约三成，使其集中在杯口左上弧段；加深杯底接触阴影半档并保持向右下延伸的自然衰减；提高桌面木纹在中景处的清晰度，同时保留景深造成的边缘虚化；将整体白平衡向中性收约 200K，去掉冷调偏色。所有改动必须沿用原图自左上 45° 的柔光方向，不得引入第二光源。

【禁止项】不要出现随机文字、乱码、水印、Logo、重复复制杯体、悬浮、穿模、错误透视、过度锐化、塑料感；不要把釉面处理成镜面反射；不要改变杯底与桌面的接触点位置。

【参数】输出比例 3:4，数量 1，编辑强度 低。`,
  channel: '喂给 Codex imagegen 或 GPT Image 2 的编辑接口，把原图作为 REFERENCE_0 一并传入',
  params: ['比例 3:4', '数量 1', '编辑强度 低'],
}

const RECOMPOSE_ANALYSIS = `【主体】一位成年女性，侧身回眸，上身入画，位于画面左侧三分线，约占画幅 38%。
【构图】3:4 竖幅，机位与眼部齐平，无可见地平线，透视平缓，视觉中心落在眼睛，右侧为大片负空间。
【光照】疑似阴天窗光，光源大而软，方向自画面右前方；面部右侧有明显主光，左侧靠环境反射补光，鼻梁与下颌有柔和过渡带，投影极淡。
【色彩】低饱和暖灰调，肤色略偏青，背景为米白墙面与浅灰布帘，反差偏低，整体高明度。
【镜头】疑似 50mm 等效焦段，中浅景深，背景轻微虚化但仍可辨结构，无明显畸变。
【材质】皮肤为哑光质地，可见真实毛孔与细小绒毛；布料为细密棉麻，褶皱柔和；墙面疑似涂料，有轻微颗粒。
【接触关系】人物右肩与衣料自然垂落，无支撑物接触。
【画面层级】主体清晰区在面部与眼周，主导大形为人物轮廓，次级细节为衣料褶皱，右侧为低细节留白。
【禁区】画面无文字与 Logo。

风格机制层：白平衡偏暖约 300K，曝光略过一档，高光滚降低平缓，反差低，锐度集中在眼周与睫毛，颗粒极细，压缩痕迹不可见，景深约 f/2.8。

需要用户确认的点：1) 参考图承担的是"怎么拍"还是"谁"；2) 是否保留阴天窗光这一条光线机制。`

const RECOMPOSE_OPTIONS: DirectionOption[] = [
  {
    id: 'recompose-film',
    title: '换到胶片质感',
    change: '保留阴天窗光与右侧负空间，把成像机制换成 400 度负片的色彩响应',
    outcome: '高光偏奶油色，阴影带青，颗粒变粗且颗粒分布不均匀，肤色饱和度略降、明度略升',
    risk: '颗粒会削弱皮肤的细腻纹理，近景需控制颗粒强度',
    channel: 'Midjourney（由你本人提交）',
    recommended: true,
  },
  {
    id: 'recompose-studio',
    title: '换成硬光棚拍',
    change: '保留构图与机位，把大软光换成单支硬光加一块黑色挡板',
    outcome: '面部出现清晰的明暗交界线与锐利投影，背景压暗两档，反差明显提升',
    risk: '与原图的柔和气质相反，原始的情绪基调会被改变',
    channel: 'Midjourney（由你本人提交）',
    recommended: false,
  },
  {
    id: 'recompose-night',
    title: '换到夜景霓虹',
    change: '保留回眸姿态与三分构图，把环境换成夜间街景，主光改为霓虹混合光',
    outcome: '面部由青色与品红双向染色，背景出现大面积散景光斑，高光带轻微溢出',
    risk: '肤色会被环境光强烈污染，需要控制染色强度以免失去真实感',
    channel: 'Midjourney（由你本人提交）',
    recommended: false,
  },
]

const RECOMPOSE_ARTIFACT: Artifact = {
  prompt: `Editorial portrait of a woman in her late twenties, turning her head over her shoulder, upper body in frame, positioned on the left third line, generous negative space on the right. Framed in 3:4 vertical, camera at eye level, no visible horizon, gentle perspective. Lit by a large soft overcast window light from the front right, soft wrap around the cheekbones, faint contact shadow, subtle ambient fill on the left. Muted warm grey palette with slightly cyan-shifted skin tones against a pale plaster wall and light linen curtain. 50mm equivalent, medium-shallow depth of field, background softly defocused but still readable. Matte skin with visible pores and fine vellus hair, textured cotton-linen fabric with soft folds, fine plaster grain. Rendering: 400-speed colour negative response, cream highlights, cyan shadows, visible but uneven grain, gently lifted contrast, sharpness concentrated around the eyes and lashes. --ar 3:4 --style raw --stylize 250 --no plastic skin, waxy texture, oversharpened edges, hdr`,
  channel: 'Midjourney 官网或 Discord，由你本人手动提交（程序不代为提交）',
  params: [
    '--ar 3:4　竖构图',
    '--style raw　写实向，减少默认美化',
    '--stylize 250　中等风格化，贴近提示词描述',
    '--no plastic skin, waxy texture, oversharpened edges, hdr　排除塑料感皮肤与 HDR 痕迹',
  ],
  checklist: [
    '主体已直接命名，无代词歧义',
    '光线写清了来源与方向（右前方大软光）',
    '比例 3:4 与交付用途一致',
    '参考图职责唯一：本张只借「拍法」，不借人物身份',
    '未提交前确认由本人操作，程序不代为提交',
  ],
}

export const mockProvider: Provider = {
  kind: 'mock',

  async analyze(ctx) {
    const text = ctx.workflow.id === 'refine' ? REFINE_ANALYSIS : RECOMPOSE_ANALYSIS
    return wait(PLACEHOLDER + text, 600)
  },

  async extractReferences(ctx) {
    if (!ctx.images.some((image) => image.role === 'reference')) return []
    const items: ReferenceItem[] = [
      {
        id: 'mock-bg',
        category: '背景',
        label: '冷灰渐变背板',
        description: '（示例）自上而下由浅灰过渡到中灰的无缝背板，表面为哑光涂料，弱颗粒。',
        source: '参考图1',
      },
      {
        id: 'mock-prop',
        category: '元素',
        label: '亚麻布与散落咖啡豆',
        description: '（示例）细密棉麻织物，褶皱有厚度与边缘落影；咖啡豆半哑光蜡质感，中缝线清晰。',
        source: '参考图1',
      },
      {
        id: 'mock-light',
        category: '光线',
        label: '右上侧逆光',
        description: '（示例）单侧硬光自右上入射，物体右侧出现窄高光带，投影短促朝左下。',
        source: '参考图2',
      },
    ]
    return wait(items, 500)
  },

  async suggestDirections(ctx) {
    const options = ctx.workflow.id === 'refine' ? REFINE_OPTIONS : RECOMPOSE_OPTIONS
    const limit = ctx.workflow.stages.find((s) => s.id === 'direction')?.maxOptions
    return wait(limit ? options.slice(0, limit) : options, 700)
  },

  async askDetail(ctx, question) {
    const scope = ctx.workflow.id === 'refine' ? '保留项与禁止项' : '参考图职责与参数'
    return wait(
      `（演示模式）你问的是「${question}」。这个问题的答案会影响${scope}的写法，` +
        `接入真实模型后这里会给出具体判断和两三种可选写法。`,
      400,
    )
  },

  async compose(ctx) {
    const artifact = ctx.workflow.id === 'refine' ? REFINE_ARTIFACT : RECOMPOSE_ARTIFACT
    return wait(artifact, 800)
  },

  async iterate(ctx, feedback) {
    const base = ctx.artifact ?? (ctx.workflow.id === 'refine' ? REFINE_ARTIFACT : RECOMPOSE_ARTIFACT)
    const stamp = `\n\n<!-- 迭代依据：${feedback} -->`
    return wait({ ...base, prompt: base.prompt + stamp }, 500)
  },
}
