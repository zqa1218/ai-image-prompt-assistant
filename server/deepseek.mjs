const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' }

export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, { ...JSON_HEADERS, 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

export function sendText(res, status, text, contentType = JSON_HEADERS['content-type']) {
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}

export function joinUrl(baseUrl, suffix) {
  return `${baseUrl.replace(/\/+$/, '')}/${suffix.replace(/^\/+/, '')}`
}

export function upstreamHeaders(apiKey) {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${apiKey}`,
  }
}

/**
 * 把上游错误归一化成 { error: { message, status, raw } }。
 * 只透传 message，不回显请求头，避免 key 泄露。
 */
export async function normalizeUpstreamError(upstream) {
  const text = await upstream.text().catch(() => '')
  let message = text
  try {
    const parsed = JSON.parse(text)
    message =
      parsed?.error?.message ??
      parsed?.message ??
      parsed?.error?.code ??
      text
  } catch {
    // 保持原始文本
  }
  if (!message) message = `上游返回 HTTP ${upstream.status}`
  return {
    error: {
      message: truncate(String(message), 800),
      status: upstream.status,
      type: 'upstream_error',
    },
  }
}

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** 归一化 /models 返回，兼容 OpenAI 与 DeepSeek 两种字段形态。 */
export function normalizeModels(payload) {
  const data = Array.isArray(payload?.data) ? payload.data : []
  return {
    models: data.map((item) => {
      const modalities = Array.isArray(item.input_modalities)
        ? item.input_modalities
        : undefined
      return {
        id: String(item.id ?? ''),
        name: typeof item.name === 'string' ? item.name : undefined,
        contextWindow:
          typeof item.context_window === 'number' ? item.context_window : undefined,
        maxOutputTokens:
          typeof item.max_output_tokens === 'number' ? item.max_output_tokens : undefined,
        inputModalities: modalities,
        supportsVision: modalities ? modalities.includes('image') : undefined,
      }
    }),
  }
}
