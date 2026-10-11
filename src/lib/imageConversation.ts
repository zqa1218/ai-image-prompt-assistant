import type { ImageRef } from './wizardTypes.ts'

const textSession = `text-${crypto.randomUUID()}`

/** 内容而非文件名标识底图：改名不换会话，换图不会串线。 */
export async function imageConversationId(image: ImageRef | null | undefined): Promise<string> {
  if (!image) return textSession
  const bytes = new TextEncoder().encode(image.dataUrl)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return `image-${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}
