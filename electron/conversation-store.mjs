import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export function conversationUrl(value) {
  try {
    const url = new URL(value)
    return url.origin === 'https://gemini.google.com' && /^\/(?:u\/\d+\/)?app\/[a-zA-Z0-9_-]+$/.test(url.pathname)
      ? url.origin + url.pathname : null
  } catch { return null }
}

/** 只保存图片指纹和对话链接，不保存图片、回复或登录凭据。 */
export class ConversationStore {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'gemini-conversations.json')
    this.entries = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : {}
  }
  get(id) {
    const entry = this.entries[id]
    return entry && !entry.dirty && conversationUrl(entry.url) ? entry : null
  }
  set(id, url, dirty = false, images = {}) {
    this.entries[id] = { url: conversationUrl(url), dirty, images }
    this.save()
  }
  reset(id) {
    delete this.entries[id]
    this.save()
  }
  save() {
    mkdirSync(path.dirname(this.file), { recursive: true })
    writeFileSync(`${this.file}.tmp`, JSON.stringify(this.entries), { mode: 0o600 })
    renameSync(`${this.file}.tmp`, this.file)
  }
}
