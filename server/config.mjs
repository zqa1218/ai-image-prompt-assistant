import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const PROJECT_ROOT = path.resolve(here, '..')

/**
 * 数据目录默认是项目根；设置 PROMPT_WIZARD_DATA_DIR 可指向别处，
 * 便于测试时使用临时目录，不污染真实的 .env。
 */
export const DATA_DIR = process.env.PROMPT_WIZARD_DATA_DIR
  ? path.resolve(process.env.PROMPT_WIZARD_DATA_DIR)
  : PROJECT_ROOT

const ENV_PATH = path.join(DATA_DIR, '.env')
const CONFIG_PATH = path.join(DATA_DIR, '.prompt-wizard.json')
const ENV_KEY_NAME = 'DEEPSEEK_API_KEY'

export const DEFAULTS = Object.freeze({
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-flash',
})

function parseEnv(text) {
  const out = {}
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

export async function readEnvKey() {
  if (existsSync(ENV_PATH)) {
    const parsed = parseEnv(await readFile(ENV_PATH, 'utf8'))
    if (parsed[ENV_KEY_NAME]) return { key: parsed[ENV_KEY_NAME], source: 'env' }
  }
  if (process.env[ENV_KEY_NAME]) {
    return { key: process.env[ENV_KEY_NAME], source: 'env' }
  }
  return { key: null, source: 'none' }
}

export async function writeEnvKey(key) {
  await mkdir(DATA_DIR, { recursive: true })
  let lines = []
  if (existsSync(ENV_PATH)) {
    lines = (await readFile(ENV_PATH, 'utf8')).split(/\r?\n/)
  }
  let replaced = false
  const next = lines.map((line) => {
    if (/^\s*DEEPSEEK_API_KEY\s*=/.test(line)) {
      replaced = true
      return `${ENV_KEY_NAME}=${key}`
    }
    return line
  })
  if (!replaced) {
    while (next.length && next[next.length - 1].trim() === '') next.pop()
    next.push(`${ENV_KEY_NAME}=${key}`, '')
  }
  await writeFile(ENV_PATH, next.join('\n'), 'utf8')
}

export async function readConfig() {
  if (!existsSync(CONFIG_PATH)) return { ...DEFAULTS }
  try {
    const parsed = JSON.parse(await readFile(CONFIG_PATH, 'utf8'))
    return {
      baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : DEFAULTS.baseUrl,
      model: typeof parsed.model === 'string' ? parsed.model : DEFAULTS.model,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export async function writeConfig(patch) {
  await mkdir(DATA_DIR, { recursive: true })
  const current = await readConfig()
  const next = {
    baseUrl: patch.baseUrl?.trim() || current.baseUrl,
    model: patch.model?.trim() || current.model,
  }
  await writeFile(CONFIG_PATH, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return next
}

/** 面向接口返回的设置快照 —— 永不包含 key 明文。 */
export async function resolveSettings() {
  const [config, key] = await Promise.all([readConfig(), readEnvKey()])
  return {
    baseUrl: config.baseUrl,
    model: config.model,
    hasKey: Boolean(key.key),
    keySource: key.source,
    apiKey: key.key,
  }
}
