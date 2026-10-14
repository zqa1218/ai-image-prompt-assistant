export type SettingsResponse = {
  mode: 'gemini-web' | 'api'
  baseUrl: string
  model: string
  /** 网页端方案 ID，见 server/gemini-plans.mjs */
  geminiPlan: string
  /** 思考等级：'' = 跟随账号，其余为 低点 / 中等 / 高点 */
  geminiThinking: string
  plans: { id: string; label: string; note: string }[]
  hasKey: boolean
  keySource: 'env' | 'local' | 'none'
}

export type ModelInfo = {
  id: string
  name?: string
  contextWindow?: number
  maxOutputTokens?: number
  inputModalities?: string[]
  supportsVision?: boolean
}

export class ApiError extends Error {
  status: number
  detail?: string

  constructor(status: number, message: string, detail?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    })
  } catch {
    throw new ApiError(0, '无法连接本地服务，请确认 npm run dev 仍在运行')
  }

  const text = await res.text()
  const payload = text ? safeParse(text) : null

  if (!res.ok) {
    const message =
      (payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error?: { message?: string } }).error?.message ?? '')
        : '') || `请求失败（HTTP ${res.status}）`
    throw new ApiError(res.status, message)
  }

  return payload as T
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export function getSettings(): Promise<SettingsResponse> {
  return request<SettingsResponse>('/api/settings')
}

export function saveSettings(patch: {
  mode?: 'gemini-web' | 'api'
  baseUrl?: string
  model?: string
  geminiPlan?: string
  geminiThinking?: string
  apiKey?: string
}): Promise<SettingsResponse> {
  return request<SettingsResponse>('/api/settings', {
    method: 'PUT',
    body: JSON.stringify(patch),
  })
}

export function resetGeminiConversation(conversationId: string): Promise<{ ok: boolean }> {
  return request('/api/gemini/reset', { method: 'POST', body: JSON.stringify({ conversationId }) })
}

export function listModels(): Promise<{ models: ModelInfo[] }> {
  return request<{ models: ModelInfo[] }>('/api/models')
}

export type GeminiWebStatus = {
  connected: boolean
  account?: string
  model?: string
  detail?: string
}

export function getGeminiStatus(): Promise<GeminiWebStatus> {
  return request<GeminiWebStatus>('/api/gemini/status')
}

export function openGeminiLogin(email: string): Promise<GeminiWebStatus> {
  return request<GeminiWebStatus>('/api/gemini/open', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

/** uxp = 装了 PS 面板插件；com = 直接走 Photoshop 自带的 COM 自动化。 */
export type PhotoshopStatus = {
  connected: boolean
  mode: 'uxp' | 'com' | 'none'
  detail?: string
}

export type PhotoshopDocument = {
  index: number
  name: string
  width: number
  height: number
  isActive?: boolean
  layers?: number
}

export function getPhotoshopStatus(): Promise<PhotoshopStatus> {
  return request<PhotoshopStatus>('/api/photoshop/status')
}

export function getPhotoshopDocuments(): Promise<{ documents: PhotoshopDocument[] }> {
  return request<{ documents: PhotoshopDocument[] }>('/api/photoshop/documents')
}

export function capturePhotoshopImage(role: 'original' | 'reference', index = -1) {
  return request<{
    image: import('./wizardTypes.ts').ImageRef
    source: 'uxp' | 'com'
  }>('/api/photoshop/capture', {
    method: 'POST',
    body: JSON.stringify({ role, index }),
  })
}
