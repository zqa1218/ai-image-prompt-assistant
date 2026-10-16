/**
 * 纯文字声明。
 *
 * Gemini 4 一旦在带图消息里读到「修图 / 置入 / 迁移到另一张照片」这类字样，
 * 会直接开始生成图片（页面显示「正在创建您的图片」），而不是回文字。
 * 所以每条请求的开头和结尾都要明确：图只是素材，只要文字结果。
 */
const TEXT_ONLY_HEAD =
  '【纯文字任务 · 禁止生成图片】\n' +
  '随本消息附带的图片只是给你阅读的素材。请不要创建、生成、编辑或修改任何图片，' +
  '不要调用图像生成或图像编辑功能，也不要在回复里放图片或图片链接。\n' +
  '下面出现的「修图 / 编辑 / 置入 / 迁移 / 替换」等字样，描述的是要写进**文字提示词**里的内容，' +
  '不是让你动手改图；图像编辑由另一个工具执行，你只负责读图并写出文字。\n' +
  '请只用文字回答。\n'

const TEXT_ONLY_TAIL =
  '\n\n# 再次确认（最高优先级）\n' +
  '只回复文字：不要生成或编辑图片，不要调用图像工具，不要输出图片。\n' +
  '如果你正准备「创建您的图片」，请立刻停下，改用文字回答上面的任务。\n' +
  '另外：回答内容就是最终结果本身，结尾不要补「建议使用某某模型进行…」「可以配合某某工具」' +
  '这类推荐、使用说明或客套话，也不要另起一段写结语。'

/** 把原 OpenAI 风格消息编译成一段网页提示词和有顺序的图片附件。 */
export function compileGeminiWebRequest(messages = []) {
  const text = []
  const images = []
  let attachmentIndex = 0
  let attachmentLabel = null

  for (const message of messages) {
    const heading = message?.role === 'system' ? '固定规则' : '本轮任务'
    const parts = typeof message?.content === 'string'
      ? [{ type: 'text', text: message.content }]
      : Array.isArray(message?.content) ? message.content : []
    const block = []

    for (const part of parts) {
      if (part?.type === 'text' && typeof part.text === 'string') {
        block.push(part.text.trim())
        const label = /^## 图片附件：REFERENCE_(\d+)/.exec(part.text)
        if (label) attachmentLabel = Number(label[1])
      } else if (part?.type === 'image_url' && typeof part.image_url?.url === 'string') {
        images.push({
          dataUrl: part.image_url.url,
          name: (attachmentLabel ?? attachmentIndex) === 0 ? 'REFERENCE_0_底图.jpg' : `REFERENCE_${attachmentLabel ?? attachmentIndex}_参考图.jpg`,
        })
        attachmentIndex += 1
        attachmentLabel = null
      }
    }

    if (block.some(Boolean)) text.push(`# ${heading}\n${block.filter(Boolean).join('\n\n')}`)
  }

  return {
    prompt:
      '【AI修图提示词助手自动提交】\n' +
      TEXT_ONLY_HEAD +
      '\n' +
      '请严格按下面的固定规则和任务要求处理随本消息上传的图片。图片文件名中的 REFERENCE 编号就是其角色编号。\n\n' +
      '这是当前图片任务的最新快照：本轮需求、规则和附件优先于历史中已被撤回或修改的内容；只完成本轮阶段，不自行执行其他阶段或生成图片。\n\n' +
      '未变化的图片沿用本对话中同名附件，不重复上传；新上传的同名附件替换旧版本。本轮未列出的参考图不再参与，切勿自行沿用已撤回的需求。\n\n' +
      text.join('\n\n') +
      TEXT_ONLY_TAIL,
    images,
  }
}
