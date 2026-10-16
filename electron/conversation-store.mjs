import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export function conversationUrl(value) {
  try {
    const url = new URL(value)
    return url.origin === 'https://gemini.google.com' && /^\/(?:u\/\d+\/)?app\/[a-zA-Z0-9_-]+$/.test(url.pathname)
      ? url.origin + url.pathname : null
  } catch { return null }
}

/** ChatGPT 的对话链接形如 /c/<id>，项目里还会带 /g/<项目>/ 前缀。 */
export function chatGptConversationUrl(value) {
  try {
    const url = new URL(value)
    return url.origin === 'https://chatgpt.com' && /^\/(?:g\/[a-zA-Z0-9_-]+\/)?c\/[a-zA-Z0-9-]+$/.test(url.pathname)
      ? url.origin + url.pathname : null
  } catch { return null }
}

/**
 * 只保存图片指纹和对话链接，不保存图片、回复或登录凭据。
 * 文件和校验分开配：Gemini 与 ChatGPT 各存一份，互不影响。
 */
export class ConversationStore {
  constructor(dataDir, { file = 'gemini-conversations.json', validate = conversationUrl } = {}) {
    this.file = path.join(dataDir, file)
    this.validate = validate
    this.entries = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : {}
  }
  get(id) {
    const entry = this.entries[id]
    return entry && !entry.dirty && this.validate(entry.url) ? entry : null
  }
  set(id, url, dirty = false, images = {}, plan = '') {
    this.entries[id] = { url: this.validate(url), dirty, images, plan }
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
