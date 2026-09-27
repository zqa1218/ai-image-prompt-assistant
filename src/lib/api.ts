export type SettingsResponse = {
  baseUrl: string
  model: string
  hasKey: boolean
  keySource: 'env' | 'none'
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
  baseUrl?: string
  model?: string
  apiKey?: string
}): Promise<SettingsResponse> {
  return request<SettingsResponse>('/api/settings', {
    method: 'PUT',
    body: JSON.stringify(patch),
  })
}

export function listModels(): Promise<{ models: ModelInfo[] }> {
  return request<{ models: ModelInfo[] }>('/api/models')
}
