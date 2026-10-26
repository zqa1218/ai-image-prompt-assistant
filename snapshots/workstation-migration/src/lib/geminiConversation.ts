import type { ContentPart } from './llm/types.ts'
import type { WizardImage } from './wizardTypes.ts'

/**
 * 按「角色标签 → 图片」的顺序组装 Gemini 多模态消息。
 * 图片若全部堆在末尾，模型容易把底图与参考图的职责搞反。
 */
export function buildGeminiContent(task: string, images: WizardImage[]): ContentPart[] {
  const parts: ContentPart[] = [{ type: 'text', text: task }]
  let referenceIndex = 0

  for (const image of images) {
    if (image.role === 'original') {
      parts.push({
        type: 'text',
        text:
          '## 图片附件：REFERENCE_0（底图 / 原图）\n' +
          '这是唯一的空间与事实基准。人物身份、主体形状、构图、镜头、透视、现有遮挡与光向默认以此图为准。',
      })
    } else {
      referenceIndex += 1
      parts.push({
        type: 'text',
        text:
          `## 图片附件：REFERENCE_${referenceIndex}（参考图${referenceIndex}）\n` +
          '这张图只提供用户明确指定的物体、背景、光线、色调、材质或风格信息；不得取代 REFERENCE_0 成为新底图。',
      })
    }
    parts.push({
      type: 'image_url',
      image_url: { url: image.dataUrl, detail: 'high' },
    })
  }

  if (images.length > 0) {
    parts.push({
      type: 'text',
      text:
        '## 附件解读纪律\n' +
        '先确认 REFERENCE_0 中必须保留的内容，再逐张提取参考图职责。' +
        '只迁移用户需求或已勾选项目指定的成分，冲突时以用户需求和 REFERENCE_0 为最高优先级。',
    })
  }

  return parts
}
