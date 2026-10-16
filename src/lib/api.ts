export type SettingsResponse = {
  mode: 'gemini-web' | 'chatgpt-web' | 'api'
  baseUrl: string
  model: string
  /** 网页端方案 ID，见 server/gemini-plans.mjs */
  geminiPlan: string
  /** 思考等级：'' = 跟随账号，其余为 低点 / 中等 / 高点 */
  geminiThinking: string
  /** ChatGPT 网页方案 ID，见 server/chatgpt-plans.mjs */
  chatgptPlan: string
  plans: { id: string; label: string; note: string }[]
  chatgptPlans: { id: string; label: string; note: string }[]
  hasKey: boolean
  keySource: 'env' | 'local' | 'none'
}

/** 网页渠道：Gemini 与 ChatGPT 走同一套接口，只换 channel。 */
export type WebChannel = 'gemini-web' | 'chatgpt-web'

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
  mode?: 'gemini-web' | 'chatgpt-web' | 'api'
  baseUrl?: string
  model?: string
  geminiPlan?: string
  geminiThinking?: string
  chatgptPlan?: string
  apiKey?: string
}): Promise<SettingsResponse> {
  return request<SettingsResponse>('/api/settings', {
    method: 'PUT',
    body: JSON.stringify(patch),
  })
}

export function resetWebConversation(channel: WebChannel, conversationId: string): Promise<{ ok: boolean }> {
  return request('/api/web/reset', { method: 'POST', body: JSON.stringify({ channel, conversationId }) })
}

export function listModels(): Promise<{ models: ModelInfo[] }> {
  return request<{ models: ModelInfo[] }>('/api/models')
}

export type WebStatus = {
  connected: boolean
  channel?: WebChannel
  account?: string
  model?: string
  detail?: string
  engine?: 'chrome' | 'embedded'
}

export function getWebStatus(channel: WebChannel): Promise<WebStatus> {
  return request<WebStatus>(`/api/web/status?channel=${channel}`)
}

export function openWebLogin(channel: WebChannel, email = ''): Promise<WebStatus> {
  return request<WebStatus>('/api/web/open', {
    method: 'POST',
    body: JSON.stringify({ channel, email }),
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

/** 存档列表项：只带缩略图与统计，不带图片本体。 */
export type ArchiveMeta = {
  id: string
  name: string
  createdAt: string
  updatedAt?: string
  workflowId: string
  imageCount: number
  hasOriginal: boolean
  bytes: number
  thumb: string
}

/** 一份完整存档：含底图与参考图的 data URL。 */
export type ArchiveRecord = ArchiveMeta & {
  intake: Record<string, string>
  original: import('./wizardTypes.ts').ImageRef | null
  references: import('./wizardTypes.ts').ImageRef[]
}

export function listArchives(): Promise<{ archives: ArchiveMeta[] }> {
  return request<{ archives: ArchiveMeta[] }>('/api/archives')
}

export function getArchive(id: string): Promise<{ archive: ArchiveRecord }> {
  return request<{ archive: ArchiveRecord }>(`/api/archives/${encodeURIComponent(id)}`)
}

export function saveArchiveToDisk(payload: {
  id?: string
  name: string
  workflowId: string
  intake: Record<string, string>
  original: import('./wizardTypes.ts').ImageRef | null
  references: import('./wizardTypes.ts').ImageRef[]
  thumb?: string
}): Promise<{ archive: ArchiveMeta }> {
  return request<{ archive: ArchiveMeta }>('/api/archives', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function deleteArchiveFromDisk(id: string): Promise<{ ok: boolean }> {
  return request<{ ok: boolean }>(`/api/archives/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
