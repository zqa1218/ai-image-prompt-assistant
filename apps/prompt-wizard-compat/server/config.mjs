import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import {
  DEFAULT_PLAN_ID,
  THINKING_LEVELS,
  coercePlanId,
  planOptions,
} from './gemini-plans.mjs'
import {
  DEFAULT_CHATGPT_PLAN_ID,
  chatGptPlanOptions,
  coerceChatGptPlanId,
} from './chatgpt-plans.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
export const PROJECT_ROOT = path.resolve(here, '..')

export const DATA_DIR = process.env.PROMPT_WIZARD_DATA_DIR || path.join(process.env.APPDATA || os.homedir(), 'PromptWizard')
const settingsPath = path.join(DATA_DIR, 'model-settings.json')
const defaults = {
  mode: 'gemini-web',
  baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  model: process.env.DEEPSEEK_MODEL || 'deepseek-flash',
  geminiPlan: process.env.PW_GEMINI_PLAN || DEFAULT_PLAN_ID,
  geminiThinking: process.env.PW_GEMINI_THINKING || '',
  chatgptPlan: process.env.PW_CHATGPT_PLAN || DEFAULT_CHATGPT_PLAN_ID,
}

export function readSettings() {
  const stored = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf8')) : {}
  let apiKey = process.env.DEEPSEEK_API_KEY || ''
  if (stored.encryptedKey) {
    const storage = globalThis.promptWizardSafeStorage
    if (!storage?.isEncryptionAvailable()) throw new Error('无法解密本机 API Key，请使用桌面端重新保存设置')
    apiKey = storage.decryptString(Buffer.from(stored.encryptedKey, 'base64'))
  }
  const settings = { ...defaults, ...stored, apiKey }
  return {
    ...settings,
    geminiPlan: coercePlanId(settings.geminiPlan),
    geminiThinking: THINKING_LEVELS.includes(settings.geminiThinking) ? settings.geminiThinking : '',
    chatgptPlan: coerceChatGptPlanId(settings.chatgptPlan),
  }
}

export function publicSettings(settings = readSettings()) {
  return { mode: settings.mode, baseUrl: settings.baseUrl, model: settings.model,
    geminiPlan: coercePlanId(settings.geminiPlan),
    geminiThinking: THINKING_LEVELS.includes(settings.geminiThinking) ? settings.geminiThinking : '',
    chatgptPlan: coerceChatGptPlanId(settings.chatgptPlan),
    plans: planOptions(),
    chatgptPlans: chatGptPlanOptions(),
    hasKey: Boolean(settings.apiKey), keySource: settings.encryptedKey ? 'local' : settings.apiKey ? 'env' : 'none' }
}

export function updateSettings(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('设置必须是 JSON 对象')
  const next = readSettings()
  if (patch.mode !== undefined) {
    if (!['api', 'gemini-web', 'chatgpt-web'].includes(patch.mode)) throw new Error('未知运行模式')
    next.mode = patch.mode
  }
  if (patch.baseUrl !== undefined) {
    const url = new URL(patch.baseUrl)
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('API 地址必须使用 HTTPS（本机服务除外）')
    if (url.username || url.password || url.search || url.hash) throw new Error('API 地址不能含密码、查询参数或片段')
    if (new URL(next.baseUrl).origin !== url.origin && next.apiKey && !patch.apiKey?.trim()) throw new Error('更换 API 服务地址时必须同时填写新服务的 Key，避免把旧 Key 发给其他服务')
    next.baseUrl = url.href.replace(/\/+$/, '')
  }
  if (patch.model !== undefined) {
    if (typeof patch.model !== 'string' || !patch.model.trim() || patch.model.length > 200) throw new Error('请输入有效的模型 ID')
    next.model = patch.model.trim()
  }
  if (patch.geminiPlan !== undefined) {
    if (typeof patch.geminiPlan !== 'string' || !planOptions().some((plan) => plan.id === patch.geminiPlan)) throw new Error('未知的 Gemini 网页方案')
    next.geminiPlan = patch.geminiPlan
  }
  if (patch.geminiThinking !== undefined) {
    if (typeof patch.geminiThinking !== 'string' || !THINKING_LEVELS.includes(patch.geminiThinking)) throw new Error('未知的思考等级')
    next.geminiThinking = patch.geminiThinking
  }
  if (patch.chatgptPlan !== undefined) {
    if (typeof patch.chatgptPlan !== 'string' || !chatGptPlanOptions().some((plan) => plan.id === patch.chatgptPlan)) throw new Error('未知的 ChatGPT 网页方案')
    next.chatgptPlan = patch.chatgptPlan
  }
  if (patch.apiKey !== undefined) {
    if (typeof patch.apiKey !== 'string' || patch.apiKey.length > 4096) throw new Error('API Key 格式无效')
    const key = patch.apiKey.trim()
    if (key) {
      const storage = globalThis.promptWizardSafeStorage
      if (!storage?.isEncryptionAvailable()) throw new Error('请在桌面端保存 API Key；开发服务可使用 DEEPSEEK_API_KEY 环境变量')
      next.encryptedKey = storage.encryptString(key).toString('base64')
    } else delete next.encryptedKey
  }
  delete next.apiKey
  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(`${settingsPath}.tmp`, JSON.stringify(next, null, 2), { mode: 0o600 })
  renameSync(`${settingsPath}.tmp`, settingsPath)
  return publicSettings()
}
