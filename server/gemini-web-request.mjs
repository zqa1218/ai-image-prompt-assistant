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
      '请严格按下面的固定规则和任务要求处理随本消息上传的图片。图片文件名中的 REFERENCE 编号就是其角色编号。\n\n' +
      '这是当前图片任务的最新快照：本轮需求、规则和附件优先于历史中已被撤回或修改的内容；只完成本轮阶段，不自行执行其他阶段或生成图片。\n\n' +
      '未变化的图片沿用本对话中同名附件，不重复上传；新上传的同名附件替换旧版本。本轮未列出的参考图不再参与，切勿自行沿用已撤回的需求。\n\n' +
      text.join('\n\n'),
    images,
  }
}
