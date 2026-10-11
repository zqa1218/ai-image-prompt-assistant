import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ConversationStore, conversationUrl } from './conversation-store.mjs'

describe('底图对话持久化', () => {
  it('同图恢复、异图隔离、污染与手动重开不复用，重开不影响其他图', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'pw-conversations-test-'))
    try {
      const store = new ConversationStore(dir)
      store.set('image-a', 'https://gemini.google.com/app/aaa', false, { base: 'hash' })
      store.set('image-b', 'https://gemini.google.com/app/bbb')
      const restored = new ConversationStore(dir)
      expect(restored.get('image-a').url).toBe('https://gemini.google.com/app/aaa')
      expect(restored.get('image-a').images).toEqual({ base: 'hash' })
      expect(restored.get('image-b').url).toBe('https://gemini.google.com/app/bbb')
      restored.set('image-a', 'https://gemini.google.com/app/aaa', true)
      expect(restored.get('image-a')).toBeNull()
      restored.reset('image-a')
      expect(new ConversationStore(dir).get('image-a')).toBeNull()
      expect(restored.get('image-b')).not.toBeNull()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('只接受真正的 Gemini 对话，不接受首页、登录链接或外部网址', () => {
    expect(conversationUrl('https://gemini.google.com/u/1/app/abcd?hl=zh')).toBe('https://gemini.google.com/u/1/app/abcd')
    for (const value of ['https://evil.com/app/abc', 'https://gemini.google.com/app', 'https://gemini.google.com.evil.com/app/abc', 'javascript:alert(1)']) expect(conversationUrl(value)).toBeNull()
  })
})
