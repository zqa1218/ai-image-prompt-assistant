import { it, expect } from 'vitest'
import { imageConversationId } from './imageConversation.ts'

it('按底图内容绑定，而非文件名；无图阶段的标识保持稳定', async () => {
  const image = { name: 'a.png', dataUrl: 'data:image/png;base64,AA==', width: 1, height: 1, bytes: 1 }
  expect(await imageConversationId(image)).toBe(await imageConversationId({ ...image, name: 'renamed.png' }))
  expect(await imageConversationId(image)).not.toBe(await imageConversationId({ ...image, dataUrl: 'data:image/png;base64,BB==' }))
  expect(await imageConversationId(null)).toBe(await imageConversationId(undefined))
})
