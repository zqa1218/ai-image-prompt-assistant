import http from 'node:http'
import { Readable } from 'node:stream'
import {
  normalizeModels,
  normalizeUpstreamError,
  joinUrl,
  sendJson,
  sendText,
  upstreamHeaders,
} from './deepseek.mjs'
import { resolveSettings, writeConfig, writeEnvKey } from './config.mjs'

const PORT = Number(process.env.PW_API_PORT ?? process.env.PORT ?? 8787)
const HOST = '127.0.0.1'
const MAX_BODY_BYTES = 60 * 1024 * 1024

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    sendJson(res, 500, {
      error: { message: err instanceof Error ? err.message : String(err), type: 'internal' },
    })
  })
})

async function handle(req, res) {
  const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`)
  const route = `${req.method} ${url.pathname}`

  switch (route) {
    case 'GET /api/health':
      return sendJson(res, 200, { ok: true })

    case 'GET /api/settings': {
      const s = await resolveSettings()
      return sendJson(res, 200, {
        baseUrl: s.baseUrl,
        model: s.model,
        hasKey: s.hasKey,
        keySource: s.keySource,
      })
    }

    case 'PUT /api/settings': {
      const body = await readJsonBody(req)
      if (body === null) return sendJson(res, 400, { error: { message: '请求体不是合法 JSON' } })

      if (typeof body.apiKey === 'string' && body.apiKey.trim()) {
        await writeEnvKey(body.apiKey.trim())
      }
      await writeConfig({
        baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl : undefined,
        model: typeof body.model === 'string' ? body.model : undefined,
      })
      const s = await resolveSettings()
      return sendJson(res, 200, {
        baseUrl: s.baseUrl,
        model: s.model,
        hasKey: s.hasKey,
        keySource: s.keySource,
      })
    }

    case 'GET /api/models':
      return handleListModels(res)

    case 'POST /api/chat':
      return handleChat(req, res)

    default:
      return sendJson(res, 404, { error: { message: `未知路由 ${route}` } })
  }
}

async function handleListModels(res) {
  const settings = await resolveSettings()
  if (!settings.apiKey) {
    return sendJson(res, 401, {
      error: { message: '尚未配置 API Key，请先在设置页填写' },
    })
  }

  let upstream
  try {
    upstream = await fetch(joinUrl(settings.baseUrl, 'models'), {
      headers: upstreamHeaders(settings.apiKey),
      signal: AbortSignal.timeout(20_000),
    })
  } catch (err) {
    return sendJson(res, 502, {
      error: { message: `无法连接上游（${settings.baseUrl}）：${describe(err)}` },
    })
  }

  if (!upstream.ok) {
    return sendJson(res, upstream.status, await normalizeUpstreamError(upstream))
  }

  const payload = await upstream.json().catch(() => null)
  if (!payload) {
    return sendJson(res, 502, { error: { message: '上游返回的不是合法 JSON' } })
  }
  return sendJson(res, 200, normalizeModels(payload))
}

async function handleChat(req, res) {
  const settings = await resolveSettings()
  if (!settings.apiKey) {
    return sendJson(res, 401, {
      error: { message: '尚未配置 API Key，请先在设置页填写' },
    })
  }

  const body = await readJsonBody(req)
  if (body === null || typeof body !== 'object') {
    return sendJson(res, 400, { error: { message: '请求体不是合法 JSON' } })
  }

  const wantsStream = body.stream === true
  const payload = { ...body, model: body.model ?? settings.model }

  let upstream
  try {
    upstream = await fetch(joinUrl(settings.baseUrl, 'chat/completions'), {
      method: 'POST',
      headers: upstreamHeaders(settings.apiKey),
      body: JSON.stringify(payload),
      signal: wantsStream ? undefined : AbortSignal.timeout(180_000),
    })
  } catch (err) {
    return sendJson(res, 502, {
      error: { message: `无法连接上游（${settings.baseUrl}）：${describe(err)}` },
    })
  }

  if (!upstream.ok) {
    return sendJson(res, upstream.status, await normalizeUpstreamError(upstream))
  }

  if (wantsStream) {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    })
    if (!upstream.body) return res.end()
    Readable.fromWeb(upstream.body).on('error', () => res.end()).pipe(res)
    return
  }

  const text = await upstream.text()
  return sendText(res, 200, text)
}

async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) {
      throw new Error('请求体超过 60 MB 上限')
    }
    chunks.push(chunk)
  }
  if (size === 0) return null
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return null
  }
}

function describe(err) {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError') return '请求超时'
    return err.message
  }
  return String(err)
}

server.listen(PORT, HOST, () => {
  console.log(`[prompt-wizard] 本地代理已启动：http://${HOST}:${PORT}`)
})
